import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {initialState,changeStatus,serve} from '../src/lib/engine';
import {createTelegramService,pendingTask} from '../src/lib/telegram-notifications';

function fixture(token='private-token',status=200){
 const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE workspaces (key TEXT PRIMARY KEY,payload TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,updated_at INTEGER NOT NULL)');
 const db={prepare(query:string){const statement=sql.prepare(query);let args:any[]=[];const p={bind(...values:any[]){args=values;return p;},async first(){return statement.get(...args)||null;},async all(){return {results:statement.all(...args)};},async run(){return {meta:{changes:Number(statement.run(...args).changes)}};}};return p;}} as unknown as D1Database;
 const sent:{url:string;method:string;body:any}[]=[];
 const fetcher:typeof fetch=async(url,init)=>{const method=String(url).split('/').at(-1)!;sent.push({url:String(url),method,body:JSON.parse(String(init?.body))});return Response.json({ok:status===200,result:method==='getMe'?{username:'test_bot'}:{message_id:1}},{status});};
 const service=createTelegramService(db,{TELEGRAM_BOT_TOKEN:token,TELEGRAM_WEBHOOK_SECRET:'secret'},fetcher);
 const save=(key:string,value:unknown)=>sql.prepare('INSERT INTO workspaces VALUES (?,?,1,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,revision=workspaces.revision+1').run(key,JSON.stringify(value),Date.now());
 const webhook=(body:unknown,secret='secret')=>service.webhook(new Request('https://site.test/api/telegram/webhook',{method:'POST',headers:{'x-telegram-bot-api-secret-token':secret},body:JSON.stringify(body)}));
 return {sql,db,fetcher,service,sent,save,webhook};
}

test('pasted token whitespace is trimmed and rejected credentials get an actionable private error',async()=>{
 for(const status of [200,404,401]){
  const f=fixture(' private-token\r\n',status);try{
   const response=await f.service.config(new Request('http://localhost/api/notifications',{method:'POST',headers:{origin:'http://localhost'},body:JSON.stringify({action:'link'})}));
   assert.equal(f.sent[0].url,'https://api.telegram.org/botprivate-token/getMe');
   assert.equal(response.status,status===200?200:503);
   const text=await response.text();assert.doesNotMatch(text,/private-token/);
   if(status!==200)assert.match(text,/TELEGRAM_BOT_TOKEN/);
  }finally{f.sql.close();}
 }
});

test('repeated linking reuses webhook registration; token rotation registers the new bot',async()=>{
 const f=fixture();try{
  const request=()=>new Request('http://localhost/api/notifications',{method:'POST',headers:{origin:'http://localhost'},body:JSON.stringify({action:'link'})});
  assert.equal((await f.service.config(request())).status,200);
  assert.equal((await f.service.config(request())).status,200);
  assert.equal(f.sent.filter(s=>s.method==='setWebhook').length,1);
  assert.equal(f.sent.filter(s=>s.method==='getMe').length,2);
  const rotated=createTelegramService(f.db,{TELEGRAM_BOT_TOKEN:'rotated-token',TELEGRAM_WEBHOOK_SECRET:'secret'},f.fetcher);
  assert.equal((await rotated.config(request())).status,200);
  assert.equal(f.sent.filter(s=>s.method==='setWebhook').length,2);
 }finally{f.sql.close();}
});

test('Telegram rate limit shows the actual retry delay without exposing credentials',async()=>{
 const f=fixture();try{
  const service=createTelegramService(f.db,{TELEGRAM_BOT_TOKEN:'private-token',TELEGRAM_WEBHOOK_SECRET:'secret'},async()=>Response.json({ok:false,parameters:{retry_after:42}},{status:429}));
  const r=await service.config(new Request('http://localhost/api/notifications',{method:'POST',headers:{origin:'http://localhost'},body:JSON.stringify({action:'link'})}));
  assert.equal(r.status,503);const body=await r.text();assert.match(body,/42/);assert.doesNotMatch(body,/private-token/);
 }finally{f.sql.close();}
});
test('cleaning deadline survives entering cleaning; manual completion and approach close tasks',()=>{
 const now=Date.now();let state=initialState('live',now);
 state=changeStatus(state,1,'occupied',now,'manual');assert.equal(pendingTask(state.tables[0],state)?.dueAt,now+180000);
 state=serve(state,1,now+30000);assert.equal(pendingTask(state.tables[0],state),null);
 state=changeStatus(state,1,'dirty',now+60000,'manual');state=changeStatus(state,1,'cleaning',now+120000,'manual');
 assert.equal(pendingTask(state.tables[0],state)?.since,now+60000);
 assert.equal(pendingTask(state.tables[0],state)?.dueAt,now+360000);
 state=changeStatus(state,1,'free',now+180000,'manual');assert.equal(pendingTask(state.tables[0],state),null);
});
test('dispatch is independent of browser, avoids concurrent duplicates, repeats after five minutes, excludes demo',async()=>{
 const f=fixture(),now=Date.now();try{
  f.save('tg:binding:web:test',{owner:'web:test',chatId:123,enabled:true});
  const state=changeStatus(initialState('live',now),2,'occupied',now-240000,'manual');f.save('web:test:live',state);
  f.save('web:test:demo',initialState('demo',now));
  await Promise.all([f.service.dispatch(now),f.service.dispatch(now)]);
  assert.equal(f.sent.filter(s=>s.method==='sendMessage').length,1);
  assert.match(f.sent[0].body.text,/Стол №2/);assert.match(f.sent[0].body.text,/4 мин/);
  await f.service.dispatch(now+100000);assert.equal(f.sent.length,1);
  await f.service.dispatch(now+300000);assert.equal(f.sent.length,2);
  f.save('web:test:live',serve(state,2,now+300001));await f.service.dispatch(now+600000);assert.equal(f.sent.length,2);
 }finally{f.sql.close();}
});
test('Telegram completion updates the correct workspace; stale and other-chat callbacks cannot modify it',async()=>{
 const f=fixture(),now=Date.now();try{
  f.save('tg:binding:web:test',{owner:'web:test',chatId:123,enabled:true});f.save('web:test:live',changeStatus(initialState('live',now),2,'occupied',now-240000,'manual'));
  await f.service.dispatch(now);
  const callback=f.sent[0].body.reply_markup.inline_keyboard[1][0].callback_data;
  const event=(chat:number)=>({callback_query:{id:'cb',from:{id:chat,first_name:'Staff'},message:{chat:{id:chat}},data:callback}});
  await f.webhook(event(999));let row=f.sql.prepare('SELECT payload FROM workspaces WHERE key=?').get('web:test:live') as {payload:string};assert.equal(JSON.parse(row.payload).tables[1].servedAt,null);
  await f.webhook(event(123));row=f.sql.prepare('SELECT payload FROM workspaces WHERE key=?').get('web:test:live') as {payload:string};assert.ok(JSON.parse(row.payload).tables[1].servedAt);
  const state=changeStatus(changeStatus(JSON.parse(row.payload),2,'free',now+1,'manual'),2,'occupied',now+2,'manual');f.save('web:test:live',state);
  await f.webhook(event(123));row=f.sql.prepare('SELECT payload FROM workspaces WHERE key=?').get('web:test:live') as {payload:string};assert.equal(JSON.parse(row.payload).tables[1].servedAt,null);
  assert.equal((await f.webhook(event(123),'wrong')).status,401);
 }finally{f.sql.close();}
});
test('link is single-use, expires and never reveals bot credentials',async()=>{
 const f=fixture();try{
  const r=await f.service.config(new Request('http://localhost/api/notifications',{method:'POST',headers:{origin:'http://localhost'},body:JSON.stringify({action:'link'})}));
  assert.equal(r.status,200);const data=await r.json() as {url:string};assert.doesNotMatch(data.url,/private-token/);
  const code=new URL(data.url).searchParams.get('start');
  await f.webhook({message:{text:`/start ${code}`,chat:{id:123,type:'private'}}});
  await f.webhook({message:{text:`/start ${code}`,chat:{id:999,type:'private'}}});
  const row=f.sql.prepare('SELECT payload FROM workspaces WHERE key=?').get('tg:binding:local-development') as {payload:string};assert.equal(JSON.parse(row.payload).chatId,123);
  assert.equal((await f.service.config(new Request('http://localhost/api/notifications',{method:'POST',headers:{origin:'https://evil.test'},body:'{}'}))).status,403);
 }finally{f.sql.close();}
});
