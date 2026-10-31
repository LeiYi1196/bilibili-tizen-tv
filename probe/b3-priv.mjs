import fs from 'node:fs';
const UA='Mozilla/5.0 (Macintosh) Chrome/130';const cookie=fs.readFileSync('.cookie','utf8').trim();const csrf=(cookie.match(/bili_jct=([^;]+)/)||[])[1];
const H={'User-Agent':UA,Referer:'https://www.bilibili.com/',Origin:'https://www.bilibili.com',Cookie:cookie};
const J=async(u,o={})=>(await fetch(u,{headers:H,...o})).json();
const POST=(u,f)=>J(u,{method:'POST',body:new URLSearchParams({...f,csrf}),headers:{...H,'Content-Type':'application/x-www-form-urlencoded'}});
const nav=await J('https://api.bilibili.com/x/web-interface/nav');const mid=nav.data.mid;
const a=await POST('https://api.bilibili.com/x/v3/fav/folder/add',{title:'tvlab-pub',intro:'说明',privacy:'0'});
const b=await POST('https://api.bilibili.com/x/v3/fav/folder/add',{title:'tvlab-priv',intro:'',privacy:'1'});
const ls=await J('https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid='+mid);
for(const f of ls.data.list) console.log('list-all',f.title,'attr',f.attr);
for(const id of [a.data.id,b.data.id]){const i=await J('https://api.bilibili.com/x/v3/fav/folder/info?media_id='+id);console.log('info',i.data.title,'attr',i.data.attr,'intro',JSON.stringify(i.data.intro),'cnt',i.data.media_count)}
// 改名时不带 privacy 会怎样
await POST('https://api.bilibili.com/x/v3/fav/folder/edit',{media_id:b.data.id,title:'tvlab-priv2'});
const i2=await J('https://api.bilibili.com/x/v3/fav/folder/info?media_id='+b.data.id);console.log('私密夹改名(不带privacy)后 attr',i2.data.attr,i2.data.title);
await POST('https://api.bilibili.com/x/v3/fav/folder/del',{media_ids:a.data.id+','+b.data.id});
const l2=await J('https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid='+mid);console.log('清理后剩',l2.data.list.map(x=>x.title).join('|'));
