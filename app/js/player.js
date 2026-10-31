// 轻量 DASH 播放器：直接用 MSE，按 sidx 索引分段拉取、缓冲、seek。
// B 站的 DASH 是「音频、视频各一个 fMP4 文件」，文件头有 init 段 + sidx 索引，所以不需要 MPD / 完整播放器库（省内存）。
(function () {
  var CFG = window.BILI_CFG, U = window.U;

  // 带 Range 拉字节；不发 Referer（akamai 节点只接受无 Referer 或 B 站 Referer）
  function fetchRange(url, a, b) {
    return fetch(url, { headers: { Range: 'bytes=' + a + '-' + b }, referrerPolicy: 'no-referrer' }).then(check);
  }
  function check(r) {
    if (r.status !== 206 && r.status !== 200) { var e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
    return r.arrayBuffer();
  }
  // 取流路线：先直连默认节点；有账号服务（hub）时，直连失败再让 hub 代取备用节点（hub 会补上 B 站 Referer）
  function routesOf(stream) {
    var hub = window.API && window.API.hub, urls = stream.urls || [stream.url], rs = [{ url: urls[0], hub: false }];
    if (hub && hub.on) { urls.slice(1, 3).forEach(function (u) { rs.push({ url: u, hub: true }); }); rs.push({ url: urls[0], hub: true }); }
    return rs;
  }
  function fetchVia(r, a, b) {
    var hub = window.API.hub, range = 'bytes=' + a + '-' + b;
    return (r.hub
      ? fetch(hub.base + '/hub/cdn?u=' + encodeURIComponent(r.url), { headers: { Range: range, 'X-Hub-Key': hub.key }, referrerPolicy: 'no-referrer' })
      : fetch(r.url, { headers: { Range: range }, referrerPolicy: 'no-referrer' })).then(check);
  }
  // 按路线顺序试，成功的路线记在 stream.good 里，后面的分片直接走它
  function fetchAny(stream, a, b) {
    if (!stream.routes) stream.routes = routesOf(stream);
    var rs = stream.routes, g = stream.good || 0, order = [g].concat(rs.map(function (_, i) { return i; }).filter(function (i) { return i !== g; }));
    var p = Promise.reject(null);
    order.forEach(function (i) {
      p = p.catch(function (prev) {
        return fetchVia(rs[i], a, b).then(function (buf) { if (stream.good !== i) U.diag('cdn.route', (rs[i].hub ? 'hub ' : 'direct ') + new URL(rs[i].url).host.slice(0, 30)); stream.good = i; return buf; });
      });
    });
    return p;
  }
  function range(s) { var p = String(s).split('-'); return [Number(p[0]), Number(p[1])]; }

  // 解析 sidx：得到每个分段的 [起止时间, 字节偏移, 大小]。base = 这段字节在文件里的起始偏移
  function parseSidx(buf, base) {
    var dv = new DataView(buf), p = 0, size = 0;
    while (p + 8 <= buf.byteLength) {
      size = dv.getUint32(p);
      var type = String.fromCharCode(dv.getUint8(p + 4), dv.getUint8(p + 5), dv.getUint8(p + 6), dv.getUint8(p + 7));
      if (type === 'sidx') break;
      if (!size) throw new Error('sidx not found');
      p += size;
    }
    if (p + 8 > buf.byteLength) throw new Error('sidx not found');
    var ver = dv.getUint8(p + 8), o = p + 12;
    o += 4; // reference_ID
    var timescale = dv.getUint32(o); o += 4;
    var earliest, first;
    if (ver === 0) { earliest = dv.getUint32(o); first = dv.getUint32(o + 4); o += 8; }
    else { earliest = Number(dv.getBigUint64(o)); first = Number(dv.getBigUint64(o + 8)); o += 16; }
    o += 2; var count = dv.getUint16(o); o += 2;
    var segs = [], off = base + p + size + first, t = earliest; // 偏移锚点 = sidx 盒结束后的第一个字节
    for (var i = 0; i < count; i++) {
      var w = dv.getUint32(o), sz = w & 0x7fffffff, dur = dv.getUint32(o + 4); o += 12;
      segs.push({ s: t / timescale, e: (t + dur) / timescale, off: off, size: sz });
      off += sz; t += dur;
    }
    return segs;
  }

  // 一条轨道（视频或音频）
  function Track(kind, stream) {
    this.kind = kind; this.stream = stream; this.mime = stream.mime;
    this.init = null; this.segs = []; this.next = 0; this.needInit = true; this.busy = false; this.sb = null;
    this.initRange = range(stream.initRange); this.indexRange = range(stream.indexRange);
  }
  Track.prototype.prepare = function () {
    var self = this;
    return Promise.all([
      fetchAny(this.stream, this.initRange[0], this.initRange[1]),
      fetchAny(this.stream, this.indexRange[0], this.indexRange[1])
    ]).then(function (r) { self.init = r[0]; self.segs = parseSidx(r[1], self.indexRange[0]); });
  };
  Track.prototype.segAt = function (t) { // 包含时间 t 的分段下标
    for (var i = 0; i < this.segs.length; i++) if (t < this.segs[i].e) return i;
    return this.segs.length;
  };
  Track.prototype.duration = function () { return this.segs.length ? this.segs[this.segs.length - 1].e : 0; };

  function Player(video, hooks) {
    this.v = video; this.hooks = hooks || {};
    this.ms = null; this.url = null; this.tracks = []; this.timer = null; this.dead = false; this.fails = 0;
  }

  // streams = { video:{url,mime,initRange,indexRange}, audio:{...} }；start = 起播秒数
  Player.prototype.load = function (streams, start) {
    var self = this;
    this.tracks = [new Track('video', streams.video), new Track('audio', streams.audio)];
    return Promise.all(this.tracks.map(function (t) { return t.prepare(); })).then(function () {
      if (self.dead) return;
      self.duration = Math.max(self.tracks[0].duration(), self.tracks[1].duration());
      return self.open(start);
    });
  };

  // 新建 MediaSource 并从 start 所在分段开始喂数据。init 和 sidx 已经拿到，不用重新请求。
  // 首次起播和“缓冲之外的跳转”都走这里（比 abort + remove 更稳，HEVC 在桌面 Chrome 上 remove 后会解码失败）
  Player.prototype.open = function (start) {
    var self = this, v = this.v;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.url) { try { URL.revokeObjectURL(this.url); } catch (e) {} }
    this.gen = (this.gen || 0) + 1;   // 代数：重建后，旧请求回来的数据直接丢弃
    var ms = this.ms = new MediaSource();
    this.url = URL.createObjectURL(ms);
    v.src = this.url;
    return new Promise(function (res) { ms.addEventListener('sourceopen', res, { once: true }); }).then(function () {
      if (self.dead || self.ms !== ms) return;
      ms.duration = self.duration;
      start = Math.max(0, Math.min(start || 0, self.duration - 2));
      self.tracks.forEach(function (t) {
        t.sb = ms.addSourceBuffer(t.mime);
        t.next = t.segAt(start); t.needInit = true; t.busy = false;
      });
      self.timer = setInterval(function () { self.pump(); }, 250);
      self.pump();
      if (start > 0) v.currentTime = start;
      return v.play().catch(function () { v.muted = true; return v.play(); });
    });
  };

  // 缓冲循环：每 250ms 看一眼，前方缓冲不足就补下一个分段；太靠后的旧缓冲删掉省内存
  Player.prototype.pump = function () {
    if (this.dead || !this.ms || this.ms.readyState === 'closed') return;
    var self = this, t = this.v.currentTime;
    this.tracks.forEach(function (tr) {
      var sb = tr.sb;
      if (!sb || sb.updating || tr.busy || Date.now() < (tr.retryAt || 0)) return;
      var buf = sb.buffered, ahead = 0, startB = -1;
      for (var i = 0; i < buf.length; i++) {
        if (startB < 0 || buf.start(i) < startB) startB = buf.start(i);
        if (buf.start(i) <= t + 0.3 && buf.end(i) > t) ahead = buf.end(i) - t;
      }
      // 清理播放位置之前很久的缓冲
      if (startB >= 0 && t - startB > CFG.back + 5) { try { sb.remove(startB, t - CFG.back); } catch (e) {} return; }
      if (tr.next >= tr.segs.length || ahead >= CFG.ahead) return;
      var seg = tr.segs[tr.next], idx = tr.next, gen = self.gen;
      tr.busy = true;
      fetchAny(tr.stream, seg.off, seg.off + seg.size - 1).then(function (data) {
        if (self.dead || gen !== self.gen || tr.next !== idx) { if (gen === self.gen) tr.busy = false; return; } // 期间重建过，丢弃
        return self.append(tr, data).then(function () { tr.next = idx + 1; tr.busy = false; self.fails = 0; });
      }).catch(function (e) {
        if (gen === self.gen) tr.busy = false;
        self.fails++; tr.retryAt = Date.now() + 1500;   // 失败后等 1.5 秒再试，别每 0.25 秒狂刷
        U.diag('player.segfail', tr.kind + ' #' + idx + ' ' + (e && e.message));
        if (self.fails >= 4 && !self.errored && self.hooks.onError) { self.errored = true; self.hooks.onError(e); }
      });
    });
    // 两条轨道都喂完 → 结束流（否则最后几秒会一直转圈）
    var done = this.tracks.every(function (tr) { return tr.next >= tr.segs.length && !tr.busy && tr.sb && !tr.sb.updating; });
    if (done && this.ms.readyState === 'open') { try { this.ms.endOfStream(); } catch (e) {} }
  };

  Player.prototype.append = function (tr, data) {
    var sb = tr.sb;
    function one(buf) {
      return new Promise(function (res, rej) {
        function onEnd() { sb.removeEventListener('error', onErr); res(); }
        function onErr() { sb.removeEventListener('updateend', onEnd); rej(new Error('SourceBuffer error')); }
        sb.addEventListener('updateend', onEnd, { once: true });
        sb.addEventListener('error', onErr, { once: true });
        try { sb.appendBuffer(buf); } catch (e) { sb.removeEventListener('updateend', onEnd); sb.removeEventListener('error', onErr); rej(e); }
      });
    }
    var p = Promise.resolve();
    if (tr.needInit) { p = one(tr.init).then(function () { tr.needInit = false; }); }
    return p.then(function () { return one(data); });
  };

  Player.prototype.isBuffered = function (t) {
    return this.tracks.every(function (tr) {
      var b = tr.sb.buffered;
      for (var i = 0; i < b.length; i++) if (b.start(i) <= t && b.end(i) > t + 1) return true;
      return false;
    });
  };

  // seek：目标已在缓冲里就直接跳，否则重建 MediaSource 从目标所在分段重新开始
  Player.prototype.seek = function (t) {
    var d = this.duration || 0;
    t = Math.max(0, Math.min(t, Math.max(0, d - 0.5)));
    if (this.isBuffered(t)) { this.v.currentTime = t; return Promise.resolve(); }
    return this.open(t);
  };

  Player.prototype.destroy = function () {
    this.dead = true;
    if (this.timer) clearInterval(this.timer);
    var v = this.v;
    try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) {}
    try { if (this.url) URL.revokeObjectURL(this.url); } catch (e) {}
    this.tracks = []; this.ms = null; this.url = null;
  };

  // 探测一个流地址是否可取（403 之类直接换下一个编码）
  function probe(stream) { return fetchAny(stream, 0, 1023).then(function () { return true; }, function () { return false; }); }


  // ---------- 直播：HLS(fmp4) → MSE ----------
  // 直播流是一个不断更新的 m3u8：#EXT-X-MAP 是 init 段，后面是 .m4s 分段（音视频已合在一起）。
  // 自己轮询列表、顺序追加到一个 SourceBuffer，不依赖电视是否原生支持 HLS。
  var LIVE_CODECS = ['avc1.640028,mp4a.40.2', 'avc1.64001f,mp4a.40.2', 'avc1.4d401f,mp4a.40.2', 'hvc1.1.6.L120.90,mp4a.40.2', 'hev1.1.6.L120.90,mp4a.40.2'];
  function absUrl(base, u) { try { return new URL(u, base).href; } catch (e) { return u; } }
  function parseM3u8(text, base) {
    var lines = text.split('\n').map(function (x) { return x.trim(); }), seq = 0, init = null, segs = [], dur = 0, target = 2;
    lines.forEach(function (l) {
      var m;
      if ((m = /^#EXT-X-MEDIA-SEQUENCE:(\d+)/.exec(l))) seq = Number(m[1]);
      else if ((m = /^#EXT-X-TARGETDURATION:(\d+)/.exec(l))) target = Number(m[1]);
      else if ((m = /^#EXT-X-MAP:URI="([^"]+)"/.exec(l))) init = absUrl(base, m[1]);
      else if ((m = /^#EXTINF:([\d.]+)/.exec(l))) dur = Number(m[1]);
      else if (l && l.charAt(0) !== '#') { segs.push({ seq: seq + segs.length, url: absUrl(base, l), dur: dur }); }
    });
    return { init: init, segs: segs, target: target };
  }
  function LivePlayer(video, hooks) { this.v = video; this.hooks = hooks || {}; this.dead = false; this.last = -1; this.sb = null; this.ms = null; this.url = null; this.codec = ''; }
  // urls: 同一路流的候选 m3u8 地址（取第一个能用的）
  LivePlayer.prototype.load = function (m3u8) {
    var self = this, v = this.v;
    this.m3u8 = m3u8;
    return fetch(m3u8, { referrerPolicy: 'no-referrer' }).then(function (r) { if (!r.ok) throw new Error('m3u8 HTTP ' + r.status); return r.text(); }).then(function (t) {
      var pl = parseM3u8(t, m3u8);
      if (!pl.init || !pl.segs.length) throw new Error('不是 fmp4 直播流');
      var mime = null;
      for (var i = 0; i < LIVE_CODECS.length; i++) { var m = 'video/mp4; codecs="' + LIVE_CODECS[i] + '"'; if (MediaSource.isTypeSupported(m)) { mime = m; break; } }
      if (!mime) throw new Error('电视不支持这路直播的编码');
      self.ms = new MediaSource(); self.url = URL.createObjectURL(self.ms); v.src = self.url;
      return new Promise(function (res) { self.ms.addEventListener('sourceopen', res, { once: true }); }).then(function () {
        self.sb = self.ms.addSourceBuffer(mime);
        self.pl = pl;
        return fetchRange(pl.init, 0, 4 * 1024 * 1024 - 1).catch(function () { return fetch(pl.init, { referrerPolicy: 'no-referrer' }).then(function (r) { return r.arrayBuffer(); }); });
      }).then(function (initBuf) {
        return self.appendBuf(initBuf).then(function () {
          // 从最近 3 个分段开始，贴近直播最新位置
          self.last = Math.max(pl.segs[0].seq - 1, pl.segs[pl.segs.length - 1].seq - 3);
          self.loop();
          return v.play().catch(function () { v.muted = true; return v.play(); });
        });
      });
    });
  };
  LivePlayer.prototype.appendBuf = function (buf) {
    var sb = this.sb;
    return new Promise(function (res, rej) {
      function ok() { sb.removeEventListener('error', bad); res(); }
      function bad() { sb.removeEventListener('updateend', ok); rej(new Error('SourceBuffer error')); }
      sb.addEventListener('updateend', ok, { once: true }); sb.addEventListener('error', bad, { once: true });
      try { sb.appendBuffer(buf); } catch (e) { sb.removeEventListener('updateend', ok); sb.removeEventListener('error', bad); rej(e); }
    });
  };
  // 轮询列表 → 把没追加过的分段按顺序追加；落后太多就跳到最新；清掉很久以前的缓冲
  LivePlayer.prototype.loop = function () {
    var self = this, v = this.v;
    if (this.dead) return;
    var wait = 1000;
    fetch(this.m3u8, { referrerPolicy: 'no-referrer' }).then(function (r) { if (!r.ok) throw new Error('m3u8 HTTP ' + r.status); return r.text(); }).then(function (t) {
      var pl = parseM3u8(t, self.m3u8), jobs = Promise.resolve();
      wait = Math.max(500, pl.target * 500);
      pl.segs.filter(function (x) { return x.seq > self.last; }).forEach(function (x) {
        jobs = jobs.then(function () {
          if (self.dead) return;
          return fetch(x.url, { referrerPolicy: 'no-referrer' }).then(function (r) { if (!r.ok) throw new Error('seg HTTP ' + r.status); return r.arrayBuffer(); }).then(function (b) { return self.appendBuf(b); }).then(function () { self.last = x.seq; self.fails = 0; });
        });
      });
      return jobs;
    }).then(function () {
      if (self.dead) return;
      var b = v.buffered;
      if (b.length) {
        var end = b.end(b.length - 1);
        if (v.currentTime < b.start(0) - 0.1 || v.currentTime < end - 8) v.currentTime = Math.max(b.start(b.length - 1), end - 2);  // 追到直播最新处
        if (v.currentTime - b.start(0) > 40 && !self.sb.updating) { try { self.sb.remove(b.start(0), v.currentTime - 20); } catch (e) {} }
      }
    }).catch(function (e) {
      self.fails = (self.fails || 0) + 1;
      U.diag('live.loopfail', e && e.message);
      if (self.fails >= 5 && self.hooks.onError) self.hooks.onError(e);
    }).then(function () { if (!self.dead) self.timer = setTimeout(function () { self.loop(); }, wait); });
  };
  LivePlayer.prototype.destroy = function () {
    this.dead = true; clearTimeout(this.timer);
    var v = this.v; try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) {}
    try { if (this.url) URL.revokeObjectURL(this.url); } catch (e) {}
  };
  window.LivePlayer = LivePlayer;

  window.DashPlayer = Player;
  window.DashProbe = probe;
})();
