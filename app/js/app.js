// 界面与流程：屏幕栈 + 空间焦点导航（遥控器方向键）。
(function () {
  var CFG = window.BILI_CFG, U = window.U, API = window.API, el = U.el;
  var root = document.getElementById('app');
  var stack = [];            // 屏幕栈，栈顶是当前屏幕
  var focusEl = null;        // 当前焦点元素（自己管理，不用浏览器焦点）

  // 遥控器键码（Tizen TV）
  var K = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, OK: 13, BACK: 10009, ESC: 27, BS: 8,
            PLAY: 415, PAUSE: 19, PLAYPAUSE: 10252, STOP: 413, FF: 417, RW: 412, CHUP: 427, CHDOWN: 428,
            RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406 };

  function store(k, v) { try { if (v === undefined) return localStorage.getItem('bili.' + k); localStorage.setItem('bili.' + k, v); } catch (e) {} return null; }

  // ---------- 提示 ----------
  var toastTimer = null;
  function toast(msg, ms) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.style.display = 'block';
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.style.display = 'none'; }, ms || 2500);
  }

  // ---------- 屏幕栈 ----------
  function cur() { return stack[stack.length - 1]; }
  function push(scr) {
    var old = cur();
    if (old) { old.root.style.display = 'none'; old.saved = focusEl; if (old.onHide) old.onHide(); }
    stack.push(scr);
    root.appendChild(scr.root);
    if (scr.onShow) scr.onShow();
    var first = scr.initialFocus ? scr.initialFocus() : scr.root.querySelector('.f');
    setFocus(first);
  }
  function pop() {
    var old = stack.pop();
    if (old) { if (old.onClose) old.onClose(); root.removeChild(old.root); }
    var now = cur();
    if (!now) { exitApp(); return; }
    now.root.style.display = '';
    if (now.onShow) now.onShow();
    setFocus(now.saved && now.root.contains(now.saved) ? now.saved : now.root.querySelector('.f'));
  }
  function replaceTop(scr) { var old = stack.pop(); if (old) { if (old.onClose) old.onClose(); root.removeChild(old.root); } push(scr); }
  function resetStack(scr) { while (stack.length) { var o = stack.pop(); if (o.onClose) o.onClose(); root.removeChild(o.root); } focusEl = null; push(scr); }
  function exitApp() { try { tizen.application.getCurrentApplication().exit(); } catch (e) { toast('已到最顶层'); } }

  // ---------- 空间焦点导航 ----------
  function setFocus(e) {
    if (focusEl) focusEl.classList.remove('on');
    focusEl = e || null;
    if (!e) return;
    e.classList.add('on');
    try { e.scrollIntoView({ block: e.dataset.scroll || 'center', inline: e.dataset.inline || 'nearest' }); } catch (x) {}
    if (cur() && cur().onFocus) cur().onFocus(e);
  }
  function focusables() {
    var s = cur(); if (!s) return [];
    return Array.prototype.filter.call(s.root.querySelectorAll('.f'), function (e) { return e.offsetParent !== null; });
  }
  // 在指定方向上找最近的可聚焦元素：主轴距离 + 2×副轴偏移
  function move(dir) {
    if (!focusEl) { setFocus(focusables()[0]); return; }
    var a = focusEl.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2, best = null, bs = 1e9;
    focusables().forEach(function (e) {
      if (e === focusEl) return;
      var b = e.getBoundingClientRect(), bx = b.left + b.width / 2, by = b.top + b.height / 2, dx = bx - ax, dy = by - ay, main, off;
      if (dir === 'left') { if (dx >= -4) return; main = -dx; off = Math.abs(dy); }
      else if (dir === 'right') { if (dx <= 4) return; main = dx; off = Math.abs(dy); }
      else if (dir === 'up') { if (dy >= -4) return; main = -dy; off = Math.abs(dx); }
      else { if (dy <= 4) return; main = dy; off = Math.abs(dx); }
      var s = main + off * 2;
      if (s < bs) { bs = s; best = e; }
    });
    if (best) setFocus(best);
  }

  // ---------- 卡片 / 网格 ----------
  function makeCard(c) {
    var d = el('div', 'card f');
    var p = el('div', 'pic'), im = new Image();
    im.referrerPolicy = 'no-referrer';   // B 站图片 CDN 只接受无 Referer / B 站 Referer
    var src = U.pic(c.pic, 424, 238);
    im.onerror = function () { if (c.pic) { im.onerror = null; im.src = U.pic(c.pic, 0, 0).replace(/@.*$/, ''); } };
    im.src = src; p.appendChild(im);
    if (c.roomid) p.appendChild(el('div', 'badge live', '直播'));
    else if (c.dur) p.appendChild(el('div', 'badge', U.fmtTime(c.dur)));
    if (c.progress && c.dur) { var pr = el('div', 'prog'); pr.style.width = Math.min(100, c.progress / c.dur * 100) + '%'; p.appendChild(pr); }
    d.appendChild(p);
    d.appendChild(el('div', 't', c.title));
    var views = c.roomid ? c.viewText : c.view != null ? U.fmtCount(c.view) + '播放' : c.viewText ? c.viewText + '播放' : '';
    d.appendChild(el('div', 'm', [c.author, views].filter(Boolean).join(' · ')));
    d.card = c;
    return d;
  }

  // 一个可无限加载的网格。loader(page) → Promise<cards[]>；emptyText = 没内容时的提示
  function makeFeed(loader, emptyText) {
    var wrap = el('div', 'grid-wrap'), grid = el('div', 'grid');
    wrap.appendChild(grid);
    var st = { page: 0, loading: false, end: false, token: 0 };
    function more() {
      if (st.loading || st.end) return Promise.resolve();
      st.loading = true; var my = st.token; st.page++;
      return loader(st.page).then(function (items) {
        if (my !== st.token) return;
        if (!items || !items.length) { st.end = true; if (!grid.children.length) grid.appendChild(el('div', 'empty', emptyText || '这里还没有内容')); return; }
        items.forEach(function (c) { grid.appendChild(makeCard(c)); });
      }).catch(function (e) {
        U.diag('feed.error', e && e.message); toast('加载失败：' + (e && e.message));
        if (my === st.token) st.end = true;
      }).then(function () { st.loading = false; });
    }
    function reload() { st.token++; st.page = 0; st.end = false; st.loading = false; grid.innerHTML = ''; return more(); }
    // 焦点到了倒数第二行就预取下一页
    function nearEnd(e) {
      var cs = grid.children, i = Array.prototype.indexOf.call(cs, e);
      if (i >= 0 && i >= cs.length - 8) more();
    }
    return { wrap: wrap, grid: grid, reload: reload, more: more, nearEnd: nearEnd };
  }

  // 顶上带一排“子分类”按钮（收藏夹 / 直播分类）的网格：焦点落在按钮上就切换下面的内容
  function makeChipFeed(loadChips, makeLoader, emptyText) {
    var wrap = el('div', 'grid-wrap'), bar = el('div', 'subbar');
    wrap.appendChild(bar);
    var o = { wrap: wrap, grid: null, inner: null, curId: null, cache: {}, chips: [] };
    o.select = function (id) {
      if (o.curId === id) return;
      o.curId = id;
      o.chips.forEach(function (c) { c.classList.toggle('cur', c.chipId === id); });
      if (o.inner && o.inner.wrap.parentNode) o.inner.wrap.parentNode.removeChild(o.inner.wrap);
      var f = o.cache[id] || (o.cache[id] = makeFeed(makeLoader(id), emptyText));
      f.wrap.style.top = '84px';
      wrap.appendChild(f.wrap);
      o.inner = f; o.grid = f.grid;
      if (!f.loaded) { f.loaded = true; f.reload(); }
    };
    // keepId：重新加载分类后仍停在这个分类上（比如改名之后）；缓存清掉，内容重新取
    o.reload = function (keepId) {
      return loadChips().then(function (chips) {
        bar.innerHTML = ''; o.chips = []; o.cache = {}; o.curId = null;
        if (o.inner && o.inner.wrap.parentNode) o.inner.wrap.parentNode.removeChild(o.inner.wrap);
        chips.forEach(function (c) {
          var b = el('div', 'chip f' + (c.priv ? ' priv' : ''), c.title); b.chipId = c.id; b.chipData = c; b.special = !!c.special;
          b.dataset.scroll = 'nearest'; b.dataset.inline = 'center'; bar.appendChild(b); o.chips.push(b);
        });
        var real = chips.filter(function (c) { return !c.special; });
        var pick = real.find(function (c) { return c.id === keepId; }) || real[0];
        if (pick) o.select(pick.id);
        else if (!chips.length) bar.appendChild(el('div', 'chip', '没有内容'));
      }).catch(function (e) { toast('加载失败：' + (e && e.message)); U.diag('chips.error', e && e.message); });
    };
    o.nearEnd = function (e) { if (o.inner) o.inner.nearEnd(e); };
    o.first = function () { return o.chips[0] || null; };
    return o;
  }

  // ---------- 登录屏 ----------
  function loginScreen(onDone, cancelText) {
    var s = { root: el('div', 'screen login') };
    s.root.appendChild(el('div', 'logo', 'bilibili'));
    var qr = el('div', 'qr'), st = el('div', 'st', '正在获取二维码…');
    s.root.appendChild(qr); s.root.appendChild(st);
    s.root.appendChild(el('div', '', '用手机 B 站 App 扫码，并在手机上点“确认登录”'));
    if (cancelText) s.root.appendChild(el('div', '', '扫另一个账号的码就能切换；电视同一时间保持一个账号登录'));
    var skip = el('div', 'btn f', cancelText || '先看看（未登录，最高 480P）');
    s.root.appendChild(skip);
    var alive = true, timer = null;
    s.onClose = function () { alive = false; clearTimeout(timer); };
    s.onKey = function (e) { if (e.keyCode === K.OK) { onDone(false); return true; } return false; };

    function poll(key) {
      if (!alive) return;
      API.qrPoll(key).then(function (d) {
        if (!alive) return;
        if (d.code === 0) {
          st.textContent = '登录成功，正在验证…';
          // 关键验证：浏览器是否真的保存并带上了 Cookie
          API.me().then(function (m) {
            U.diag('login.me', m ? 'logged-in' : 'NOT logged in after scan');
            if (m) { toast('欢迎 ' + m.name); onDone(true); }
            else { st.textContent = '登录通过，但 Cookie 没有生效（见诊断）。可先“看看”'; }
          });
          return;
        }
        if (d.code === 86038) { start(); return; }  // 二维码过期 → 重新生成
        st.textContent = d.code === 86090 ? '已扫码，请在手机上确认' : '等待扫码…';
        timer = setTimeout(function () { poll(key); }, 2000);
      }).catch(function (e) { U.diag('login.poll', e && e.message); timer = setTimeout(function () { poll(key); }, 3000); });
    }
    function start() {
      API.qrGenerate().then(function (d) {
        if (!alive) return;
        var q = qrcode(0, 'M'); q.addData(d.url); q.make();
        qr.innerHTML = q.createSvgTag({ cellSize: 6, margin: 0, scalable: true });
        st.textContent = '等待扫码…';
        poll(d.qrcode_key);
      }).catch(function (e) { st.textContent = '获取二维码失败：' + (e && e.message); U.diag('login.qr', e && e.message); timer = setTimeout(start, 4000); });
    }
    start();
    return s;
  }



  // ---------- 通用：输入框屏 / 选项屏 ----------
  function promptScreen(title, initial, onOk) {
    var s = { root: el('div', 'screen accts') };
    s.root.appendChild(el('div', 'logo', title));
    s.root.appendChild(el('div', 'meta', '按 OK 弹出输入法，输入完成后选“确定”'));
    var inp = el('input', 'f pin'); inp.value = initial || ''; inp.placeholder = '名称'; inp.dataset.scroll = 'nearest';
    var ok = el('div', 'btn f', '确定'), cancel = el('div', 'btn f', '取消');
    var row = el('div', 'prow'); row.appendChild(ok); row.appendChild(cancel);
    s.root.appendChild(inp); s.root.appendChild(row);
    s.initialFocus = function () { return inp; };
    s.onKey = function (e) {
      var k = e.keyCode;
      if (document.activeElement === inp) {                       // 正在输入：交给输入法
        if (k === K.OK || k === 65376) { inp.blur(); return true; }
        if (k === K.BACK || k === K.ESC || k === 65385) { inp.blur(); return true; }
        return 'pass';
      }
      if (k === K.OK && focusEl) {
        if (focusEl === inp) { inp.focus(); return true; }
        if (focusEl === cancel) { pop(); return true; }
        if (focusEl === ok) { var v = inp.value.trim(); if (!v) { toast('名称不能为空'); return true; } pop(); onOk(v); return true; }
      }
      return false;
    };
    return s;
  }
  // rows = [{text, val}]；选中后先退出本屏，再回调 onPick(row)
  function listScreen(title, rows, onPick) {
    var s = { root: el('div', 'screen accts') };
    s.root.appendChild(el('div', 'logo', title));
    var list = el('div', 'alist'); s.root.appendChild(list);
    rows.forEach(function (r) { var d = el('div', 'arow f', r.text); d.row = r; list.appendChild(d); });
    s.onKey = function (e) { if (e.keyCode === K.OK && focusEl && focusEl.row) { var r = focusEl.row; pop(); onPick(r); return true; } return false; };
    return s;
  }
  // UP 主页：头像 + 名字 + 粉丝 + 简介，下面是他的投稿（按发布时间）
  function upScreen(o) {
    var s = { root: el('div', 'screen') };
    var bar = el('div', 'upbar'), face = new Image(); face.className = 'face'; face.referrerPolicy = 'no-referrer'; face.src = U.pic(o.face, 120, 120);
    var info = el('div', 'upinfo'), name = el('div', 'upname', o.name || ''), sub = el('div', 'upsub', '加载中…');
    info.appendChild(name); info.appendChild(sub); bar.appendChild(face); bar.appendChild(info); s.root.appendChild(bar);
    var feed = makeFeed(function (p) { return API.upVideos(o.mid, p); }, '这位 UP 主还没有投稿');
    feed.wrap.style.top = '190px'; s.root.appendChild(feed.wrap);
    API.upCard(o.mid).then(function (c) {
      name.textContent = c.name || o.name; sub.textContent = U.fmtCount(c.fans) + ' 粉丝' + (c.sign ? '  ·  ' + c.sign : '');
      if (c.face) face.src = U.pic(c.face, 120, 120);
    }).catch(function () { sub.textContent = ''; });
    var started = false;
    s.onShow = function () { if (started) return; started = true; feed.reload().then(function () { var f = feed.grid.querySelector('.f'); if (f) setFocus(f); }); };
    s.initialFocus = function () { return null; };
    s.onFocus = function (e) { if (e.card) feed.nearEnd(e); };
    s.onKey = function (e) { if (e.keyCode === K.OK && focusEl && focusEl.card) { openCard(focusEl.card); return true; } return false; };
    return s;
  }

  // ---------- 账号管理（账号由 NAS 上的 bili-hub 代管）----------
  // 列出已保存的账号：OK 切换，黄键删除；最后一行“添加账号”扫码登录新账号
  function accountsScreen(me) {
    var s = { root: el('div', 'screen accts') };
    s.root.appendChild(el('div', 'logo', '账号'));
    s.root.appendChild(el('div', 'meta', '账号保存在家里的 NAS 上，这里可以随时切换。OK 切换，黄键删除'));
    var list = el('div', 'alist'); s.root.appendChild(list);
    function switchTo(mid) {
      API.setAcct(mid);
      API.me().then(function (m) { toast(m ? '已切换到 ' + m.name : '账号已失效，请重新扫码'); resetStack(homeScreen(m)); });
    }
    function render() {
      list.innerHTML = '';
      API.hubAccounts().then(function (accs) {
        accs.forEach(function (a) {
          var row = el('div', 'arow f', (a.mid === API.hub.acct || (!API.hub.acct && accs[0] === a) ? '● ' : '○ ') + a.name); row.acct = a; list.appendChild(row);
        });
        var add = el('div', 'arow f', '＋ 添加账号（扫码登录）'); add.add = true; list.appendChild(add);
        var anon = el('div', 'arow f', '先看看（不登录）'); anon.anon = true; list.appendChild(anon);
        setFocus(list.querySelector('.f'));
      }).catch(function (e) { list.appendChild(el('div', 'empty', '连不上账号服务：' + (e && e.message))); U.diag('accts.error', e && e.message); });
    }
    s.onShow = render;
    s.initialFocus = function () { return null; };
    s.onKey = function (e) {
      var k = e.keyCode;
      if (k === K.OK && focusEl) {
        if (focusEl.acct) { switchTo(focusEl.acct.mid); return true; }
        if (focusEl.anon) { API.setAcct('anon'); resetStack(homeScreen(null)); return true; }
        if (focusEl.add) {
          push(loginScreen(function (logged) {
            if (!logged) { pop(); return; }
            API.me().then(function (m) { toast('已添加并切换到 ' + (m && m.name)); resetStack(homeScreen(m)); });
          }, '取消（返回）'));
          return true;
        }
      }
      if ((k === K.YELLOW || k === 68) && focusEl && focusEl.acct) {   // 黄键 / D：删除这个账号
        var a = focusEl.acct;
        API.hubDelete(a.mid).then(function () { toast('已删除 ' + a.name); if (API.hub.acct === a.mid) API.setAcct(''); render(); });
        return true;
      }
      return false;
    };
    return s;
  }

  // ---------- 首页 ----------
  var TABS = [
    { id: 'rec', name: '推荐' }, { id: 'pop', name: '热门' }, { id: 'dyn', name: '动态' }, { id: 'live', name: '直播' },
    { id: 'fav', name: '收藏' }, { id: 'his', name: '历史' }, { id: 'sea', name: '搜索' }
  ];
  function homeScreen(me) {
    var s = { root: el('div', 'screen') };
    var top = el('div', 'top');
    top.appendChild(el('div', 'logo', 'bilibili'));
    var tabEls = TABS.map(function (t) { var e = el('div', 'tab f', t.name); e.dataset.tab = t.id; e.dataset.scroll = 'nearest'; top.appendChild(e); return e; });
    top.appendChild(el('div', 'spacer'));
    var acct = el('div', 'chip f', (me ? me.name : '未登录') + ' ▾'); acct.dataset.acct = '1'; acct.dataset.scroll = 'nearest';
    top.appendChild(acct);
    s.root.appendChild(top);

    var dynOffset = null, dynMore = true, liveSeen = {};
    var feeds = {
      rec: makeFeed(function (p) { return API.recommend(p === 1); }),
      pop: makeFeed(function (p) { return API.popular(p); }),
      dyn: makeFeed(function (p) {
        if (p === 1) { dynOffset = null; dynMore = true; }
        if (!dynMore) return Promise.resolve([]);
        return API.dynamics(dynOffset).then(function (r) { dynOffset = r.offset; dynMore = r.more; return r.items; });
      }, '还没有动态。在手机上关注几个 UP 主，他们的新视频就会出现在这里'),
      live: makeChipFeed(function () { return Promise.resolve([{ id: 'rec', title: '推荐' }, { id: 'fol', title: '我关注的' }]); }, function (id) {
        if (id === 'fol') return function (p) { return API.liveFollowing(p); };
        // 推荐没有分页，每次给一批新的，按房间号去重
        return function (p) {
          if (p === 1) liveSeen = {};
          return API.liveRecommend().then(function (list) { return list.filter(function (c) { if (liveSeen[c.roomid]) return false; liveSeen[c.roomid] = 1; return true; }); });
        };
      }, '现在没有直播内容（关注的主播都没开播）'),
      fav: makeChipFeed(function () { return API.favFolders().then(function (l) { return l.concat([{ id: '__new', title: '＋ 新建', special: true }]); }); }, function (id) { return function (p) { return API.favItems(id, p); }; }, '这个收藏夹是空的。在手机上收藏视频后会出现在这里'),
      his: (function () { var cursor = null; return makeFeed(function (p) { if (p === 1) cursor = null; return API.history(cursor).then(function (r) { cursor = r.cursor; return r.items; }); }); })()
    };

    // ----- 收藏夹管理（收藏页签里按黄键）-----
    function reloadFav(keepId) { return feeds.fav.reload(keepId); }
    function failToast(what) { return function (e) { toast(what + '失败：' + (e && e.message)); U.diag('fav.error', what + ' ' + (e && e.message)); }; }
    function createFolder() {
      push(promptScreen('新建收藏夹', '', function (name) {
        push(listScreen('“' + name + '”设为', [{ text: '公开', val: 0 }, { text: '私密', val: 1 }], function (r) {
          API.favCreate(name, r.val === 1).then(function (d) { toast('已创建 ' + name); reloadFav(d && d.id); }).catch(failToast('新建'));
        }));
      }));
    }
    function folderMenu(f) {
      push(listScreen(f.title + (f.priv ? '（私密）' : '（公开）'), [
        { text: '重命名', val: 'rename' }, { text: f.priv ? '设为公开' : '设为私密', val: 'toggle' }, { text: '删除这个收藏夹', val: 'del' }, { text: '返回', val: '' }
      ], function (r) {
        if (r.val === 'rename') push(promptScreen('重命名收藏夹', f.title, function (name) { API.favEdit(f, { title: name }).then(function () { toast('已改名'); reloadFav(f.id); }).catch(failToast('改名')); }));
        else if (r.val === 'toggle') API.favEdit(f, { priv: !f.priv }).then(function () { toast(f.priv ? '已设为公开' : '已设为私密'); reloadFav(f.id); }).catch(failToast('修改'));
        else if (r.val === 'del') push(listScreen('删除“' + f.title + '”？里面的收藏也会一起删除', [{ text: '确认删除', val: 1 }, { text: '取消', val: 0 }], function (r2) {
          if (r2.val) API.favDelete(f.id).then(function () { toast('已删除 ' + f.title); reloadFav(); }).catch(failToast('删除'));
        }));
      }));
    }
    function itemMenu(c) {
      var fid = feeds.fav.curId;
      push(listScreen(c.title.slice(0, 30), [{ text: '从这个收藏夹移除', val: 'rm' }, { text: '返回', val: '' }], function (r) {
        if (r.val === 'rm') API.favDeal(c.aid, '', fid).then(function () { toast('已移除'); feeds.fav.inner.reload().then(function () { var n = feeds.fav.grid.querySelector('.f') || feeds.fav.chips[0]; if (n) setFocus(n); }); }).catch(failToast('移除'));
      }));
    }
    var curTab = null, loaded = {}, switchTimer = null;
    function showTab(id) {
      if (id === curTab) return;
      curTab = id;
      tabEls.forEach(function (e) { e.classList.toggle('cur', e.dataset.tab === id); });
      Object.keys(feeds).forEach(function (k) { if (feeds[k].wrap.parentNode) feeds[k].wrap.parentNode.removeChild(feeds[k].wrap); });
      var f = feeds[id]; if (!f) return;
      s.root.appendChild(f.wrap);
      if (!loaded[id]) { loaded[id] = true; f.reload(); }
    }
    s.onShow = function () { if (!curTab) showTab('rec'); };
    s.initialFocus = function () { return tabEls[0]; };
    // 焦点落在页签上就自动切换内容（防抖）；落在子分类上切换分类；落在卡片上就预取下一页
    s.onFocus = function (e) {
      if (e.dataset.tab && e.dataset.tab !== 'sea') { clearTimeout(switchTimer); switchTimer = setTimeout(function () { showTab(e.dataset.tab); }, 250); }
      else if (e.chipId && !e.special && feeds[curTab] && feeds[curTab].select) feeds[curTab].select(e.chipId);
      else if (e.card && feeds[curTab]) feeds[curTab].nearEnd(e);
    };
    s.onKey = function (e) {
      if (e.keyCode === K.OK && focusEl) {
        if (focusEl.dataset.tab === 'sea') { push(searchScreen()); return true; }
        if (focusEl.dataset.tab) { refreshTab(focusEl.dataset.tab); return true; }   // 一级菜单上按 OK：刷新这个页面
        if (focusEl.dataset.acct && API.hub.on) { push(accountsScreen(me)); return true; }   // 有 hub：进账号管理
        if (focusEl.dataset.acct) {                      // 没有 hub：重新扫码登录 / 换另一个账号
          push(loginScreen(function (logged) {
            if (!logged) { pop(); return; }
            API.me().then(function (m) { resetStack(homeScreen(m)); });
          }, '取消（返回）'));
          return true;
        }
        if (focusEl.special) { createFolder(); return true; }
        if (focusEl.card) { openCard(focusEl.card); return true; }
      }
      if ((e.keyCode === K.YELLOW || e.keyCode === 68) && curTab === 'fav' && focusEl) {   // 黄键 / D：管理收藏夹或移除视频
        if (focusEl.chipId && !focusEl.special) { folderMenu(focusEl.chipData); return true; }
        if (focusEl.card && focusEl.card.aid) { itemMenu(focusEl.card); return true; }
      }
      if (e.keyCode === K.DOWN && focusEl && focusEl.dataset.tab) { // 从页签往下：有子分类先到子分类，否则到网格第一张
        var f = feeds[curTab];
        var first = f && (f.first ? f.first() : f.grid.querySelector('.f'));
        if (first) { setFocus(first); return true; }
      }
      if (e.keyCode === K.DOWN && focusEl && focusEl.chipId) { // 从子分类往下进网格
        var g = feeds[curTab] && feeds[curTab].grid && feeds[curTab].grid.querySelector('.f');
        if (g) { setFocus(g); return true; }
      }
      return false;
    };
    // 一级菜单 = 顶上的页签行（含账号按钮），下面的子分类 / 视频卡片都是二级
    // 返回键：在二级里 → 一键回到当前页签；已经在一级菜单 → 退出应用（回桌面）
    s.onBack = function () {
      if (focusEl && (focusEl.dataset.tab || focusEl.dataset.acct)) { exitApp(); return true; }
      var te = tabEls.filter(function (e) { return e.dataset.tab === curTab; })[0] || tabEls[0];
      clearTimeout(switchTimer);
      setFocus(te);
      return true;
    };
    // OK 刷新：重新拉取该页签最新内容（推荐换一批、动态 / 历史取最新记录）
    function refreshTab(id) {
      clearTimeout(switchTimer);
      var fresh = !loaded[id];
      showTab(id);                                   // 还没加载过的页签，showTab 会顺带加载一次
      if (fresh) return;
      var f = feeds[id]; if (!f) return;
      f.wrap.scrollTop = 0;
      toast('正在刷新…', 1200);
      var p = f.select ? f.reload(f.curId) : f.reload();   // 带子分类的页签（直播 / 收藏）停在原分类
      Promise.resolve(p).then(function () { if (f.wrap) f.wrap.scrollTop = 0; });
    }
    return s;
  }

  // 点卡片：直播直接进直播间；番剧直接播（拉整季选集）；其余进详情页
  function openCard(c) {
    if (c.roomid) { push(liveScreen(c)); return; }
    if (c.epid) {
      toast('正在加载番剧…');
      API.pgcSeason(c.epid).then(function (se) {
        var parts = se.episodes.map(function (e) { return { bvid: e.bvid, cid: e.cid, epid: e.epid, title: se.title + ' ' + e.title }; });
        var idx = Math.max(0, se.episodes.findIndex(function (e) { return e.epid === c.epid; }));
        push(playerScreen({ parts: parts, idx: idx, resume: 0 }));
      }).catch(function (e) { toast('番剧加载失败：' + (e && e.message)); });
      return;
    }
    push(detailScreen(c));
  }

  // ---------- 搜索屏 ----------
  function searchScreen() {
    var s = { root: el('div', 'screen') };
    var bar = el('div', 'search-top');
    var inp = el('input', 'f'); inp.placeholder = '按 OK 输入关键词；输入完成后自动搜索'; inp.dataset.scroll = 'nearest';
    var goBtn = el('div', 'btn f', '搜索'); goBtn.dataset.scroll = 'nearest';
    bar.appendChild(inp); bar.appendChild(goBtn); s.root.appendChild(bar);
    var hot = el('div', 'hot'); s.root.appendChild(hot);
    var feed = null, kw = '';
    function run(k) {
      kw = k; inp.value = k; hot.style.display = 'none';
      if (feed && feed.wrap.parentNode) feed.wrap.parentNode.removeChild(feed.wrap);
      feed = makeFeed(function (p) { return API.search(kw, p); });
      feed.wrap.style.top = '140px';
      s.root.appendChild(feed.wrap);
      feed.reload().then(function () { var f = feed.grid.querySelector('.f'); if (f) setFocus(f); });
    }
    // 电视输入法点“完成”会触发 change（或 Done 键）；也可以手动选“搜索”按钮
    inp.addEventListener('change', function () { var v = inp.value.trim(); if (v && v !== kw) run(v); });
    API.hotwords().then(function (list) {
      list.forEach(function (w) { var c = el('div', 'chip f', w); c.dataset.scroll = 'nearest'; c.word = w; hot.appendChild(c); });
    });
    s.initialFocus = function () { return inp; };
    s.onFocus = function (e) { if (e.card && feed) feed.nearEnd(e); };
    s.onKey = function (e) {
      if (document.activeElement === inp) {                 // 正在输入：交给输入法
        if (e.keyCode === K.OK || e.keyCode === 65376) { var v = inp.value.trim(); inp.blur(); if (v) run(v); return true; }   // 65376 = 输入法“完成”键
        if (e.keyCode === K.BACK || e.keyCode === K.ESC || e.keyCode === 65385) { inp.blur(); return true; }
        return 'pass';
      }
      if (e.keyCode === K.OK && focusEl) {
        if (focusEl === inp) { inp.focus(); return true; }
        if (focusEl === goBtn) { var q = inp.value.trim(); if (q) run(q); else inp.focus(); return true; }
        if (focusEl.word) { run(focusEl.word); return true; }
        if (focusEl.card) { openCard(focusEl.card); return true; }
      }
      return false;
    };
    return s;
  }

  // ---------- 详情屏 ----------
  function detailScreen(c) {
    var s = { root: el('div', 'screen detail') };
    var row = el('div', 'row'), cover = el('img', 'cover'); cover.referrerPolicy = 'no-referrer'; cover.src = U.pic(c.pic, 760, 428);
    var info = el('div', ''); info.style.flex = '1';
    var h = el('h1', '', c.title), meta = el('div', 'meta', c.author || ''), desc = el('div', 'desc', '加载中…');
    var btns = el('div', 'btns'), play = el('div', 'btn f', '▶ 播放');
    var upBtn = el('div', 'btn f', 'UP主'); upBtn.style.display = 'none'; var owner = null;
    btns.appendChild(play); btns.appendChild(upBtn);
    info.appendChild(h); info.appendChild(meta); info.appendChild(desc); info.appendChild(btns);
    row.appendChild(cover); row.appendChild(info); s.root.appendChild(row);
    var plist = el('div', 'parts'); s.root.appendChild(plist);
    var parts = [{ bvid: c.bvid, cid: c.cid, title: c.title }], idx0 = 0, label = el('div', 'plabel'); label.style.display = 'none';
    s.root.insertBefore(label, plist);
    function go(i) {
      var it = parts[i];
      if (!it || !it.cid) { toast('还没取到分P信息，稍等'); return; }
      // 从历史点进来的卡片带着进度；只对点开的那一集生效
      push(playerScreen({ parts: parts, idx: i, resume: i === idx0 ? (c.progress || 0) : 0 }));
    }
    API.view(c.bvid).then(function (d) {
      owner = d.owner; upBtn.textContent = 'UP主：' + d.owner.name; upBtn.style.display = '';
      h.textContent = d.title; meta.textContent = d.owner.name + ' · ' + U.fmtCount(d.stat.view) + '播放 · ' + U.fmtTime(d.duration);
      desc.textContent = d.desc || '';
      // 选集来源：多 P 视频的分 P；没有分 P 但属于“合集”的，用合集里的视频
      if (d.pages && d.pages.length > 1) {
        parts = d.pages.map(function (pg) { return { bvid: c.bvid, cid: pg.cid, title: d.title + '  P' + pg.page + ' ' + pg.part, label: 'P' + pg.page + ' ' + pg.part }; });
        label.textContent = '分P（共 ' + parts.length + ' 个）';
      } else if (d.ugc_season && d.ugc_season.sections) {
        var eps = [];
        d.ugc_season.sections.forEach(function (sec) { (sec.episodes || []).forEach(function (e) { eps.push({ bvid: e.bvid, cid: e.cid || (e.page && e.page.cid), title: e.title, label: e.title }); }); });
        if (eps.length > 1) { parts = eps; label.textContent = '合集：' + d.ugc_season.title + '（共 ' + eps.length + ' 个）'; }
      }
      // 单 P 视频：卡片里可能没有 cid（搜索结果、动态都没有），用详情接口返回的补上
      if (parts.length === 1) parts = [{ bvid: c.bvid, cid: d.cid || (d.pages && d.pages[0] && d.pages[0].cid) || c.cid, title: d.title }];
      idx0 = Math.max(0, parts.findIndex(function (x) { return x.bvid === c.bvid && (parts.length === 1 || x.cid === c.cid || !c.cid) ; }));
      if (idx0 < 0 || parts.length === 1) idx0 = 0;
      if (parts.length > 1) {
        label.style.display = 'block';
        parts.slice(0, 300).forEach(function (pt, i) { var e = el('div', 'part f', pt.label || pt.title); e.idx = i; plist.appendChild(e); });
      }
    }).catch(function (e) { desc.textContent = '详情加载失败：' + (e && e.message); U.diag('detail.error', e && e.message); });
    s.initialFocus = function () { return play; };
    s.onKey = function (e) {
      if (e.keyCode === K.OK && focusEl) {
        if (focusEl === play) { go(idx0); return true; }
        if (focusEl === upBtn && owner) { push(upScreen(owner)); return true; }
        if (focusEl.idx != null) { go(focusEl.idx); return true; }
      }
      return false;
    };
    return s;
  }

  // ---------- 点播播放屏 ----------
  var QN_PREF = 80;                       // 默认 1080P
  var CODEC_ORDER = [12, 7, 13];          // HEVC → H.264 → AV1（电视实测 HEVC/AV1 可播）
  var CODEC_NAME = { 7: 'H.264', 12: 'HEVC', 13: 'AV1' };

  function rangeOf(v) {
    var sb = v.segment_base || v.SegmentBase || {};
    return { init: sb.initialization || sb.Initialization, index: sb.index_range || sb.indexRange };
  }
  function pickAudio(dash) {
    var order = [30232, 30216, 30280], list = dash.audio || [];
    for (var i = 0; i < order.length; i++) { var a = list.find(function (x) { return x.id === order[i]; }); if (a) return a; }
    return list[0];
  }
  function mk(stream, kind) {
    var r = rangeOf(stream);
    return { url: stream.baseUrl || stream.base_url, urls: [stream.baseUrl || stream.base_url].concat(stream.backupUrl || stream.backup_url || []), mime: kind + '/mp4; codecs="' + stream.codecs + '"', initRange: r.init, indexRange: r.index, codecs: stream.codecs, id: stream.id, codecid: stream.codecid, bandwidth: stream.bandwidth };
  }
  // 选流：目标清晰度 → 按编码偏好找电视支持、且地址可取的第一个
  async function chooseStreams(data, qn, forceCodec) {
    var dash = data.dash, vids = dash.video || [];
    var ids = vids.map(function (v) { return v.id; }).filter(function (x, i, a) { return a.indexOf(x) === i; }).sort(function (a, b) { return b - a; });
    var target = ids.find(function (x) { return x <= qn; }) || ids[ids.length - 1];
    var order = forceCodec ? [forceCodec] : CODEC_ORDER;
    var quals = ids.map(function (id) { var i = (data.accept_quality || []).indexOf(id); return { id: id, desc: i >= 0 ? data.accept_description[i] : String(id) }; });
    for (var i = 0; i < order.length; i++) {
      var v = vids.find(function (x) { return x.id === target && x.codecid === order[i]; });
      if (!v) continue;
      var m = mk(v, 'video');
      if (!MediaSource.isTypeSupported(m.mime)) { U.diag('play.unsupported', m.mime); continue; }
      if (!(await window.DashProbe(m))) { U.diag('play.probe403', CODEC_NAME[order[i]] + ' q' + target); continue; }
      var a = pickAudio(dash), am = mk(a, 'audio');
      if (!(await window.DashProbe(am))) { U.diag('play.audio403', ''); continue; }
      return { video: m, audio: am, qn: target, codecid: order[i], quals: quals };
    }
    throw new Error('没有可播放的流（编码被拒或不支持）');
  }

  // opt = { parts:[{bvid,cid,epid?,title}], idx, resume }：多 P / 合集 / 番剧都用同一套“选集”
  function playerScreen(opt) {
    var s = { root: el('div', 'screen player') };
    var v = document.createElement('video'); v.setAttribute('playsinline', ''); s.root.appendChild(v);
    var subEl = el('div', 'sub'); s.root.appendChild(subEl);
    var spin = el('div', 'spin'); s.root.appendChild(spin);
    var perr = el('div', 'perr'); s.root.appendChild(perr);
    var ovTop = el('div', 'ov top2', ''); s.root.appendChild(ovTop);
    var ovBot = el('div', 'ov bot'), bar = el('div', 'bar'), buf = el('div', 'buf'), pos = el('div', 'pos');
    bar.appendChild(buf); bar.appendChild(pos);
    var times = el('div', 'times'), tl = el('span', '', '0:00'), tinfo = el('span', '', ''), tr = el('span', '', '0:00');
    times.appendChild(tl); times.appendChild(tinfo); times.appendChild(tr);
    var ctl = el('div', 'ctl');   // 进度条下面的一排按钮：画质 / 字幕 / 选集 / 收藏 / UP主
    ovBot.appendChild(bar); ovBot.appendChild(times); ovBot.appendChild(ctl); s.root.appendChild(ovBot);
    var menu = el('div', 'menu'); s.root.appendChild(menu);   // 按钮弹出的选择列表

    var idx = opt.idx || 0, it = opt.parts[idx];
    var player = null, info = null, hideTimer = null, hbTimer = null, pending = null, seekTimer = null;
    // ui：seek = 只看画面（左右键快进快退）；row = 焦点在控制条按钮上；list = 某个按钮的选择列表已展开
    var ui = 'seek', bi = 0, popRows = [], popIdx = 0, popKind = '', favList = [], faved = false, resumeOnShow = false;
    var qn = QN_PREF, force = 0, closed = false, lastData = null, resumeAt = opt.resume || 0;
    var hbItem = null, subTracks = [], subCues = [], subLan = store('sub') || '', subTimer = null, subSeq = 0;

    function showOv() {
      ovTop.classList.add('show'); ovBot.classList.add('show');
      clearTimeout(hideTimer);
      hideTimer = setTimeout(function () {
        if (ui !== 'seek') { closePop(); ui = 'seek'; renderBtns(); }          // 一段时间不操作，回到“只看画面”
        if (!v.paused) { ovTop.classList.remove('show'); ovBot.classList.remove('show'); }
      }, ui === 'seek' ? 4000 : ui === 'list' ? 25000 : 12000);
    }
    function label() { return info ? (info.quals.find(function (q) { return q.id === info.qn; }) || { desc: info.qn }).desc + ' · ' + CODEC_NAME[info.codecid] : ''; }
    function render() {
      var d = v.duration || (player && player.duration) || 0, t = pending != null ? pending : v.currentTime;
      tl.textContent = U.fmtTime(t); tr.textContent = U.fmtTime(d); tinfo.textContent = label() + (opt.parts.length > 1 ? '  ·  第 ' + (idx + 1) + '/' + opt.parts.length + ' 个' : '');
      pos.style.width = d ? (t / d * 100) + '%' : '0';
      var b = v.buffered, be = 0; for (var i = 0; i < b.length; i++) if (b.start(i) <= v.currentTime + 0.5) be = Math.max(be, b.end(i));
      buf.style.width = d ? (be / d * 100) + '%' : '0';
    }
    function heartbeat(kind) { if (info && it.bvid) API.heartbeat(it.bvid, it.cid, v.currentTime, kind, v.duration); }

    // ----- 字幕：B 站的 AI 自动字幕也在里面；选择会被记住 -----
    function showSub() {
      if (!subCues.length) { subEl.textContent = ''; return; }
      var t = v.currentTime, lo = 0, hi = subCues.length - 1, hit = null;
      while (lo <= hi) { var mid = (lo + hi) >> 1, c = subCues[mid]; if (t < c.from) hi = mid - 1; else if (t > c.to) lo = mid + 1; else { hit = c; break; } }
      var txt = hit ? hit.content : '';
      if (subEl.textContent !== txt) subEl.textContent = txt;
    }
    function applySub(lan) {
      subLan = lan; store('sub', lan); subCues = []; subEl.textContent = '';
      var tr0 = subTracks.find(function (x) { return x.lan === lan; });
      if (!tr0) return Promise.resolve();
      var seq = ++subSeq;
      return API.subtitleBody(tr0.url).then(function (body) { if (seq === subSeq) { subCues = body; U.diag('sub.loaded', lan + ' ' + body.length + ' lines'); toast('字幕：' + tr0.doc); renderBtns(); } }).catch(function (e) { toast('字幕加载失败'); U.diag('sub.error', e && e.message); });
    }
    function loadSubs() {
      subTracks = []; subCues = []; subEl.textContent = ''; var seq = ++subSeq;
      if (!it.bvid) return;
      API.subtitles(it.bvid, it.cid).then(function (list) {
        if (seq !== subSeq) return;
        subTracks = list;
        U.diag('sub.tracks', list.map(function (x) { return x.lan; }).join(',') || 'none');
        renderBtns();
        if (subLan && list.some(function (x) { return x.lan === subLan; })) applySub(subLan);
        else if (subLan && list.length) applySub(list[0].lan);   // 记住了“开”，但这个视频语言不同 → 用第一条
      });
    }

    // ----- 开始 / 切换一个视频（多 P 切 P 也走这里）-----
    async function start(at) {
      perr.style.display = 'none'; spin.style.display = 'block';
      try {
        if (player) { player.destroy(); player = null; }
        var key = it.bvid + '/' + it.cid + '/' + qn;
        var data = lastData && lastData.key === key ? lastData.data : await API.playData(it, qn);
        lastData = { key: key, data: data };
        info = await chooseStreams(data, qn, force);
        if (closed) return;
        U.diag('play.start', 'q' + info.qn + ' ' + CODEC_NAME[info.codecid] + ' ' + info.video.codecs + ' at=' + Math.floor(at) + ' item=' + (idx + 1) + '/' + opt.parts.length);
        player = new window.DashPlayer(v, { onError: function (e) { fail('播放出错：' + (e && e.message) + '，按 OK 重试'); } });
        await player.load({ video: info.video, audio: info.audio }, at);
        renderBtns(); showOv();
      } catch (e) { fail('无法播放：' + (e && e.message)); }
    }
    function fail(msg) { spin.style.display = 'none'; perr.textContent = msg; perr.style.display = 'block'; U.diag('play.fail', msg); lastData = null; showOv(); }
    async function playItem(i, at) {
      if (i < 0 || i >= opt.parts.length) return;
      heartbeat(4);
      idx = i; it = opt.parts[i]; lastData = null;
      ovTop.textContent = it.title || '';
      loadSubs(); loadMeta();
      if (at == null) at = await API.lastPlayTime(it.bvid, it.cid);
      if (at > 5) toast('从 ' + U.fmtTime(at) + ' 继续');
      start(at > 5 ? at : 0);
    }

    v.addEventListener('waiting', function () { spin.style.display = 'block'; });
    v.addEventListener('playing', function () {
      spin.style.display = 'none'; perr.style.display = 'none'; U.diag('play.playing', label() + ' size=' + v.videoWidth + 'x' + v.videoHeight);
      if (hbItem !== it) { hbItem = it; setTimeout(function () { if (!closed && hbItem === it) heartbeat(1); }, 3000); }   // 开始播放 3 秒后先报一次，短暂观看也进历史
    });
    v.addEventListener('pause', function () { heartbeat(2); showOv(); });
    v.addEventListener('timeupdate', render);
    v.addEventListener('ended', function () {
      heartbeat(4);
      if (idx + 1 < opt.parts.length) { toast('接着播放下一个'); playItem(idx + 1, 0); } else pop();   // 多 P / 合集 / 番剧自动连播
    });
    v.addEventListener('error', function () { fail('视频错误 ' + (v.error && v.error.code)); });

    s.onHide = function () { resumeOnShow = !v.paused; v.pause(); };    // 去看 UP 主页 / 输入名称时先暂停（暂停会顺带上报进度）
    s.onShow = function () {
      closed = false; showOv();
      clearInterval(hbTimer); clearInterval(subTimer);
      hbTimer = setInterval(function () { if (!v.paused) heartbeat(1); }, 15000);
      subTimer = setInterval(showSub, 200);
      if (resumeOnShow) { resumeOnShow = false; v.play().catch(function () {}); }
    };
    s.onClose = function () {
      var t = v.currentTime || 0;
      closed = true; heartbeat(4); clearInterval(hbTimer); clearInterval(subTimer); clearTimeout(hideTimer); clearTimeout(seekTimer);
      if (player) player.destroy();
      U.diag('play.close', 'bvid=' + it.bvid + ' t=' + Math.floor(t));
    };

    ovTop.textContent = it.title || '';
    loadSubs(); loadMeta();
    (async function () {
      var at = resumeAt > 5 ? resumeAt : await API.lastPlayTime(it.bvid, it.cid);
      if (at > 5) toast('从 ' + U.fmtTime(at) + ' 继续');
      start(at > 5 ? at : 0);
    })();

    // 连按左右键时先累计目标位置，停手 0.4 秒后再真正 seek
    function seekBy(d) {
      if (!player || !player.ms) return;
      pending = Math.max(0, Math.min((pending != null ? pending : v.currentTime) + d, v.duration || 1e9));
      showOv(); render(); clearTimeout(seekTimer);
      seekTimer = setTimeout(function () { var t = pending; pending = null; spin.style.display = 'block'; player.seek(t); }, 400);
    }
    function togglePause() { if (v.paused) v.play().catch(function () {}); else v.pause(); }

    // ----- 视频的元数据（aid / UP 主）和“我收藏了没有”-----
    function loadMeta() {
      var cur = it; faved = false;
      API.view(cur.bvid).then(function (d) {
        if (it !== cur) return;
        cur.aid = d.aid; cur.owner = d.owner; renderBtns();
        return API.favFolders(d.aid);
      }).then(function (list) {
        if (!list || it !== cur) return;
        favList = list; faved = list.some(function (f) { return f.faved; }); renderBtns();
      }).catch(function (e) { U.diag('meta.error', e && e.message); });
    }

    // ----- 控制条按钮：直接在播放界面上改画质 / 字幕 / 选集 / 收藏，不再有隐藏的上键菜单 -----
    function btnDefs() {
      var d = [];
      if (info) d.push({ k: 'q', t: '画质 ' + (info.quals.find(function (q) { return q.id === info.qn; }) || { desc: info.qn }).desc });
      d.push({ k: 's', t: !subTracks.length ? '字幕 无' : '字幕 ' + (subCues.length ? (subTracks.find(function (x) { return x.lan === subLan; }) || { doc: '开' }).doc : '关') });
      if (opt.parts.length > 1) d.push({ k: 'p', t: '选集 ' + (idx + 1) + '/' + opt.parts.length });
      if (it.aid) d.push({ k: 'f', t: faved ? '★ 已收藏' : '☆ 收藏' });
      if (it.owner) d.push({ k: 'u', t: 'UP主 ' + it.owner.name });
      return d;
    }
    function renderBtns() {
      var defs = btnDefs();
      if (bi >= defs.length) bi = defs.length - 1;
      if (bi < 0) bi = 0;
      ctl.innerHTML = '';
      defs.forEach(function (d, i) {
        var b = el('div', 'cbtn' + (ui !== 'seek' && i === bi ? ' sel' : '') + (d.k === 'f' && faved ? ' on' : ''), d.t);
        b.k = d.k; ctl.appendChild(b);
      });
    }
    function openPop(kind) {
      popKind = kind; popRows = [];
      if (kind === 'q') popRows = info.quals.map(function (q) { return { text: q.desc, on: q.id === info.qn, val: q.id }; });
      else if (kind === 's') popRows = [{ text: '关闭', on: !subCues.length, val: '' }].concat(subTracks.map(function (x) { return { text: x.doc, on: !!subCues.length && x.lan === subLan, val: x.lan }; }));
      else if (kind === 'p') popRows = opt.parts.map(function (pt, i) { return { text: pt.label || pt.title, on: i === idx, val: i }; });
      else if (kind === 'f') {
        popRows = [{ text: '加载中…', val: null }];
        API.favFolders(it.aid).then(function (list) {
          if (popKind !== 'f') return;
          favList = list; faved = list.some(function (f) { return f.faved; });
          popRows = list.map(function (f) { return { text: (f.priv ? '[私] ' : '') + f.title + '（' + f.count + '）', on: f.faved, val: f.id, name: f.title }; });
          popRows.push({ text: '＋ 新建收藏夹并收藏', val: '__new' });
          popIdx = Math.max(0, popRows.findIndex(function (r) { return r.on; }));
          renderPop(); renderBtns();
        }).catch(function (e) { popRows = [{ text: '收藏夹加载失败：' + (e && e.message), val: null }]; renderPop(); });
      }
      popIdx = Math.max(0, popRows.findIndex(function (r) { return r.on; }));
      ui = 'list'; renderPop(); showOv();
    }
    function renderPop() {
      menu.innerHTML = '';
      popRows.forEach(function (r, i) {
        var mark = r.val != null && r.val !== '__new' ? (r.on ? '● ' : '○ ') : '';
        menu.appendChild(el('div', 'it' + (i === popIdx ? ' sel' : '') + (r.on ? ' now' : ''), mark + r.text));
      });
      var b = ctl.children[bi];                       // 列表出现在当前按钮的正上方
      if (b) { var rc = b.getBoundingClientRect(); menu.style.left = Math.max(40, Math.min(rc.left, 1920 - 720)) + 'px'; menu.style.right = 'auto'; }
      menu.style.display = 'block';
      try { menu.children[popIdx].scrollIntoView({ block: 'nearest' }); } catch (e) {}
    }
    function closePop() { menu.style.display = 'none'; popKind = ''; if (ui === 'list') ui = 'row'; }
    function pickPop() {
      var r = popRows[popIdx]; if (!r || r.val == null) return;
      if (popKind === 'q') { closePop(); if (r.val !== info.qn) { qn = r.val; start(v.currentTime); } }
      else if (popKind === 's') {
        closePop();
        if (r.val) applySub(r.val); else { subLan = ''; store('sub', ''); subCues = []; subEl.textContent = ''; toast('字幕已关闭'); renderBtns(); }
      }
      else if (popKind === 'p') { closePop(); if (r.val !== idx) playItem(r.val, 0); }
      else if (popKind === 'f') {
        if (r.val === '__new') {
          closePop();
          push(promptScreen('新建收藏夹并收藏', '', function (name) {
            API.favCreate(name, false).then(function (d) { return API.favDeal(it.aid, d.id, ''); }).then(function () { faved = true; renderBtns(); toast('已创建“' + name + '”并收藏'); })
              .catch(function (e) { toast('操作失败：' + (e && e.message)); });
          }));
          return;
        }
        // 勾选 / 取消勾选：立刻提交，列表保持打开，可以连续选多个收藏夹
        API.favDeal(it.aid, r.on ? '' : r.val, r.on ? r.val : '').then(function () {
          r.on = !r.on; faved = popRows.some(function (x) { return x.on; });
          renderPop(); renderBtns(); toast(r.on ? '已收藏到 ' + r.name : '已从 ' + r.name + ' 取消收藏');
        }).catch(function (e) { toast('操作失败：' + (e && e.message)); U.diag('fav.deal', e && e.message); });
      }
    }
    function activate() {
      var b = ctl.children[bi]; if (!b) return;
      if (b.k === 'u') { if (it.owner) push(upScreen(it.owner)); return; }
      openPop(b.k);
    }

    s.onKey = function (e) {
      var k = e.keyCode;
      if (ui === 'list') {                                             // 选择列表：上下选、OK 确认
        if (k === K.UP) { popIdx = Math.max(0, popIdx - 1); renderPop(); }
        else if (k === K.DOWN) { popIdx = Math.min(popRows.length - 1, popIdx + 1); renderPop(); }
        else if (k === K.OK) pickPop();
        else if (k === K.LEFT || k === K.RIGHT) { closePop(); }
        showOv(); return true;
      }
      if (ui === 'row') {                                              // 控制条：左右换按钮、OK 展开、上回到画面
        var handled = true;
        if (k === K.LEFT) { bi = Math.max(0, bi - 1); renderBtns(); }
        else if (k === K.RIGHT) { bi = Math.min(ctl.children.length - 1, bi + 1); renderBtns(); }
        else if (k === K.UP) { ui = 'seek'; renderBtns(); }
        else if (k === K.DOWN) { /* 已经在最下面 */ }
        else if (k === K.OK) activate();
        else handled = false;
        if (handled) { showOv(); return true; }
      }
      // 只看画面：左右快进快退，上 / 下呼出控制条
      if (k === K.LEFT) seekBy(-10); else if (k === K.RIGHT) seekBy(10);
      else if (k === K.RW) seekBy(-30); else if (k === K.FF) seekBy(30);
      else if (k === K.UP || k === K.DOWN) { ui = 'row'; renderBtns(); showOv(); }
      else if (k === K.OK || k === K.PLAYPAUSE) { if (perr.style.display === 'block') start(v.currentTime || 0); else togglePause(); }
      else if (k === K.PLAY) v.play().catch(function () {}); else if (k === K.PAUSE) v.pause();
      else if (k === K.CHUP || k === 80) { if (idx + 1 < opt.parts.length) playItem(idx + 1, 0); else toast('已经是最后一个'); }       // 频道+ / P：下一个
      else if (k === K.CHDOWN || k === 78) { if (idx > 0) playItem(idx - 1, 0); else toast('已经是第一个'); }                        // 频道- / N：上一个
      else if (k === K.BLUE || k === 67) {                                                                                        // 蓝键 / C：字幕开关
        if (!subTracks.length) toast('这个视频没有字幕');
        else if (subCues.length) { subLan = ''; store('sub', ''); subCues = []; subEl.textContent = ''; toast('字幕已关闭'); renderBtns(); }
        else applySub(subLan && subTracks.some(function (x) { return x.lan === subLan; }) ? subLan : subTracks[0].lan);
      }
      else if (k >= 48 && k <= 51) { // 0 自动 / 1 H.264 / 2 HEVC / 3 AV1：用来在电视上对比编码
        force = [0, 7, 12, 13][k - 48]; toast('编码：' + (force ? CODEC_NAME[force] : '自动')); start(v.currentTime || 0);
      } else return false;
      return true;
    };
    s.onBack = function () {
      if (ui === 'list') { closePop(); showOv(); return true; }
      if (ui === 'row') { ui = 'seek'; renderBtns(); showOv(); return true; }
      return false;
    };
    s.initialFocus = function () { return null; };
    return s;
  }

  // ---------- 直播播放屏 ----------
  function liveScreen(c) {
    var s = { root: el('div', 'screen player') };
    var v = document.createElement('video'); v.setAttribute('playsinline', ''); s.root.appendChild(v);
    var spin = el('div', 'spin'); spin.style.display = 'block'; s.root.appendChild(spin);
    var perr = el('div', 'perr'); s.root.appendChild(perr);
    var ov = el('div', 'ov top2', c.title + '  ·  ' + c.author + (c.viewText ? '  ·  ' + c.viewText : '')); s.root.appendChild(ov);
    var closed = false, lp = null, hideTimer = null;
    function showOv() { ov.classList.add('show'); clearTimeout(hideTimer); hideTimer = setTimeout(function () { ov.classList.remove('show'); }, 4000); }
    function fail(msg) { spin.style.display = 'none'; perr.textContent = msg; perr.style.display = 'block'; U.diag('live.fail', msg); showOv(); }
    // 依次尝试候选流地址（fmp4 → ts），MSE 播放；起播 12 秒内没画面就换下一个
    async function start() {
      perr.style.display = 'none'; spin.style.display = 'block';
      try {
        var cands = await API.liveStream(c.roomid);
        U.diag('live.cands', cands.map(function (x) { return x.format + '/' + x.codec; }).join(','));
        for (var i = 0; i < cands.length && !closed; i++) {
          var cd = cands[i];
          if (cd.format !== 'fmp4') continue;           // MSE 只能吃 fmp4；ts 需要原生 HLS（下面兜底）
          if (lp) { lp.destroy(); lp = null; }
          lp = new window.LivePlayer(v, { onError: function (e) { fail('直播中断：' + (e && e.message) + '，按 OK 重试'); } });
          try {
            await lp.load(cd.url);
            var ok = await waitPlaying(12000);
            if (ok) { U.diag('live.playing', cd.format + '/' + cd.codec + ' ' + v.videoWidth + 'x' + v.videoHeight); showOv(); return; }
            U.diag('live.noframe', cd.format + '/' + cd.codec);
          } catch (e) { U.diag('live.candfail', cd.format + '/' + cd.codec + ' ' + (e && e.message)); }
        }
        // 兜底：电视原生 HLS（可能支持 ts）
        if (!closed && v.canPlayType('application/vnd.apple.mpegurl')) {
          if (lp) { lp.destroy(); lp = null; }
          for (var j = 0; j < cands.length && !closed; j++) {
            v.src = cands[j].url; try { await v.play(); } catch (e) {}
            if (await waitPlaying(10000)) { U.diag('live.native', cands[j].format); showOv(); return; }
          }
        }
        if (!closed) fail('这路直播暂时播不了');
      } catch (e) { fail('无法播放直播：' + (e && e.message)); }
    }
    function waitPlaying(ms) {
      return new Promise(function (res) {
        var t0 = Date.now(), iv = setInterval(function () {
          if (closed) { clearInterval(iv); res(false); return; }
          if (v.readyState >= 3 && v.videoWidth > 0 && !v.paused && v.currentTime > 0.3) { clearInterval(iv); res(true); }
          else if (Date.now() - t0 > ms) { clearInterval(iv); res(false); }
        }, 300);
      });
    }
    v.addEventListener('waiting', function () { spin.style.display = 'block'; });
    v.addEventListener('playing', function () { spin.style.display = 'none'; perr.style.display = 'none'; });
    s.onShow = function () { closed = false; showOv(); };
    s.onClose = function () { closed = true; clearTimeout(hideTimer); if (lp) lp.destroy(); try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) {} U.diag('live.close', 'room=' + c.roomid); };
    s.onKey = function (e) {
      if (e.keyCode === K.OK) { if (perr.style.display === 'block') start(); else showOv(); return true; }
      if (e.keyCode === K.UP || e.keyCode === K.DOWN || e.keyCode === K.LEFT || e.keyCode === K.RIGHT) { showOv(); return true; }
      return false;
    };
    s.initialFocus = function () { return null; };
    start();
    return s;
  }

  // ---------- 键盘分发 ----------
  document.addEventListener('keydown', function (e) {
    var s = cur(); if (!s) return;
    var k = e.keyCode;
    var r = s.onKey ? s.onKey(e) : false;
    if (r === 'pass') return;                      // 输入框里让浏览器 / 输入法处理
    if (r) { e.preventDefault(); return; }
    var back = k === K.BACK || k === K.ESC || k === K.BS;
    if (back) {
      e.preventDefault();
      if (s.onBack && s.onBack()) return;
      if (stack.length > 1) pop(); else exitApp();
      return;
    }
    if (k === K.LEFT) move('left'); else if (k === K.RIGHT) move('right');
    else if (k === K.UP) move('up'); else if (k === K.DOWN) move('down');
    else return;
    e.preventDefault();
  });

  // ---------- 启动 ----------
  U.diag('boot', navigator.userAgent.slice(-60) + ' dev=' + CFG.dev + ' diag=' + (CFG.diag ? 'on' : 'off'));
  (function () {
    var t = document.createElement('video');
    U.diag('env.canPlay', 'hls=' + JSON.stringify(t.canPlayType('application/vnd.apple.mpegurl')) + ' mse=' + !!window.MediaSource +
      ' hevc=' + MediaSource.isTypeSupported('video/mp4; codecs="hvc1.1.6.L120.90"') + ' avc=' + MediaSource.isTypeSupported('video/mp4; codecs="avc1.640028,mp4a.40.2"'));
  })();
  window.addEventListener('error', function (e) { U.diag('js.error', e.message + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno); });
  window.addEventListener('unhandledrejection', function (e) { U.diag('js.reject', e.reason && e.reason.message); });
  (async function boot() {
    await API.devSession();
    // ① 账号服务（NAS 上的 bili-hub）：能连上就用它代管多个账号；连不上自动退回电视本机登录
    var HUB = window.BILI_HUB || (new URLSearchParams(location.search).get('hub') ? { base: new URLSearchParams(location.search).get('hub'), key: new URLSearchParams(location.search).get('hubkey') || '' } : null);
    if (HUB && HUB.base) {
      API.useHub(HUB.base, HUB.key);
      if (await API.hubProbe()) {
        try {
          var accs = await API.hubAccounts();
          U.diag('hub', 'on accounts=' + accs.length + ' acct=' + (API.hub.acct || '-'));
          if (!accs.some(function (a) { return a.mid === API.hub.acct; }) && API.hub.acct !== 'anon') API.setAcct(accs.length ? accs[0].mid : '');
          if (!accs.length) {
            push(loginScreen(function (logged) {
              if (!logged) { API.setAcct('anon'); }
              API.me().then(function (m) { replaceTop(homeScreen(m)); });
            }));
            return;
          }
          var m0 = await API.meStrict().catch(function () { return null; });
          push(homeScreen(m0));
          var op0 = new URLSearchParams(location.search).get('open');   // 仅开发联调：直接打开某个视频
          if (CFG.dev && op0) push(detailScreen({ bvid: op0, cid: 0, title: op0, pic: '', author: '' }));
          return;
        } catch (e) { U.diag('hub.error', e && e.message); }
      } else { U.diag('hub', 'unreachable'); }
      // hub 不可用：改回直连模式
      API.useDirect();
      toast('账号服务连不上，先用电视本机的登录', 5000);
    }
    API.warmup();                                   // 只是取 buvid 等基础 Cookie，不用等
    // ② 直连模式：区分“没登录”和“网络不通”，网络不通时重试，不能误显示登录二维码
    var me = null, netErr = false;
    for (var i = 0; i < 3; i++) {
      try { me = await API.meStrict(); netErr = false; break; }
      catch (e) { netErr = true; U.diag('boot.neterr', (e && e.message) + ' try=' + (i + 1)); await new Promise(function (r) { setTimeout(r, 2000); }); }
    }
    U.diag('boot.me', netErr ? 'network-error' : me ? 'logged-in' : 'anonymous');
    if (netErr) { toast('网络不稳定，内容可能加载失败；稍后返回再进来重试', 8000); push(homeScreen(null)); return; }
    if (me) {
      if (!API.auth()) API.setAuth({ mid: me.mid, csrf: null, at: Date.now() });
      push(homeScreen(me));
      // 仅开发联调：?open=BV号 直接打开某个视频的详情页
      var op = new URLSearchParams(location.search).get('open');
      if (CFG.dev && op) push(detailScreen({ bvid: op, cid: 0, title: op, pic: '', author: '' }));
      return;
    }
    push(loginScreen(function (logged) {
      API.me().then(function (m) { replaceTop(homeScreen(m)); });
    }));
  })();
})();
