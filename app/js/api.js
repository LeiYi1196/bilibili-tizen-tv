// B 站接口层。所有会随 B 站改动而失效的东西（WBI 签名、字段名）都集中在这个文件，坏了只改这里。
(function () {
  var CFG = window.BILI_CFG, U = window.U;
  var MIXIN = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];

  // 电视应用不发 Referer；API 请求统一 no-referrer，凭据由 CFG.credentials 决定
  // ---------- hub 模式：账号由 NAS 上的 bili-hub 代管 ----------
  // 开启后所有 B 站请求改发给 hub，由它补当前账号的 Cookie；电视不再自己保存登录态。
  var hub = { on: false, base: '', key: '', acct: '' };
  function hubHeaders() {
    var h = {};
    if (hub.on) { if (hub.key) h['X-Hub-Key'] = hub.key; h['X-Acct'] = hub.acct || 'anon'; }
    return h;
  }
  function useHub(base, key) {
    hub.on = true; hub.base = base.replace(/\/$/, ''); hub.key = key || '';
    CFG.api = hub.base + '/api'; CFG.live = hub.base + '/live'; CFG.credentials = 'omit';
    try { hub.acct = localStorage.getItem('bili.acct') || ''; } catch (e) {}
  }
  function useDirect() {
    hub.on = false; var d = window.BILI_CFG_DIRECT; CFG.api = d.api; CFG.live = d.live; CFG.credentials = d.credentials;
  }
  function setAcct(mid) { hub.acct = mid || ''; try { localStorage.setItem('bili.acct', hub.acct); } catch (e) {} }
  function hubGet(path, opt) { return req(hub.base + path, opt || {}); }
  function hubProbe() { // 3 秒内能连上才算可用，连不上就退回电视自己登录
    var ac = new AbortController(), t = setTimeout(function () { ac.abort(); }, 3000);
    return fetch(hub.base + '/hub/ping', { signal: ac.signal, referrerPolicy: 'no-referrer' }).then(function (r) { clearTimeout(t); return r.ok; }, function () { clearTimeout(t); return false; });
  }
  function hubAccounts() { return hubGet('/hub/accounts').then(function (j) { return ok(j, 'accounts'); }); }
  function hubDelete(mid) { return hubGet('/hub/accounts/delete?mid=' + encodeURIComponent(mid), { method: 'POST' }).then(function (j) { return ok(j, 'delete'); }); }

  function req(url, opt) {
    // 15 秒超时：电视网络偶尔会让请求一直挂着，不能让界面跟着卡死
    var ac = new AbortController(), t = setTimeout(function () { ac.abort(); }, 15000);
    var o = { credentials: CFG.credentials, referrerPolicy: 'no-referrer', signal: ac.signal, headers: hubHeaders() };
    for (var k in opt) o[k] = opt[k];
    if (opt && opt.headers) { var hh = hubHeaders(); for (var h in opt.headers) hh[h] = opt.headers[h]; o.headers = hh; }
    return fetch(url, o).then(function (r) { return r.json(); }).then(function (j) { clearTimeout(t); return j; }, function (e) { clearTimeout(t); throw e; });
  }

  // ---------- WBI 签名 ----------
  var wbiKey = null, wbiAt = 0;
  function getWbiKey() {
    if (wbiKey && Date.now() - wbiAt < 3600e3) return Promise.resolve(wbiKey);
    return req(CFG.api + '/x/web-interface/nav').then(function (j) {
      var base = function (u) { return u.slice(u.lastIndexOf('/') + 1, u.lastIndexOf('.')); };
      var raw = base(j.data.wbi_img.img_url) + base(j.data.wbi_img.sub_url);
      wbiKey = MIXIN.map(function (i) { return raw[i]; }).join('').slice(0, 32);
      wbiAt = Date.now();
      return wbiKey;
    });
  }
  function signed(params) {
    return getWbiKey().then(function (key) {
      var p = {}; for (var k in params) p[k] = params[k];
      p.wts = Math.floor(Date.now() / 1000);
      var q = Object.keys(p).sort().map(function (k) {
        return encodeURIComponent(k) + '=' + encodeURIComponent(String(p[k]).replace(/[!'()*]/g, ''));
      }).join('&');
      return q + '&w_rid=' + md5(q + key);
    });
  }
  function wbiGet(path, params) {
    return signed(params).then(function (q) { return req(CFG.api + path + '?' + q); });
  }
  function ok(j, what) {
    if (!j || j.code !== 0) { var e = new Error(what + ' code=' + (j && j.code) + ' ' + (j && j.message)); e.code = j && j.code; throw e; }
    return j.data;
  }

  // ---------- 卡片归一化 ----------
  function card(o) { return { bvid: o.bvid, cid: o.cid || 0, title: U.stripHtml(o.title), pic: o.pic, author: o.author || '', view: o.view, dur: o.dur || 0, progress: o.progress || 0, epid: o.epid || 0, roomid: o.roomid || 0, viewText: o.viewText || '', aid: o.aid || 0 }; }

  // ---------- 内容列表 ----------
  var recIdx = 0;
  function recommend(reset) {
    if (reset) recIdx = 0;
    recIdx++;
    return wbiGet('/x/web-interface/wbi/index/top/feed/rcmd', { ps: 20, fresh_idx: recIdx, fresh_idx_1h: recIdx }).then(function (j) {
      return ok(j, 'rcmd').item.filter(function (x) { return x.goto === 'av' && x.bvid; }).map(function (x) {
        return card({ bvid: x.bvid, cid: x.cid, title: x.title, pic: x.pic, author: x.owner && x.owner.name, view: x.stat && x.stat.view, dur: x.duration });
      });
    });
  }
  function popular(page) {
    return req(CFG.api + '/x/web-interface/popular?ps=20&pn=' + page).then(function (j) {
      return ok(j, 'popular').list.map(function (x) {
        var ep = /bangumi\/play\/ep(\d+)/.exec(x.redirect_url || '');
        return card({ bvid: x.bvid, cid: x.cid, title: x.title, pic: x.pic, author: x.owner && x.owner.name, view: x.stat && x.stat.view, dur: x.duration, epid: ep ? Number(ep[1]) : 0 });
      });
    });
  }
  // 历史：游标分页，cursor 为上一页返回的 {max, view_at, business}
  function history(cursor) {
    var q = '?ps=20&type=archive' + (cursor ? '&max=' + cursor.max + '&view_at=' + cursor.view_at + '&business=' + cursor.business : '');
    return req(CFG.api + '/x/web-interface/history/cursor' + q).then(function (j) {
      var d = ok(j, 'history');
      return {
        cursor: d.cursor, items: d.list.filter(function (x) { return x.history && x.history.bvid; }).map(function (x) {
          return card({ bvid: x.history.bvid, cid: x.history.cid, title: x.title, pic: x.cover, author: x.author_name, dur: x.duration, progress: x.progress < 0 ? x.duration : x.progress });
        })
      };
    });
  }
  function search(keyword, page) {
    return wbiGet('/x/web-interface/wbi/search/type', { search_type: 'video', keyword: keyword, page: page }).then(function (j) {
      var d = ok(j, 'search');
      return (d.result || []).map(function (x) {
        return card({ bvid: x.bvid, cid: 0, title: x.title, pic: x.pic, author: x.author, view: x.play, dur: U.parseDur(x.duration) });
      });
    });
  }
  function hotwords() {
    return req(CFG.api + '/x/web-interface/search/square?limit=12').then(function (j) {
      var d = ok(j, 'hot'); return (d.trending && d.trending.list || []).map(function (x) { return x.keyword; });
    }).catch(function () { return []; });
  }
  function view(bvid) {
    return req(CFG.api + '/x/web-interface/view?bvid=' + bvid).then(function (j) { return ok(j, 'view'); });
  }

  // ---------- 取流 ----------
  function playurl(bvid, cid, qn) {
    return wbiGet('/x/player/wbi/playurl', { bvid: bvid, cid: cid, qn: qn, fnval: 4048, fnver: 0, fourk: 1 }).then(function (j) { return ok(j, 'playurl'); });
  }
  function lastPlayTime(bvid, cid) {
    return wbiGet('/x/player/wbi/v2', { bvid: bvid, cid: cid }).then(function (j) { return j.code === 0 ? (j.data.last_play_time || 0) / 1000 : 0; }).catch(function () { return 0; });
  }
  // 上报进度 → 手机上也能看到历史 / 续播。csrf 就是登录时拿到的 bili_jct。
  // kind: 1=播放中 2=暂停 4=结束。结果写进诊断（只记 code / message，不含令牌），方便远程排查“历史没同步”
  var aidCache = {};
  function aidOf(bvid) {
    if (aidCache[bvid]) return Promise.resolve(aidCache[bvid]);
    return view(bvid).then(function (d) { aidCache[bvid] = d.aid; return d.aid; }).catch(function () { return 0; });
  }
  var hbLast = 0;
  function heartbeat(bvid, cid, sec, kind, dur) {
    var a = auth() || {};   // 实测：接口只靠 Cookie 认证，没有 csrf 也能写进历史；有就带上
    return aidOf(bvid).then(function (aid) {
      var f = { bvid: bvid, cid: cid, played_time: Math.floor(sec), real_played_time: Math.floor(sec), realtime: Math.floor(sec),
                start_ts: Math.floor(Date.now() / 1000 - sec), type: 3, dt: 2, play_type: kind || 1, auto_continued_play: 0,
                video_duration: Math.floor(dur || 0), last_play_progress_time: Math.floor(sec), max_play_progress_time: Math.floor(sec),
                spmid: '333.788.0.0', from_spmid: '' };
      if (a.csrf) f.csrf = a.csrf;
      if (aid) f.aid = aid;
      if (a.mid && a.mid !== 'dev') f.mid = a.mid;
      return fetch(CFG.api + '/x/click-interface/web/heartbeat', { method: 'POST', body: new URLSearchParams(f), credentials: CFG.credentials, referrerPolicy: 'no-referrer', headers: hubHeaders() });
    }).then(function (r) { return r.json(); }).then(function (j) {
      U.diag('hb', 'code=' + j.code + ' ' + (j.message || '') + ' t=' + Math.floor(sec) + ' kind=' + (kind || 1));
      return j;
    }).catch(function (e) { U.diag('hb.err', e && e.message); });
  }

  // ---------- 关注动态（只取视频投稿）----------
  // 分页靠 offset：上一页返回的 offset 原样带上；has_more=false 就到头了
  function dynamics(offset) {
    var q = new URLSearchParams({ type: 'video', timezone_offset: -480, platform: 'web', features: 'itemOpusStyle' });
    if (offset) q.set('offset', offset);
    return req(CFG.api + '/x/polymer/web-dynamic/v1/feed/all?' + q).then(function (j) {
      var d = ok(j, 'dynamic'), items = [];
      (d.items || []).forEach(function (it) {
        var m = it.modules || {}, a = m.module_dynamic && m.module_dynamic.major && m.module_dynamic.major.archive;
        if (!a || !a.bvid) return;
        items.push(card({ bvid: a.bvid, cid: 0, title: a.title, pic: a.cover, author: m.module_author && m.module_author.name, viewText: a.stat && a.stat.play, dur: U.parseDur(a.duration_text) }));
      });
      return { items: items, offset: d.offset, more: !!d.has_more };
    });
  }

  // ---------- 收藏夹 ----------
  function favFolders(aid) {
    var a = auth(); var mid = hub.on ? hub.acct : (a && a.mid && a.mid !== 'dev' ? a.mid : null);
    var p = mid ? Promise.resolve(mid) : me().then(function (m) { return m && m.mid; });
    return p.then(function (mid) {
      if (!mid) throw new Error('未登录');
      return req(CFG.api + '/x/v3/fav/folder/created/list-all?up_mid=' + mid + (aid ? '&rid=' + aid + '&type=2' : ''));
    }).then(function (j) {
      return (ok(j, 'fav').list || []).map(function (f) { return { id: f.id, title: f.title, count: f.media_count, priv: (f.attr & 1) === 1, faved: f.fav_state === 1 }; });
    });
  }
  function favItems(id, page) {
    return req(CFG.api + '/x/v3/fav/resource/list?media_id=' + id + '&pn=' + page + '&ps=20&platform=web').then(function (j) {
      var d = ok(j, 'favlist');
      return (d.medias || []).filter(function (x) { x.bvid = x.bvid || x.bv_id; return x.bvid && x.attr !== 9 && x.title !== '已失效视频'; }).map(function (x) {
        return card({ bvid: x.bvid, cid: x.ugc && x.ugc.first_cid || 0, title: x.title, pic: x.cover, author: x.upper && x.upper.name, view: x.cnt_info && x.cnt_info.play, dur: x.duration, aid: x.id });
      });
    });
  }


  // ---------- 写操作：收藏夹管理 / 收藏视频 ----------
  function post(path, fields) {
    var a = auth(), f = {}; for (var k in fields) f[k] = fields[k];
    if (a && a.csrf) f.csrf = a.csrf;
    return req(CFG.api + path, { method: 'POST', body: new URLSearchParams(f), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }).then(function (j) { return ok(j, path); });
  }
  function favCreate(title, priv) { return post('/x/v3/fav/folder/add', { title: title, intro: '', privacy: priv ? 1 : 0 }); }
  // 改名 / 改公开状态：B 站的 edit 接口不带 privacy 会把私密夹变成公开，所以先读当前状态再提交
  function favEdit(f, patch) {
    return req(CFG.api + '/x/v3/fav/folder/info?media_id=' + f.id).then(function (j) {
      var d = ok(j, 'favinfo');
      var priv = patch.priv != null ? patch.priv : (d.attr & 1) === 1;
      return post('/x/v3/fav/folder/edit', { media_id: f.id, title: patch.title != null ? patch.title : d.title, intro: d.intro || '', privacy: priv ? 1 : 0 });
    });
  }
  function favDelete(id) { return post('/x/v3/fav/folder/del', { media_ids: id }); }
  // 把视频加进 / 移出若干收藏夹（id 用逗号连接）
  function favDeal(aid, addIds, delIds) { return post('/x/v3/fav/resource/deal', { rid: aid, type: 2, add_media_ids: addIds || '', del_media_ids: delIds || '' }); }

  // ---------- UP 主 ----------
  function upCard(mid) {
    return req(CFG.api + '/x/web-interface/card?mid=' + mid + '&photo=false').then(function (j) {
      var d = ok(j, 'upcard'), c = d.card || {};
      return { mid: mid, name: c.name, face: c.face, fans: d.follower != null ? d.follower : c.fans, sign: c.sign || '', following: !!d.following };
    });
  }
  function upVideos(mid, page) {
    return wbiGet('/x/space/wbi/arc/search', { mid: mid, ps: 20, pn: page, order: 'pubdate', platform: 'web', web_location: 1550101 }).then(function (j) {
      return ((ok(j, 'upvideos').list || {}).vlist || []).map(function (x) {
        return card({ bvid: x.bvid, cid: 0, title: x.title, pic: x.pic, author: x.author, view: x.play, dur: U.parseDur(x.length), aid: x.aid });
      });
    });
  }

  // ---------- 直播 ----------
  function liveReq(url) { return req(url); }
  function liveCard(x) {
    return card({ bvid: '', title: x.title, pic: x.cover || x.user_cover || x.room_cover || x.face, author: x.uname, viewText: x.online != null ? U.fmtCount(x.online) + '人气' : (x.text_small || ''), roomid: x.roomid || x.room_id });
  }
  // 推荐：每次请求给一批新的（没有真正的分页）
  function liveRecommend() {
    return liveReq(CFG.live + '/xlive/web-interface/v1/webMain/getMoreRecList?platform=web').then(function (j) {
      return (ok(j, 'live').recommend_room_list || []).map(liveCard);
    });
  }
  function liveFollowing(page) {
    return liveReq(CFG.live + '/xlive/web-ucenter/v1/xfetter/GetWebList?page=' + page + '&page_size=20').then(function (j) {
      return (ok(j, 'livefollow').list || []).filter(function (x) { return x.live_status === 1 || x.live_status == null; }).map(liveCard);
    });
  }
  // 直播取流：优先 HLS(fmp4) → HLS(ts)，电视的 <video> 原生播放；地址里已含鉴权，不需要 Referer
  function liveStream(roomid) {
    var q = new URLSearchParams({ room_id: roomid, protocol: '0,1', format: '0,1,2', codec: '0,1', qn: 10000, platform: 'web', ptype: 8, dolby: 5, panorama: 1 });
    return liveReq(CFG.live + '/xlive/web-room/v2/index/getRoomPlayInfo?' + q).then(function (j) {
      var d = ok(j, 'liveplay');
      if (d.live_status !== 1) throw new Error('主播未在直播');
      var out = [];
      ((d.playurl_info && d.playurl_info.playurl && d.playurl_info.playurl.stream) || []).forEach(function (s) {
        s.format.forEach(function (f) {
          f.codec.forEach(function (c) {
            c.url_info.forEach(function (u) { out.push({ proto: s.protocol_name, format: f.format_name, codec: c.codec_name, qn: c.current_qn, url: u.host + c.base_url + u.extra }); });
          });
        });
      });
      var rank = function (x) { return (x.format === 'fmp4' ? 0 : x.format === 'ts' ? 10 : 100) + (x.codec === 'avc' ? 0 : 1); };
      out = out.filter(function (x) { return x.proto === 'http_hls'; }).sort(function (a, b) { return rank(a) - rank(b); });
      if (!out.length) throw new Error('没有可用的直播流');
      return out;
    });
  }

  // ---------- 字幕（B 站自动生成的 AI 字幕也在这里）----------
  function subtitles(bvid, cid) {
    return wbiGet('/x/player/wbi/v2', { bvid: bvid, cid: cid }).then(function (j) {
      if (j.code !== 0) return [];
      return ((j.data.subtitle && j.data.subtitle.subtitles) || []).map(function (x) {
        return { lan: x.lan, doc: x.lan_doc, url: String(x.subtitle_url).replace(/^\/\//, 'https://').replace(/^http:/, 'https:') };
      });
    }).catch(function () { return []; });
  }
  function subtitleBody(url) {
    return fetch(url, { referrerPolicy: 'no-referrer' }).then(function (r) { return r.json(); }).then(function (j) { return (j.body || []).sort(function (a, b) { return a.from - b.from; }); });
  }

  // ---------- 番剧 / 影视（PGC）----------
  function pgcPlay(epid, qn) {
    return req(CFG.api + '/pgc/player/web/playurl?ep_id=' + epid + '&qn=' + qn + '&fnval=4048&fourk=1').then(function (j) {
      if (j.code !== 0) { var e = new Error('pgc code=' + j.code + ' ' + j.message); e.code = j.code; throw e; }
      var r = j.result || {}, v = r.video_info || r;
      // 大会员专享的集只给几十秒预览（is_preview=1、没有 dash）
      if (r.is_preview && !v.dash) throw new Error('这一集需要大会员');
      if (!v.dash) throw new Error('取不到番剧流');
      v.accept_quality = v.accept_quality || r.accept_quality; v.accept_description = v.accept_description || r.accept_description;
      return v;
    });
  }
  function pgcSeason(epid) {
    return req(CFG.api + '/pgc/view/web/season?ep_id=' + epid).then(function (j) {
      var d = ok(j, 'season') || j.result;
      return { title: d.title, episodes: (d.episodes || []).map(function (e) { return { epid: e.id || e.ep_id, bvid: e.bvid, cid: e.cid, title: (e.title ? e.title + ' ' : '') + (e.long_title || ''), pic: e.cover }; }) };
    });
  }
  // 统一取流入口：番剧走 PGC，其余走普通接口
  function playData(it, qn) { return it.epid ? pgcPlay(it.epid, qn) : playurl(it.bvid, it.cid, qn); }

  // ---------- 登录 ----------
  function auth() { try { return JSON.parse(localStorage.getItem('bili.auth') || 'null'); } catch (e) { return null; } }
  function setAuth(a) { try { if (a) localStorage.setItem('bili.auth', JSON.stringify(a)); else localStorage.removeItem('bili.auth'); } catch (e) {} }
  // 取 buvid3/4 等基础 Cookie，降低风控概率
  function warmup() { return req(CFG.api + '/x/frontend/finger/spi').catch(function () {}); }
  function meStrict() { return req(CFG.api + '/x/web-interface/nav').then(function (j) { return j.code === 0 && j.data.isLogin ? { mid: j.data.mid, name: j.data.uname, face: j.data.face, vip: j.data.vipStatus } : null; }); }
  function me() { return req(CFG.api + '/x/web-interface/nav').then(function (j) { return j.code === 0 && j.data.isLogin ? { mid: j.data.mid, name: j.data.uname, face: j.data.face, vip: j.data.vipStatus } : null; }).catch(function () { return null; }); }
  function qrGenerate() {
    if (hub.on) return hubGet('/hub/qr/generate', { method: 'POST' }).then(function (j) { return ok(j, 'qr'); });
    return req(CFG.passport + '/x/passport-login/web/qrcode/generate').then(function (j) { return ok(j, 'qr'); });
  }
  function qrPoll(key) {
    if (hub.on) return hubGet('/hub/qr/poll?qrcode_key=' + key).then(function (j) { var d = ok(j, 'qrpoll'); if (d.code === 0 && d.mid) setAcct(d.mid); return d; });
    return req(CFG.passport + '/x/passport-login/web/qrcode/poll?qrcode_key=' + key).then(function (j) {
      var d = ok(j, 'qrpoll');
      if (d.code === 0 && d.url) {
        // 成功时 data.url 的查询串带着 DedeUserID / bili_jct 等；Cookie 本身由浏览器保存
        var q = new URLSearchParams(d.url.split('?')[1] || '');
        setAuth({ mid: q.get('DedeUserID'), csrf: q.get('bili_jct'), at: Date.now() });
      }
      return d;
    });
  }
  // 开发代理模式：csrf 从代理拿
  function devSession() {
    if (!CFG.dev) return Promise.resolve();
    return fetch('http://127.0.0.1:8787/dev/session').then(function (r) { return r.json(); }).then(function (s) { setAuth({ mid: 'dev', csrf: s.csrf, at: Date.now() }); }).catch(function () {});
  }

  window.API = {
    recommend: recommend, popular: popular, history: history, search: search, hotwords: hotwords, view: view,
    playurl: playurl, lastPlayTime: lastPlayTime, heartbeat: heartbeat,
    dynamics: dynamics, favFolders: favFolders, favItems: favItems, favCreate: favCreate, favEdit: favEdit, favDelete: favDelete, favDeal: favDeal, upCard: upCard, upVideos: upVideos, liveRecommend: liveRecommend, liveFollowing: liveFollowing, liveStream: liveStream,
    subtitles: subtitles, subtitleBody: subtitleBody, pgcSeason: pgcSeason, playData: playData,
    hub: hub, useHub: useHub, useDirect: useDirect, setAcct: setAcct, hubProbe: hubProbe, hubAccounts: hubAccounts, hubDelete: hubDelete,
    auth: auth, setAuth: setAuth, warmup: warmup, me: me, meStrict: meStrict, qrGenerate: qrGenerate, qrPoll: qrPoll, devSession: devSession
  };
})();
