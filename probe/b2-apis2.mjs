import fs from 'node:fs';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const cookie = fs.readFileSync(new URL('./.cookie', import.meta.url), 'utf8').trim();
const H = { 'User-Agent': UA, Referer: 'https://live.bilibili.com/', Cookie: cookie };
const J = async (u) => { const r = await fetch(u, { headers: H }); const t = await r.text(); try { return JSON.parse(t); } catch { return { raw: t.slice(0, 120), status: r.status }; } };
const k = (o) => o && typeof o === 'object' ? Object.keys(o).slice(0, 16).join(',') : o;
const tries = {
  'second/getListByArea': 'https://api.live.bilibili.com/xlive/web-interface/v1/second/getListByArea?platform=web&sort=online&page_size=30&page=1',
  'Area/getRoomList': 'https://api.live.bilibili.com/room/v1/Area/getRoomList?platform=web&parent_area_id=0&cate_id=0&area_id=0&sort_type=online&page=1&page_size=30',
  'second/getList(nosign)': 'https://api.live.bilibili.com/xlive/web-interface/v1/second/getList?platform=web&parent_area_id=0&area_id=0&sort_type=online&page=1',
  'index/getList': 'https://api.live.bilibili.com/xlive/web-interface/v1/index/getList?platform=web',
  'webMain/getMoreRecList': 'https://api.live.bilibili.com/xlive/web-interface/v1/webMain/getMoreRecList?platform=web',
};
let roomid = null;
for (const [n, u] of Object.entries(tries)) {
  const r = await J(u);
  const list = r.data?.list || r.data?.recommend_room_list || r.data?.room_list;
  let first = Array.isArray(list) ? list[0] : null;
  if (first && first.list) first = first.list[0];
  console.log(n, 'code', r.code, r.message, 'n', Array.isArray(list) ? list.length : '-', 'item:', k(first));
  if (!roomid && first && (first.roomid || first.room_id)) roomid = first.roomid || first.room_id;
}
console.log('roomid', roomid);
if (roomid) {
  const r = await J('https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo?' + new URLSearchParams({ room_id: roomid, protocol: '0,1', format: '0,1,2', codec: '0,1', qn: 10000, platform: 'web', ptype: 8, dolby: 5, panorama: 1 }));
  const st = r.data?.playurl_info?.playurl?.stream || [];
  console.log('play code', r.code, 'live_status', r.data?.live_status, JSON.stringify(st.map((s) => [s.protocol_name, (s.format || []).map((x) => [x.format_name, (x.codec || []).map((c) => c.codec_name + ':' + c.current_qn + ':' + (c.url_info?.[0]?.host || '').slice(8, 40))])])));
  const c = st.flatMap((s) => (s.format || []).filter((x) => x.format_name === 'fmp4' || x.format_name === 'ts').map((x) => ({ p: s.protocol_name, f: x.format_name, c: x.codec[0] })))[0];
  if (c) {
    const url = c.c.url_info[0].host + c.c.base_url + c.c.url_info[0].extra;
    for (const [n, ref] of [['noRef', undefined], ['liveRef', 'https://live.bilibili.com/'], ['wrongRef', 'https://example.com/']]) {
      const h = { 'User-Agent': UA }; if (ref) h.Referer = ref;
      const rr = await fetch(url, { headers: h }); const t = await rr.text();
      console.log('stream', c.p, c.f, n, rr.status, rr.headers.get('content-type'), 'acao', rr.headers.get('access-control-allow-origin'), t.slice(0, 60).replace(/\n/g, ' | '));
    }
  }
}
// 番剧：从热门里找番剧条目的 bvid → view 拿 ep
const pop = await (await fetch('https://api.bilibili.com/x/web-interface/popular?ps=50&pn=1', { headers: { 'User-Agent': UA } })).json();
const bg = pop.data.list.find((x) => /bangumi/.test(x.uri || x.redirect_url || ''));
console.log('bangumi item', bg && (bg.uri || bg.redirect_url), bg && k(bg));
const pu = pop.data.list.find((x) => x.bvid === 'BV1vVxi68EWD');
if (pu) console.log('BV1vV.. uri', pu.uri, pu.redirect_url, pu.rcmd_reason?.content);
