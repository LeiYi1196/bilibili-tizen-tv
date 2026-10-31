// 桌面联调用的开发代理：把 /api/* 转 api.bilibili.com、/passport/* 转 passport.bilibili.com，
// 补 UA / Referer / 小号 Cookie 和 CORS。仅本机 127.0.0.1；Cookie 来自 ../probe/.cookie，不外传。
import http from 'node:http';
import fs from 'node:fs';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const cookie = fs.readFileSync(new URL('../probe/.cookie', import.meta.url), 'utf8').trim();
const csrf = (cookie.match(/bili_jct=([^;]+)/) || [])[1] || '';
const HOSTS = { '/api/': 'https://api.bilibili.com/', '/passport/': 'https://passport.bilibili.com/', '/live/': 'https://api.live.bilibili.com/' };
http.createServer(async (req, res) => {
  const cors = { 'Access-Control-Allow-Origin': req.headers.origin || '*', 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  if (req.url === '/dev/session') { res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ csrf })); }
  const base = Object.keys(HOSTS).find((p) => req.url.startsWith(p));
  if (!base) { res.writeHead(404, cors); return res.end(); }
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  try {
    const r = await fetch(HOSTS[base] + req.url.slice(base.length), {
      method: req.method, body,
      headers: { 'User-Agent': UA, Referer: base === '/live/' ? 'https://live.bilibili.com/' : 'https://www.bilibili.com/', Cookie: cookie, ...(req.headers['content-type'] ? { 'Content-Type': req.headers['content-type'] } : {}) },
    });
    const buf = Buffer.from(await r.arrayBuffer());
    res.writeHead(r.status, { ...cors, 'Content-Type': r.headers.get('content-type') || 'application/json' });
    res.end(buf);
  } catch (e) { res.writeHead(502, cors); res.end(String(e)); }
}).listen(8787, '127.0.0.1', () => console.log('dev proxy :8787'));
