// 收集 Bili TV 测试版回传的诊断日志（0.0.0.0:8765 → runs-b2/latest.json）。不含任何令牌。
import http from 'node:http';
import fs from 'node:fs';
fs.mkdirSync(new URL('./runs-b2/', import.meta.url), { recursive: true });
const file = new URL('./runs-b2/latest.json', import.meta.url);
http.createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  let b = ''; req.on('data', (c) => (b += c));
  req.on('end', () => {
    try { fs.writeFileSync(file, JSON.stringify(JSON.parse(b), null, 1)); } catch {}
    res.writeHead(200, cors); res.end('ok');
  });
}).listen(8765, '0.0.0.0', () => console.log('collector :8765 →', file.pathname));
