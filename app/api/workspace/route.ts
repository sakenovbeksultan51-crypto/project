import {env} from 'cloudflare:workers';
import {createWorkspaceAPI} from '../../../src/lib/workspace-api';
export const dynamic='force-dynamic';
export async function GET(request:Request){return createWorkspaceAPI(env.DB).GET(request);}
export async function PUT(request:Request){return createWorkspaceAPI(env.DB).PUT(request);}
