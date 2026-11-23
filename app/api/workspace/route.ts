import {env} from 'cloudflare:workers';
import {createWorkspaceAPI} from '../../../src/lib/workspace-api';
import {withBrowserSession} from '../../../src/lib/request-owner';
export const dynamic='force-dynamic';
export async function GET(request:Request){return withBrowserSession(request,(sessionRequest)=>createWorkspaceAPI(env.DB).GET(sessionRequest));}
export async function PUT(request:Request){return withBrowserSession(request,(sessionRequest)=>createWorkspaceAPI(env.DB).PUT(sessionRequest));}
