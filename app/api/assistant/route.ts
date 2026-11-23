import {env} from 'cloudflare:workers';
import {createAssistantAPI} from '../../../src/lib/assistant-api';
export const dynamic='force-dynamic';
export async function GET(request:Request){return createAssistantAPI(env).GET(request);}
export async function POST(request:Request){return createAssistantAPI(env).POST(request);}
