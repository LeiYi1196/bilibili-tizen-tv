// 追加探测：UP 主页视频 / UP 名片 / 收藏夹增删改 / 视频收藏。会在小号上建一个测试收藏夹并在最后删掉。
import crypto from 'node:crypto';
import fs from 'node:fs';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const cookie = fs.readFileSync(new URL('./.cookie', import.meta.url), 'utf8').trim();
const csrf = (cookie.match(/bili_jct=([^;]+)/) || [])[1];
const H = { 'User-Agent': UA, Referer: 'https://www.bilibili.com/', Origin: 'https://www.bilibili.com', Cookie: cookie };
const J = async (u, opt = {}) => (await fetch(u, { headers: H, ...opt })).json();
const POST = (u, f) => J(u, { method: 'POST', body: new URLSearchParams({ ...f, csrf }), headers: { ...H, 'Content-Type': 'application/x-www-form-urlencoded' } });
const MIX = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];
const nav = await J('https://api.bilibili.com/x/web-interface/nav');
const f = (u) => u.slice(u.lastIndexOf('/') + 1, u.lastIndexOf('.'));
const o = f(nav.data.wbi_img.img_url) + f(nav.data.wbi_img.sub_url);
const key = MIX.map((i) => o[i]).join('').slice(0, 32);
const sign = (p) => { p = { ...p, wts: Math.floor(Date.now() / 1000) }; const q = Object.keys(p).sort().map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(p[k]).replace(/[!'()*]/g, ''))}`).join('&'); return q + '&w_rid=' + crypto.createHash('md5').update(q + key).digest('hex'); };
const mid = nav.data.mid;
const out = {};
// 1 UP 主页视频（用影视飓风 946974 做样本）
let r = await J('https://api.bilibili.com/x/space/wbi/arc/search?' + sign({ mid: 946974, ps: 20, pn: 1, order: 'pubdate', platform: 'web', web_location: 1550101 }));
out.upVideos = { code: r.code, msg: r.message, n: r.data?.list?.vlist?.length, total: r.data?.page?.count, sample: r.data?.list?.vlist?.[0] && Object.keys(r.data.list.vlist[0]).join(',') };
if (r.code !== 0) { // 备用：不带 WBI 的旧接口
  r = await J(`https://api.bilibili.com/x/series/recArchivesByKeywords?mid=946974&keywords=&ps=20`); out.upVideosAlt = { code: r.code, n: r.data?.archives?.length };
}
r = await J('https://api.bilibili.com/x/web-interface/card?mid=946974&photo=false');
out.upCard = { code: r.code, name: r.data?.card?.name, fans: r.data?.card?.fans ?? r.data?.follower, sign: (r.data?.card?.sign || '').slice(0, 20), following: r.data?.following };
// 2 收藏夹增删改 + 收藏视频
r = await POST('https://api.bilibili.com/x/v3/fav/folder/add', { title: 'tvlab测试夹', intro: '', privacy: '1' });
out.folderAdd = { code: r.code, msg: r.message, id: r.data?.id };
const fid = r.data?.id;
if (fid) {
  r = await POST('https://api.bilibili.com/x/v3/fav/folder/edit', { media_id: fid, title: 'tvlab测试夹2', intro: '', privacy: '1' });
  out.folderEdit = { code: r.code, msg: r.message };
  // 视频：取一个 aid
  const v = await J('https://api.bilibili.com/x/web-interface/view?bvid=BV1TxxC6vEo4');
  const aid = v.data.aid;
  r = await J(`https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=${mid}&rid=${aid}&type=2`);
  out.listWithRid = { code: r.code, sample: r.data?.list?.map((x) => ({ t: x.title, state: x.fav_state })) };
  r = await POST('https://api.bilibili.com/x/v3/fav/resource/deal', { rid: aid, type: 2, add_media_ids: fid, del_media_ids: '' });
  out.dealAdd = { code: r.code, msg: r.message };
  r = await J(`https://api.bilibili.com/x/v3/fav/resource/list?media_id=${fid}&pn=1&ps=20&platform=web`);
  out.itemsAfterAdd = { code: r.code, n: r.data?.medias?.length, sample: r.data?.medias?.[0] && { bvid: r.data.medias[0].bvid, id: r.data.medias[0].id, type: r.data.medias[0].type } };
  r = await J(`https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=${mid}&rid=${aid}&type=2`);
  out.stateAfterAdd = r.data?.list?.map((x) => ({ t: x.title, state: x.fav_state }));
  r = await POST('https://api.bilibili.com/x/v3/fav/resource/deal', { rid: aid, type: 2, add_media_ids: '', del_media_ids: fid });
  out.dealDel = { code: r.code, msg: r.message };
  r = await POST('https://api.bilibili.com/x/v3/fav/folder/del', { media_ids: fid });
  out.folderDel = { code: r.code, msg: r.message };
}
console.log(JSON.stringify(out, null, 1));
