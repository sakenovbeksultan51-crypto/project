import {env} from 'cloudflare:workers';
import {createAssistantAPI} from '../../../src/lib/assistant-api';
import {withBrowserSession} from '../../../src/lib/request-owner';
export const dynamic='force-dynamic';
export async function GET(request:Request){return withBrowserSession(request,(sessionRequest)=>createAssistantAPI(env).GET(sessionRequest));}
export async function POST(request:Request){return withBrowserSession(request,(sessionRequest)=>createAssistantAPI(env).POST(sessionRequest));}
