// B0 探测：匿名接口 + WBI 签名 + 取流 + CDN Referer/CORS/速度。不碰电视。
// 用法：node probe.mjs [cookie文件]  （cookie 文件由 login.mjs 生成，只存本地）
import crypto from 'node:crypto';
import fs from 'node:fs';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const cookieFile = process.argv[2];
const cookie = cookieFile && fs.existsSync(cookieFile) ? fs.readFileSync(cookieFile, 'utf8').trim() : '';
const report = { time: new Date().toISOString(), loggedIn: !!cookie, steps: {} };

const H = (extra = {}) => ({ 'User-Agent': UA, Referer: 'https://www.bilibili.com/', ...(cookie ? { Cookie: cookie } : {}), ...extra });
const getJSON = async (url) => (await fetch(url, { headers: H() })).json();

// ---- WBI 签名（社区公开算法：打乱表取 32 位 mixin key）----
const MIXIN = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];
const mixinKey = (o) => MIXIN.map((i) => o[i]).join('').slice(0, 32);
async function getKey() {
  const nav = await getJSON('https://api.bilibili.com/x/web-interface/nav');
  const f = (u) => u.slice(u.lastIndexOf('/') + 1, u.lastIndexOf('.'));
  return mixinKey(f(nav.data.wbi_img.img_url) + f(nav.data.wbi_img.sub_url));
}
function sign(params, key) {
  const p = { ...params, wts: Math.floor(Date.now() / 1000) };
  const q = Object.keys(p).sort().map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(p[k]).replace(/[!'()*]/g, ''))}`).join('&');
  return q + '&w_rid=' + crypto.createHash('md5').update(q + key).digest('hex');
}

const key = await getKey();
report.steps.wbiKeyLen = key.length;

// 1. 热门
const pop = await getJSON('https://api.bilibili.com/x/web-interface/popular?ps=5&pn=1');
report.steps.popular = { code: pop.code, count: pop.data?.list?.length, first: pop.data?.list?.[0] && { bvid: pop.data.list[0].bvid, cid: pop.data.list[0].cid, title: pop.data.list[0].title } };

// 2. 推荐（WBI）
const rcmd = await getJSON('https://api.bilibili.com/x/web-interface/wbi/index/top/feed/rcmd?' + sign({ ps: 5, fresh_idx: 1 }, key));
report.steps.recommend = { code: rcmd.code, msg: rcmd.message, count: rcmd.data?.item?.length };

// 3. 搜索（WBI）
const sr = await getJSON('https://api.bilibili.com/x/web-interface/wbi/search/type?' + sign({ search_type: 'video', keyword: '纪录片' }, key));
report.steps.search = { code: sr.code, msg: sr.message, count: sr.data?.result?.length };

// 4. 取流：热门第一个视频
// 取推荐里第一个普通视频（热门第一条可能是番剧，要走 PGC 接口）
const rcmd2 = await getJSON('https://api.bilibili.com/x/web-interface/wbi/index/top/feed/rcmd?' + sign({ ps: 12, fresh_idx: 2 }, key));
const v = rcmd2.data.item.find((x) => x.goto === 'av' && x.bvid && x.cid);
report.steps.pickedVideo = { bvid: v.bvid, cid: v.cid, title: v.title };
async function playurl(fnval, qn, extra = {}) {
  return getJSON('https://api.bilibili.com/x/player/wbi/playurl?' + sign({ bvid: v.bvid, cid: v.cid, qn, fnval, fnver: 0, fourk: 1, ...extra }, key));
}
const dash = await playurl(4048, 80);
report.steps.playurlDash = {
  code: dash.code, msg: dash.message,
  accept: dash.data?.accept_quality, // 可用清晰度
  videos: dash.data?.dash?.video?.map((x) => ({ id: x.id, codecid: x.codecid, codecs: x.codecs, bw: x.bandwidth, w: x.width, h: x.height })),
  audios: dash.data?.dash?.audio?.map((x) => ({ id: x.id, bw: x.bandwidth })),
};
const mp4 = await playurl(1, 64);
report.steps.playurlMp4 = { code: mp4.code, quality: mp4.data?.quality, fmt: mp4.data?.format, hasUrl: !!mp4.data?.durl?.[0]?.url };

// 5. CDN：取 AVC 视频第一段，带/不带 Referer 各试
const avc = dash.data?.dash?.video?.find((x) => x.codecid === 7) || dash.data?.dash?.video?.[0];
if (avc) {
  const url = avc.baseUrl || avc.base_url;
  report.steps.cdnHost = new URL(url).host;
  const tryRange = async (name, headers) => {
    const t0 = Date.now();
    const r = await fetch(url, { headers: { 'User-Agent': UA, Range: 'bytes=0-2097151', ...headers } });
    const buf = r.ok || r.status === 206 ? Buffer.from(await r.arrayBuffer()) : null;
    const ms = Date.now() - t0;
    return { status: r.status, bytes: buf?.length ?? 0, ms, mbps: buf ? +((buf.length * 8) / 1e6 / (ms / 1000)).toFixed(1) : null,
      acao: r.headers.get('access-control-allow-origin'), acah: r.headers.get('access-control-allow-headers') };
  };
  report.steps.cdn = {
    withReferer: await tryRange('ref', { Referer: 'https://www.bilibili.com/' }),
    noReferer: await tryRange('noref', {}),
    wrongReferer: await tryRange('wrong', { Referer: 'https://example.com/' }),
    withOriginOnly: await tryRange('origin', { Origin: 'file://' }),
  };
  // 更长的一段测持续速度（8 MB，带 Referer）
  const t0 = Date.now();
  const r = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/', Range: 'bytes=2097152-10485759' } });
  const n = (await r.arrayBuffer()).byteLength; const s = (Date.now() - t0) / 1000;
  report.steps.cdnSpeed8MB = { status: r.status, mbps: +((n * 8) / 1e6 / s).toFixed(1) };

  // 备用节点（backup_url）：同样测 无 Referer / 错 Referer / 对 Referer
  const urls = [avc.baseUrl || avc.base_url, ...(avc.backupUrl || avc.backup_url || [])];
  report.steps.cdnAllHosts = [];
  for (const u of urls) {
    const row = { host: new URL(u).host };
    for (const [name, h] of [['noRef', {}], ['wrongRef', { Referer: 'https://example.com/' }], ['okRef', { Referer: 'https://www.bilibili.com/' }]]) {
      try { row[name] = (await fetch(u, { headers: { 'User-Agent': UA, Range: 'bytes=0-1023', ...h } })).status; } catch (e) { row[name] = 'ERR ' + e.cause?.code; }
    }
    report.steps.cdnAllHosts.push(row);
  }
}

// 6. API 接口的 CORS（预检 + 带 Origin）
const o = await fetch('https://api.bilibili.com/x/web-interface/popular?ps=1', { headers: { 'User-Agent': UA, Origin: 'file://' } });
report.steps.apiCors = { acao: o.headers.get('access-control-allow-origin'), acac: o.headers.get('access-control-allow-credentials') };
const pf = await fetch('https://api.bilibili.com/x/web-interface/popular?ps=1', { method: 'OPTIONS', headers: { 'User-Agent': UA, Origin: 'file://', 'Access-Control-Request-Method': 'GET' } });
report.steps.apiPreflight = { status: pf.status, acao: pf.headers.get('access-control-allow-origin') };

fs.writeFileSync(new URL('./report.json', import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
