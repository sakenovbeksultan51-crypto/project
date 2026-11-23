// Local provisioning: the token stays in an ignored file/process, never stdout.
import {readFileSync,writeFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {createHash} from 'node:crypto';
import {Client} from '@upstash/qstash';
import {neon} from '@neondatabase/serverless';
import {telegramFetch} from '../db/telegram-transport.ts';
import {normalizeTelegramToken} from '../src/lib/telegram-notifications.ts';

const safeError=(code,extra={})=>Object.assign(new Error(code),{safeCode:code,...extra});
const hash=text=>createHash('sha256').update(text).digest('hex');
async function wait(seconds){
 let remaining=seconds;
 while(remaining>0){const next=Math.min(30,remaining);console.log(JSON.stringify({waitingSeconds:next}));await new Promise(resolve=>setTimeout(resolve,next*1000));remaining-=next;}
}
async function main(){
 const local=parseEnv(readFileSync('.env.telegram.local','utf8'));
 const token=normalizeTelegramToken(local.TELEGRAM_BOT_TOKEN);
 if(!/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(token))throw safeError('LOCAL_TELEGRAM_TOKEN_REQUIRED');
 const production=parseEnv(readFileSync('.env.production.local','utf8'));
 const secrets=JSON.parse(readFileSync('.vercel/notification-secrets.json','utf8'));
 if(!secrets.webhook)throw safeError('LOCAL_WEBHOOK_SECRET_REQUIRED');
 const expected=(local.TELEGRAM_BOT_USERNAME||production.TELEGRAM_BOT_USERNAME||'AGUGAGA_HELPER_BOT').replace(/^@/,'');
 const origin=production.TELEGRAM_PUBLIC_URL||'https://app-delta-nine-69.vercel.app';
 const url=new URL('/api/telegram/webhook',origin).href;
 const connection=production.DATABASE_URL||production.POSTGRES_URL;
 if(!connection)throw safeError('PRODUCTION_DATABASE_CONFIGURATION_REQUIRED');
 const sql=neon(connection);
 async function call(method,body={}){
  for(let attempt=1;attempt<=3;attempt++){
   const response=await telegramFetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(120000)});
   let data;try{data=await response.json();}catch{throw safeError('TELEGRAM_INVALID_RESPONSE',{status:response.status});}
   if(response.ok&&data.ok)return data.result;
   const delay=Number(data.parameters?.retry_after)||0;
   if(response.status===429&&delay>0&&delay<=120&&attempt<3){console.log(JSON.stringify({method,attempt,retryAfterSeconds:delay}));await wait(delay+2);continue;}
   throw safeError(response.status===401||response.status===404?'TELEGRAM_AUTHENTICATION_REJECTED':'TELEGRAM_API_REJECTED',{status:response.status,retryAfterSeconds:delay||undefined});
  }
 }
 const schedule='tableflow-service-alerts';let client,pausedHere=false;
 try{
  if(production.QSTASH_TOKEN){
   client=new Client({token:production.QSTASH_TOKEN,baseUrl:production.QSTASH_URL});
   const before=await client.schedules.get(schedule);
   if(!before.isPaused){pausedHere=true;await client.schedules.pause({schedule});}
  }
  const me=await call('getMe');
  if(String(me.username).toLowerCase()!==expected.toLowerCase())throw safeError('BOT_USERNAME_MISMATCH',{actualBot:me.username,expectedBot:expected});
  console.log(JSON.stringify({authenticated:true,bot:me.username}));
  await call('setWebhook',{url,secret_token:secrets.webhook,allowed_updates:['message','callback_query']});
  const info=await call('getWebhookInfo');
  if(info.url!==url)throw safeError('WEBHOOK_URL_MISMATCH');
  const receipt={signature:hash(`${url}:${secrets.webhook}`),registeredAt:Date.now(),leaseUntil:0,retryAt:0};
  await sql.query('INSERT INTO workspaces (key,payload,revision,updated_at) VALUES ($1,$2,1,$3) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,revision=workspaces.revision+1,updated_at=excluded.updated_at',[`tg:webhook:${hash(token)}`,JSON.stringify(receipt),Date.now()]);
  const result={bot:me.username,webhookReady:true,webhook:url,verifiedAt:new Date().toISOString()};
  writeFileSync('.vercel/telegram-local-result.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
 }finally{
  if(pausedHere){await client.schedules.resume({schedule});console.log(JSON.stringify({schedulerRestored:true}));}
 }
}
try{await main();}catch(error){
 console.error(JSON.stringify({ok:false,code:error.safeCode||'LOCAL_TELEGRAM_SETUP_FAILED',status:error.status,retryAfterSeconds:error.retryAfterSeconds,actualBot:error.actualBot,expectedBot:error.expectedBot,errorName:error.name}));
 process.exitCode=1;
}
