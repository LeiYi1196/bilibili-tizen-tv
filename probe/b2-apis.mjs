// B2 追加探测：动态 / 直播 / 收藏夹 / 字幕 / 番剧取流。只打印结构摘要，不打印令牌。
import crypto from 'node:crypto';
import fs from 'node:fs';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const cookie = fs.readFileSync(new URL('./.cookie', import.meta.url), 'utf8').trim();
const H = { 'User-Agent': UA, Referer: 'https://www.bilibili.com/', Cookie: cookie };
const J = async (u, h = {}) => { const r = await fetch(u, { headers: { ...H, ...h } }); const t = await r.text(); try { return JSON.parse(t); } catch { return { raw: t.slice(0, 200), status: r.status }; } };
const MIXIN = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];
const nav = await J('https://api.bilibili.com/x/web-interface/nav');
const f = (u) => u.slice(u.lastIndexOf('/') + 1, u.lastIndexOf('.'));
const o = f(nav.data.wbi_img.img_url) + f(nav.data.wbi_img.sub_url);
const key = MIXIN.map((i) => o[i]).join('').slice(0, 32);
const sign = (params) => { const p = { ...params, wts: Math.floor(Date.now() / 1000) }; const q = Object.keys(p).sort().map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(p[k]).replace(/[!'()*]/g, ''))}`).join('&'); return q + '&w_rid=' + crypto.createHash('md5').update(q + key).digest('hex'); };
const mid = nav.data.mid;
const keys = (o, d = 1) => o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).slice(0, 14).map(([k, v]) => [k, d > 0 && v && typeof v === 'object' && !Array.isArray(v) ? keys(v, d - 1) : Array.isArray(v) ? `[${v.length}]` : typeof v === 'string' ? v.slice(0, 40) : v])) : o;
const out = {};

// 1 关注动态（视频）
let r = await J('https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/all?' + new URLSearchParams({ type: 'video', timezone_offset: -480, platform: 'web', features: 'itemOpusStyle' }));
out.dynamic = { code: r.code, msg: r.message, n: r.data?.items?.length, offset: r.data?.offset, hasMore: r.data?.has_more, sample: r.data?.items?.[0] && { type: r.data.items[0].type, author: r.data.items[0].modules?.module_author?.name, major: keys(r.data.items[0].modules?.module_dynamic?.major?.archive) } };
// 1b 带 WBI
if (r.code !== 0) { r = await J('https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/all?' + sign({ type: 'video', timezone_offset: -480, platform: 'web', features: 'itemOpusStyle' })); out.dynamicWbi = { code: r.code, msg: r.message, n: r.data?.items?.length }; }

// 2 直播：关注的主播 / 推荐
r = await J('https://api.live.bilibili.com/xlive/web-ucenter/v1/xfetter/GetWebList?page=1&page_size=20');
out.liveFollow = { code: r.code, msg: r.message, n: r.data?.list?.length, sample: keys(r.data?.list?.[0]) };
r = await J('https://api.live.bilibili.com/xlive/web-interface/v1/second/getList?' + sign({ platform: 'web', parent_area_id: 0, area_id: 0, sort_type: 'online', page: 1 }));
out.liveList = { code: r.code, msg: r.message, n: r.data?.list?.length, sample: keys(r.data?.list?.[0]) };
let roomid = r.data?.list?.[0]?.roomid;
if (!roomid) { r = await J('https://api.live.bilibili.com/xlive/web-interface/v1/index/getList?platform=web'); out.liveIndex = { code: r.code, n: r.data?.room_list?.length }; roomid = r.data?.room_list?.[0]?.module_info && r.data.room_list[0].list?.[0]?.roomid; }
// 3 直播取流
if (roomid) {
  r = await J('https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo?' + new URLSearchParams({ room_id: roomid, protocol: '0,1', format: '0,1,2', codec: '0,1', qn: 10000, platform: 'web', ptype: 8, dolby: 5, panorama: 1 }));
  const st = r.data?.playurl_info?.playurl?.stream || [];
  out.livePlay = { roomid, code: r.code, live_status: r.data?.live_status, streams: st.map((s) => ({ proto: s.protocol_name, formats: (s.format || []).map((x) => ({ f: x.format_name, codecs: (x.codec || []).map((c) => ({ c: c.codec_name, qn: c.current_qn, host: c.url_info?.[0]?.host?.slice(0, 40), baseOK: !!c.base_url })) })) })) };
}
// 4 收藏夹
r = await J('https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=' + mid);
out.favFolders = { code: r.code, n: r.data?.list?.length, sample: keys(r.data?.list?.[0]) };
const fid = r.data?.list?.[0]?.id;
if (fid) { r = await J(`https://api.bilibili.com/x/v3/fav/resource/list?media_id=${fid}&pn=1&ps=20&platform=web`); out.favItems = { code: r.code, n: r.data?.medias?.length, hasMore: r.data?.has_more, sample: keys(r.data?.medias?.[0]) }; }
// 5 字幕：找一个带 AI 字幕的热门视频
const pop = await J('https://api.bilibili.com/x/web-interface/popular?ps=20&pn=1');
out.subtitles = [];
for (const v of pop.data.list.slice(0, 8)) {
  if (!v.bvid || (v.redirect_url || '').includes('bangumi')) continue;
  const p = await J('https://api.bilibili.com/x/player/wbi/v2?' + sign({ bvid: v.bvid, cid: v.cid }));
  const subs = p.data?.subtitle?.subtitles || [];
  out.subtitles.push({ bvid: v.bvid, n: subs.length, langs: subs.map((s) => s.lan + ':' + s.lan_doc), login: p.data?.login_mid_hash ? 'y' : 'n' });
  if (subs[0]) {
    const url = subs[0].subtitle_url.startsWith('//') ? 'https:' + subs[0].subtitle_url : subs[0].subtitle_url;
    const sr = await fetch(url, { headers: { 'User-Agent': UA } });
    const sj = await sr.json();
    out.subtitleFile = { status: sr.status, acao: sr.headers.get('access-control-allow-origin'), lines: sj.body?.length, first: sj.body?.[0], host: new URL(url).host };
    break;
  }
}
// 6 番剧取流（热门第一条常是番剧）
const bg = pop.data.list.find((x) => (x.redirect_url || '').includes('bangumi'));
if (bg) {
  const ep = (bg.redirect_url.match(/ep(\d+)/) || [])[1];
  r = await J(`https://api.bilibili.com/pgc/player/web/playurl?ep_id=${ep}&qn=80&fnval=4048&fourk=1`);
  out.pgc = { ep, code: r.code, msg: r.message, hasDash: !!r.result?.dash, accept: r.result?.accept_quality, vids: r.result?.dash?.video?.length, redirect: bg.redirect_url };
  r = await J(`https://api.bilibili.com/pgc/view/web/season?ep_id=${ep}`);
  out.pgcSeason = { code: r.code, eps: r.result?.episodes?.length, ep0: keys(r.result?.episodes?.[0]) };
}
console.log(JSON.stringify(out, null, 1));
