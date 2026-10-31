// 小工具：DOM、格式化、诊断回传
(function () {
  var $ = function (s, r) { return (r || document).querySelector(s); };
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function fmtTime(s) {
    s = Math.max(0, Math.floor(s || 0));
    var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    var p = function (n) { return n < 10 ? '0' + n : '' + n; };
    return (h ? h + ':' + p(m) : m) + ':' + p(x);
  }
  function fmtCount(n) {
    n = Number(n); if (!isFinite(n)) return '';
    return n >= 1e8 ? (n / 1e8).toFixed(1) + '亿' : n >= 1e4 ? (n / 1e4).toFixed(1) + '万' : String(n);
  }
  // "3:20" / "01:03:20" → 秒
  function parseDur(s) {
    if (typeof s === 'number') return s;
    var p = String(s || '0').split(':').map(Number), t = 0;
    for (var i = 0; i < p.length; i++) t = t * 60 + (p[i] || 0);
    return t;
  }
  function stripHtml(s) { return String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>'); }
  // 封面：补协议，hdslb 域名用缩略图后缀（小图解码省内存）
  function pic(u, w, h) {
    if (!u) return '';
    u = String(u).replace(/^\/\//, 'https://').replace(/^http:/, 'https:');
    if (/hdslb\.com\/bfs\//.test(u) && !/@/.test(u)) u += '@' + w + 'w_' + h + 'h_1c.webp';
    return u;
  }
  var diagLog = [];
  function diag(name, detail) {
    var row = { t: new Date().toISOString().slice(11, 23), name: name, detail: detail == null ? '' : String(detail).slice(0, 400) };
    diagLog.push(row); if (diagLog.length > 300) diagLog.shift();
    if (!window.BILI_CFG.diag) return;
    try { fetch(window.BILI_CFG.diag, { method: 'POST', body: JSON.stringify({ app: 'bili-tv', log: diagLog }) }).catch(function () {}); } catch (e) {}
  }
  window.U = { $: $, el: el, fmtTime: fmtTime, fmtCount: fmtCount, parseDur: parseDur, stripHtml: stripHtml, pic: pic, diag: diag };
})();
