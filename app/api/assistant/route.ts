import {env} from 'cloudflare:workers';
import {createAssistantAPI} from '../../../src/lib/assistant-api';
import {withBrowserSession} from '../../../src/lib/request-owner';
export const dynamic='force-dynamic';
const assistant=(request:Request)=>createAssistantAPI({...env,AI_GATEWAY_OIDC_TOKEN:request.headers.get('x-vercel-oidc-token')||undefined});
export async function GET(request:Request){return withBrowserSession(request,(sessionRequest)=>assistant(sessionRequest).GET(sessionRequest));}
export async function POST(request:Request){return withBrowserSession(request,(sessionRequest)=>assistant(sessionRequest).POST(sessionRequest));}
