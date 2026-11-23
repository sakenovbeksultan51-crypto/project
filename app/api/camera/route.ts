import {env} from 'cloudflare:workers';
import {createCameraAPI} from '../../../src/lib/camera-api';
export const dynamic='force-dynamic';
export const GET=(request:Request)=>createCameraAPI(env.DB)(request);
export const POST=(request:Request)=>createCameraAPI(env.DB)(request);
