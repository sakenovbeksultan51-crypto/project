import {env} from 'cloudflare:workers';
import {createTelegramService} from '../../../../src/lib/telegram-notifications';
export const dynamic='force-dynamic';
export const POST=(request:Request)=>createTelegramService(env.DB,env).webhook(request);
