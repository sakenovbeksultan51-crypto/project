import {changeStatus,serve,validateState,type AppState,type Table} from './engine';
import {requestOwner} from './request-owner';

type DB=Pick<D1Database,'prepare'>;
type Row={payload:string;revision:number};
type Binding={owner:string;chatId:number;enabled:boolean};
type Task={tableId:number;kind:'service'|'cleaning';since:number;dueAt:number};
type Delivery=Task&{owner:string;chatId:number;lastSent:number;leaseUntil:number;assignee?:string};
export type TelegramEnv={TELEGRAM_BOT_TOKEN?:string;TELEGRAM_BOT_USERNAME?:string;TELEGRAM_PUBLIC_URL?:string;TELEGRAM_WEBHOOK_SECRET?:string;NOTIFICATIONS_CRON_SECRET?:string;TELEGRAM_FETCH?:typeof fetch};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const hash=async(text:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(n=>n.toString(16).padStart(2,'0')).join('');
const read=async(db:DB,key:string)=>db.prepare('SELECT payload,revision FROM workspaces WHERE key=?').bind(key).first<Row>();
const save=async(db:DB,key:string,value:unknown)=>db.prepare('INSERT INTO workspaces (key,payload,revision,updated_at) VALUES (?,?,1,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,revision=workspaces.revision+1,updated_at=excluded.updated_at').bind(key,JSON.stringify(value),Date.now()).run();
export function normalizeTelegramToken(value?:string){
 const text=value?.trim()||'',matches=[...text.matchAll(/\d{5,}:[A-Za-z0-9_-]{20,}/g)].map(m=>m[0]);
 return [...new Set(matches)].length===1?matches[0]:text;
}
export function pendingTask(table:Table,state:AppState):Task|null{
 if(table.status==='occupied'&&!table.servedAt)return {tableId:table.id,kind:'service',since:table.since,dueAt:table.since+state.settings.serviceMinutes*60000};
 if(table.status==='dirty'||table.status==='cleaning'){
  const since=table.cleaningSince??table.since;
  return {tableId:table.id,kind:'cleaning',since,dueAt:since+state.settings.cleaningMinutes*60000};
 }
 return null;
}
function stillPending(task:Task,state:AppState){
 const table=state.tables.find(t=>t.id===task.tableId),current=table&&pendingTask(table,state);
 return !!current&&current.kind===task.kind&&current.since===task.since;
}
export function notificationText(task:Task,now:number,repeat=false){
 const minutes=Math.max(0,Math.floor((now-task.since)/60000));
 return `AGUGAGA AI${repeat?' · Напоминание':''}\nСтол №${task.tableId}\n${task.kind==='service'?`После посадки прошло ${minutes} мин. Подход официанта не подтверждён.`:`После ухода гостей прошло ${minutes} мин. Уборка не завершена.`}`;
}

export function createTelegramService(db:DB,env:TelegramEnv,fetcher:typeof fetch=env.TELEGRAM_FETCH??fetch){
 const botToken=normalizeTelegramToken(env.TELEGRAM_BOT_TOKEN);
 async function telegram(method:string,body:unknown,timeoutMs=method==='setWebhook'||method==='getMe'?30000:10000){
  if(!botToken)throw new Error('Telegram-бот ещё не подключён.');
  let response:Response;
  try{response=await fetcher(`https://api.telegram.org/bot${botToken}/${method}`,{...(method==='getMe'?{method:'GET'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),signal:AbortSignal.timeout(timeoutMs)});}
  catch(error){const e=error as {name?:string;code?:string;cause?:{code?:string}},code=e.cause?.code||e.code;console.error('[telegram] request failed',{method,name:/^[A-Za-z]+$/.test(e.name||'')?e.name:'unknown',code:/^[A-Z_]+$/.test(code||'')?code:'unknown'});throw new Error(method==='setWebhook'?'Не удалось связаться с Telegram при подключении уведомлений. Повторите позже.':'Не удалось связаться с Telegram при проверке бота. Повторите позже.');}
  if(response.status===401||response.status===404)throw new Error('Telegram не принял токен бота. Замените TELEGRAM_BOT_TOKEN в Vercel Production на токен из BotFather и выполните Redeploy.');
  const data=await response.json() as {ok:boolean;result:any;parameters?:{retry_after?:number}};
  if(response.status===429){const delay=Number(data.parameters?.retry_after);throw Object.assign(new Error(`Telegram ограничил частоту подключений.${Number.isFinite(delay)&&delay>0?` Повторите через ${Math.ceil(delay)} сек.`:' Повторите подключение через минуту.'}`),{retryAfterSeconds:Number.isFinite(delay)&&delay>0?Math.ceil(delay):60});}
  if(!response.ok||!data.ok)throw new Error(`Telegram временно недоступен (HTTP ${response.status}).`);
  return data.result;
 }
 async function setupWebhook(origin:string,force=false,timeoutMs=120000){
  if(!env.TELEGRAM_WEBHOOK_SECRET)throw new Error('На сервере не настроен секрет Telegram webhook.');
  const url=new URL('/api/telegram/webhook',env.TELEGRAM_PUBLIC_URL||origin).href;
  const key=`tg:webhook:${await hash(botToken||'')}`,signature=await hash(`${url}:${env.TELEGRAM_WEBHOOK_SECRET}`),row=await read(db,key),registration=row?JSON.parse(row.payload):null;
  if(registration?.signature===signature&&registration.registeredAt&&Date.now()-registration.registeredAt<86400000)return {ready:true};
  if(registration?.leaseUntil>Date.now())return {ready:false};
  if(!force&&registration?.signature===signature&&registration.retryAt>Date.now())return {ready:false};
  const pending={signature,registeredAt:0,leaseUntil:Date.now()+timeoutMs+30000,retryAt:0};
  const claim=row
   ?await db.prepare('UPDATE workspaces SET payload=?,revision=revision+1,updated_at=? WHERE key=? AND revision=?').bind(JSON.stringify(pending),Date.now(),key,row.revision).run()
   :await db.prepare('INSERT INTO workspaces (key,payload,revision,updated_at) VALUES (?,?,1,?) ON CONFLICT(key) DO NOTHING').bind(key,JSON.stringify(pending),Date.now()).run();
  if(!claim.meta.changes)return {ready:false};
  const heldRevision=row?row.revision+1:1;
  const finish=(value:unknown)=>db.prepare('UPDATE workspaces SET payload=?,revision=revision+1,updated_at=? WHERE key=? AND revision=?').bind(JSON.stringify(value),Date.now(),key,heldRevision).run();
  try{
   await telegram('setWebhook',{url,secret_token:env.TELEGRAM_WEBHOOK_SECRET,allowed_updates:['message','callback_query']},timeoutMs);
   await finish({signature,registeredAt:Date.now(),leaseUntil:0});return {ready:true};
  }catch(error){const delay=Number((error as {retryAfterSeconds?:number}).retryAfterSeconds)||120;await finish({signature,registeredAt:0,leaseUntil:0,retryAt:Date.now()+Math.max(120,Math.min(86400,delay+2))*1000});throw error;}
 }
 async function config(request:Request){
  const owner=requestOwner(request);if(!owner)return json({error:'Требуется сессия.'},401);
  if(request.method!=='GET'&&request.headers.get('origin')!==new URL(request.url).origin)return json({error:'Недопустимый источник.'},403);
  const key=`tg:binding:${owner}`;
  try{
   const row=await read(db,key),binding=row?JSON.parse(row.payload) as Binding:null;
   if(request.method==='GET'){
    const setup=env.TELEGRAM_BOT_USERNAME&&botToken?await read(db,`tg:webhook:${await hash(botToken)}`):null;
    return json({configured:!!botToken,connected:!!binding,enabled:binding?.enabled??false,schedulerConfigured:!!env.NOTIFICATIONS_CRON_SECRET,setupPending:!!env.TELEGRAM_BOT_USERNAME&&!JSON.parse(setup?.payload||'null')?.registeredAt});
   }
   const body=await request.json() as {action?:string;probe?:string;force?:boolean};
   if(body.action==='setup'){
    if(!env.NOTIFICATIONS_CRON_SECRET||request.headers.get('authorization')!==`Bearer ${env.NOTIFICATIONS_CRON_SECRET}`)return json({error:'Нет доступа.'},401);
    return json(await setupWebhook(new URL(request.url).origin,body.force===true));
   }
   if(body.action==='diagnostics'){
    if(!env.NOTIFICATIONS_CRON_SECRET||request.headers.get('authorization')!==`Bearer ${env.NOTIFICATIONS_CRON_SECRET}`)return json({error:'Нет доступа.'},401);
    if(body.probe==='authentication'){const me=await telegram('getMe',{},120000);return json({ok:true,bot:me.username});}
    if(body.probe==='registration')return json(await setupWebhook(new URL(request.url).origin,true,120000));
    if(body.probe==='webhook'){
     const info=await telegram('getWebhookInfo',{});
     return json({ok:true,url:info.url,pending:info.pending_update_count,lastError:info.last_error_message});
    }
    const started=Date.now();let reachability:unknown,sameBotControl:unknown;
    try{const r=await fetcher('https://api.telegram.org/bot0:invalid/getMe',{signal:AbortSignal.timeout(5000)});reachability={status:r.status,ms:Date.now()-started};}catch(e){reachability={failed:true,ms:Date.now()-started};}
    const controlStarted=Date.now(),publicId=botToken.split(':')[0];
    if(/^\d+$/.test(publicId)){
     try{const r=await fetcher(`https://api.telegram.org/bot${publicId}:invalid/getMe`,{signal:AbortSignal.timeout(5000)});sameBotControl={status:r.status,ms:Date.now()-controlStarted};}catch{sameBotControl={failed:true,ms:Date.now()-controlStarted};}
    }
    return json({credentialFormatValid:/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(botToken),rawChars:env.TELEGRAM_BOT_TOKEN?.length||0,tokenChars:botToken.length,transport:env.TELEGRAM_FETCH?'native-ipv4':'fetch',version:process.env.VERCEL_GIT_COMMIT_SHA,reachability,sameBotControl});
   }
   if(body.action==='check'){const me=await telegram('getMe',{});return json({ok:true,bot:me.username});}
   if(body.action==='disconnect'){await db.prepare('DELETE FROM workspaces WHERE key=?').bind(key).run();return json({ok:true});}
   if(body.action==='link'){
    if(!botToken)throw new Error('Telegram-бот ещё не подключён.');
    if(!env.TELEGRAM_WEBHOOK_SECRET)throw new Error('На сервере не настроен секрет Telegram webhook.');
    const configuredName=env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/,''),username=configuredName||(await telegram('getMe',{})).username;
    if(!/^[A-Za-z0-9_]{5,32}$/.test(username))throw new Error('На сервере неверно настроено имя Telegram-бота.');
    // With a known bot name, pairing must not wait on Telegram availability.
    // The protected dispatcher provisions the webhook independently.
    if(!configuredName)await setupWebhook(new URL(request.url).origin);
    const code=crypto.randomUUID().replaceAll('-','');
    await save(db,`tg:link:${await hash(code)}`,{owner,expires:Date.now()+600000});
    return json({url:`https://t.me/${username}?start=${code}`,expiresInMinutes:10});
   }
   if(body.action==='test'&&binding){await telegram('sendMessage',{chat_id:binding.chatId,text:'AGUGAGA AI: уведомления подключены. Это проверочное сообщение.'});return json({ok:true});}
   return json({error:'Неизвестное действие или Telegram не связан.'},400);
  }catch(error){return json({error:error instanceof Error?error.message:'Не удалось подключить Telegram.'},503);}
 }
 async function webhook(request:Request){
  if(!env.TELEGRAM_WEBHOOK_SECRET||request.headers.get('x-telegram-bot-api-secret-token')!==env.TELEGRAM_WEBHOOK_SECRET)return json({error:'Нет доступа.'},401);
  try{
   const raw=await request.text();if(raw.length>64000)return json({error:'Слишком большой запрос.'},413);
   const update=JSON.parse(raw),message=update.message;
   const match=typeof message?.text==='string'?message.text.match(/^\/start(?:@\w+)? ([a-f0-9]{32})$/):null;
   if(match&&message.chat?.type==='private'){
    const key=`tg:link:${await hash(match[1])}`,row=await read(db,key),link=row?JSON.parse(row.payload):null;
    if(!link||link.expires<Date.now())return json({ok:true});
    const consumed=await db.prepare('DELETE FROM workspaces WHERE key=? AND revision=?').bind(key,row!.revision).run();
    if(!consumed.meta.changes)return json({ok:true});
    await save(db,`tg:binding:${link.owner}`,{owner:link.owner,chatId:message.chat.id,enabled:true} satisfies Binding);
    await telegram('sendMessage',{chat_id:message.chat.id,text:'AGUGAGA AI подключён к вашей смене. Здесь появятся задачи по обслуживанию и уборке. Пороги задаются в настройках сайта.'});
   }
   const callback=update.callback_query;
   if(callback&&typeof callback.data==='string'){
    const action=callback.data.match(/^nt:([a-f0-9]{32}):(claim|serve|clean)$/);
    if(!action)return json({ok:true});
    const event=await read(db,`tg:event:${action[1]}`),task=event?JSON.parse(event.payload) as Delivery:null;
    if(!task||task.chatId!==callback.message?.chat?.id||callback.from?.id!==task.chatId)return json({ok:true});
    const bindingRow=await read(db,`tg:binding:${task.owner}`),binding=bindingRow?JSON.parse(bindingRow.payload) as Binding:null;
    if(!binding?.enabled||binding.chatId!==task.chatId)return json({ok:true});
    let result='Задача уже закрыта или относится к прошлому посещению.';
    for(let attempt=0;attempt<3;attempt++){
     const key=`${task.owner}:live`,row=await read(db,key),state=row?JSON.parse(row.payload):null;
     if(!validateState(state)||!stillPending(task,state))break;
     if(action[2]==='claim'){
      task.assignee=String(callback.from?.first_name||'Сотрудник').slice(0,80);
      await db.prepare('UPDATE workspaces SET payload=?,revision=revision+1,updated_at=? WHERE key=? AND revision=?').bind(JSON.stringify(task),Date.now(),`tg:event:${action[1]}`,event!.revision).run();
      result='Задача принята. После выполнения нажмите кнопку подтверждения.';break;
     }
     if(action[2]==='serve'&&task.kind!=='service'||action[2]==='clean'&&task.kind!=='cleaning')break;
     const changed=action[2]==='serve'?serve(state,task.tableId,Date.now()):changeStatus(state,task.tableId,'free',Date.now(),'manual');
     const updated=await db.prepare('UPDATE workspaces SET payload=?,revision=revision+1,updated_at=? WHERE key=? AND revision=?').bind(JSON.stringify(changed),Date.now(),key,row!.revision).run();
     if(updated.meta.changes){result='Выполнение подтверждено. Данные смены обновлены.';break;}
    }
    await telegram('answerCallbackQuery',{callback_query_id:callback.id,text:result});
   }
   return json({ok:true});
  }catch{console.error('[telegram] webhook processing failed');return json({error:'Не удалось обработать событие.'},503);}
 }
 async function dispatch(now=Date.now()){
  if(!botToken)return {sent:0,skipped:'bot_not_configured'};
  const rows=await db.prepare("SELECT payload FROM workspaces WHERE key LIKE 'tg:binding:%' ORDER BY updated_at DESC LIMIT 50").all<{payload:string}>();
  let sent=0,failed=0;
  for(const row of rows.results){
   const binding=JSON.parse(row.payload) as Binding;if(!binding.enabled)continue;
   const workspace=await read(db,`${binding.owner}:live`),state=workspace?JSON.parse(workspace.payload):null;
   if(!validateState(state))continue;
   for(const table of state.tables){
    const task=pendingTask(table,state);if(!task||task.dueAt>now)continue;
    const id=(await hash(`${binding.owner}:${state.startedAt}:${task.tableId}:${task.kind}:${task.since}`)).slice(0,32),key=`tg:event:${id}`;
    let previous=await read(db,key);
    if(!previous){await db.prepare('INSERT INTO workspaces (key,payload,revision,updated_at) VALUES (?,?,1,?) ON CONFLICT(key) DO NOTHING').bind(key,JSON.stringify({...task,owner:binding.owner,chatId:binding.chatId,lastSent:0,leaseUntil:0}),now).run();previous=await read(db,key);}
    if(!previous)continue;
    const delivery=JSON.parse(previous.payload) as Delivery;
    if(delivery.leaseUntil>now||delivery.lastSent&&now-delivery.lastSent<300000)continue;
    delivery.leaseUntil=now+90000;delivery.chatId=binding.chatId;
    const claim=await db.prepare('UPDATE workspaces SET payload=?,revision=revision+1,updated_at=? WHERE key=? AND revision=?').bind(JSON.stringify(delivery),now,key,previous.revision).run();
    if(!claim.meta.changes)continue;
    try{
     const fresh=await read(db,`${binding.owner}:live`),current=fresh?JSON.parse(fresh.payload):null;
     if(!validateState(current)||!stillPending(task,current))continue;
     await telegram('sendMessage',{chat_id:binding.chatId,text:notificationText(task,now,!!delivery.lastSent)+(delivery.assignee?`\nИсполнитель: ${delivery.assignee}`:''),reply_markup:{inline_keyboard:[[{text:'Беру задачу',callback_data:`nt:${id}:claim`}],[{text:task.kind==='service'?'Официант подошёл':'Уборка завершена',callback_data:`nt:${id}:${task.kind==='service'?'serve':'clean'}`}]]}});
     delivery.lastSent=now;delivery.leaseUntil=0;
     await db.prepare('UPDATE workspaces SET payload=?,revision=revision+1,updated_at=? WHERE key=? AND revision=?').bind(JSON.stringify(delivery),now,key,previous.revision+1).run();sent++;
    }catch{failed++;console.error('[telegram] notification delivery failed; will retry');}
   }
  }
  return {sent,failed};
 }
 return {config,webhook,dispatch,setupWebhook};
}
