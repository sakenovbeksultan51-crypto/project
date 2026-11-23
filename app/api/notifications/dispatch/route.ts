import {env} from 'cloudflare:workers';
import {Receiver} from '@upstash/qstash';
import {createTelegramService} from '../../../../src/lib/telegram-notifications';
export const dynamic='force-dynamic';
export async function POST(request:Request){
 let authorized=!!env.NOTIFICATIONS_CRON_SECRET&&request.headers.get('authorization')===`Bearer ${env.NOTIFICATIONS_CRON_SECRET}`;
 if(!authorized&&env.QSTASH_CURRENT_SIGNING_KEY&&env.QSTASH_NEXT_SIGNING_KEY){
  try{authorized=await new Receiver({currentSigningKey:env.QSTASH_CURRENT_SIGNING_KEY,nextSigningKey:env.QSTASH_NEXT_SIGNING_KEY}).verify({signature:request.headers.get('upstash-signature')||'',body:await request.text(),url:new URL('/api/notifications/dispatch',request.url).href});}catch{}
 }
 if(!authorized)return Response.json({error:'Нет доступа.'},{status:401});
 const service=createTelegramService(env.DB,env);let setupPending=false;
 if(env.TELEGRAM_BOT_USERNAME){try{setupPending=!(await service.setupWebhook(new URL(request.url).origin)).ready;}catch{setupPending=true;}}
 const result=await service.dispatch();
 return Response.json({...result,setupPending},{status:result.failed?503:200});
}
