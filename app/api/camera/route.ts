import {env} from 'cloudflare:workers';
import {createCameraAPI} from '../../../src/lib/camera-api';
import {withBrowserSession} from '../../../src/lib/request-owner';
export const dynamic='force-dynamic';
export const GET=(request:Request)=>withBrowserSession(request,(sessionRequest)=>createCameraAPI(env.DB)(sessionRequest));
export const POST=(request:Request)=>withBrowserSession(request,(sessionRequest)=>createCameraAPI(env.DB)(sessionRequest));
