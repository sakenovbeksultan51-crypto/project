import {env} from 'cloudflare:workers';
import {withBrowserSession} from '../../../src/lib/request-owner';
import {createTelegramService} from '../../../src/lib/telegram-notifications';
export const dynamic='force-dynamic';
export const GET=(request:Request)=>withBrowserSession(request,r=>createTelegramService(env.DB,env).config(r));
export const POST=GET;
