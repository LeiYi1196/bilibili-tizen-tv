// 运行配置。?dev=1 走本机开发代理（桌面联调）；电视上直连 B 站（打包应用 access * 已验证可跨域）。
(function () {
  var q = new URLSearchParams(location.search);
  var dev = q.get('dev') === '1';
  window.BILI_CFG = {
    dev: dev,
    api: dev ? 'http://127.0.0.1:8787/api' : 'https://api.bilibili.com',
    live: dev ? 'http://127.0.0.1:8787/live' : 'https://api.live.bilibili.com',
    passport: dev ? 'http://127.0.0.1:8787/passport' : 'https://passport.bilibili.com',
    // 电视上让浏览器自己保存 / 发送 B 站 Cookie；开发代理自己注入 Cookie
    credentials: dev ? 'omit' : 'include',
    // 诊断回传（测试版）：关键事件 POST 到 Mac 收集器，便于远程看电视上发生了什么；不含任何令牌
    diag: q.get('diag') !== '0' ? (window.BILI_DIAG || '') : '',
    ahead: 30, back: 20
  };
  window.BILI_CFG_DIRECT = { api: window.BILI_CFG.api, live: window.BILI_CFG.live, credentials: window.BILI_CFG.credentials };   // hub 连不上时退回的直连配置
})();
