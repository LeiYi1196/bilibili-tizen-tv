// 扫码登录（用小号）：生成二维码页面 → 手机 B 站扫码确认 → 轮询拿到 Cookie，存到 .cookie（仅本地，已被 .gitignore 排除）
import fs from 'node:fs';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const H = { 'User-Agent': UA, Referer: 'https://www.bilibili.com/' };

const gen = await (await fetch('https://passport.bilibili.com/x/passport-login/web/qrcode/generate', { headers: H })).json();
if (gen.code !== 0) throw new Error('生成二维码失败: ' + JSON.stringify(gen));
const { url, qrcode_key } = gen.data;

// 本地 HTML：二维码由浏览器里的库本地渲染，登录链接不发给任何第三方
const html = `<!doctype html><meta charset=utf-8><title>B站扫码</title>
<body style="font-family:sans-serif;text-align:center;padding:40px">
<h2>用 B 站小号 App 扫码并确认登录</h2><div id=q style="display:inline-block;padding:16px;background:#fff"></div>
<p>扫完回到终端，脚本会自动继续。</p>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<script>new QRCode(document.getElementById('q'),{text:${JSON.stringify(url)},width:280,height:280});</script>`;
const htmlPath = new URL('./.qr.html', import.meta.url).pathname;
fs.writeFileSync(htmlPath, html);
console.log('QR_HTML=' + htmlPath);

// 轮询（二维码 180 秒有效）
for (let i = 0; i < 90; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const res = await fetch('https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=' + qrcode_key, { headers: H });
  const j = await res.json();
  const code = j.data?.code;
  if (i % 5 === 0) console.log('状态', code, j.data?.message);
  if (code === 0) {
    // Cookie 在响应头 Set-Cookie 里
    const sc = res.headers.getSetCookie().map((c) => c.split(';')[0]);
    fs.writeFileSync(new URL('./.cookie', import.meta.url), sc.join('; '), { mode: 0o600 });
    // 只打印 Cookie 名字，不打印值
    console.log('登录成功，Cookie 名:', sc.map((c) => c.split('=')[0]).join(','));
    fs.rmSync(htmlPath, { force: true });
    process.exit(0);
  }
  if (code === 86038) { console.log('二维码已过期'); process.exit(1); }
}
console.log('超时'); process.exit(1);
