import fs from 'node:fs';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const cookie = fs.readFileSync(new URL('./.cookie', import.meta.url), 'utf8').trim();
const J = async (u, ref = 'https://live.bilibili.com/') => (await fetch(u, { headers: { 'User-Agent': UA, Referer: ref, Cookie: cookie } })).json();
const rec = await J('https://api.live.bilibili.com/xlive/web-interface/v1/webMain/getMoreRecList?platform=web');
const rid = rec.data.recommend_room_list[0].roomid;
const r = await J('https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo?' + new URLSearchParams({ room_id: rid, protocol: '0,1', format: '0,1,2', codec: '0,1', qn: 10000, platform: 'web', ptype: 8, dolby: 5, panorama: 1 }));
console.log('room', rid, 'room_id(real)', r.data.room_id, 'status', r.data.live_status);
for (const s of r.data.playurl_info.playurl.stream) for (const f of s.format) for (const c of f.codec) {
  const ui = c.url_info[0];
  const url = ui.host + c.base_url + ui.extra;
  const path = c.base_url.split('?')[0].slice(-40);
  const res = {};
  for (const [n, ref] of [['noRef', undefined], ['liveRef', 'https://live.bilibili.com/']]) {
    const h = { 'User-Agent': UA }; if (ref) h.Referer = ref;
    try {
      const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 6000);
      const rr = await fetch(url, { headers: h, signal: ac.signal });
      const rd = rr.body.getReader(); const { value } = await rd.read(); ac.abort(); clearTimeout(to);
      res[n] = rr.status + ' ' + (rr.headers.get('content-type') || '') + ' ' + Buffer.from(value || []).toString('latin1').slice(0, 40).replace(/[^\x20-\x7e]/g, '.');
    } catch (e) { res[n] = 'ERR ' + e.message; }
  }
  console.log(s.protocol_name, f.format_name, c.codec_name, 'qn', c.current_qn, 'accept', JSON.stringify(c.accept_qn), '...' + path, JSON.stringify(res));
}
// 番剧：ep3854822
const p = await J('https://api.bilibili.com/pgc/player/web/playurl?ep_id=3854822&qn=80&fnval=4048&fourk=1', 'https://www.bilibili.com/');
console.log('pgc playurl', p.code, p.message, 'dash', !!p.result?.dash, 'video n', p.result?.dash?.video?.length, 'accept', JSON.stringify(p.result?.accept_quality), 'keys', Object.keys(p.result || {}).slice(0, 12).join(','));
const v = p.result?.dash?.video?.[0];
if (v) { const rr = await fetch(v.baseUrl || v.base_url, { headers: { 'User-Agent': UA, Range: 'bytes=0-1023' } }); console.log('pgc cdn noRef', rr.status, new URL(v.baseUrl || v.base_url).host); }
const s = await J('https://api.bilibili.com/pgc/view/web/season?ep_id=3854822', 'https://www.bilibili.com/');
console.log('season', s.code, 'title', s.result?.title, 'eps', s.result?.episodes?.length, 'ep0 keys', Object.keys(s.result?.episodes?.[0] || {}).join(','));
