import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {createReadStream,existsSync,readFileSync,statSync} from 'node:fs';
import {extname,isAbsolute,relative,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createWorkspaceAPI} from '../src/lib/workspace-api';
import {createCameraAPI} from '../src/lib/camera-api';
import {createAssistantAPI,type AssistantEnv} from '../src/lib/assistant-api';
import {openLocalStorage} from './storage';

const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.woff2':'font/woff2','.woff':'font/woff','.wasm':'application/wasm','.mp4':'video/mp4'};
const json=(response:ServerResponse,body:unknown,status=200)=>{response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});response.end(JSON.stringify(body));};
function body(request:IncomingMessage):Promise<string>{
 return new Promise((done,fail)=>{
  const chunks:Buffer[]=[];let bytes=0,tooLarge=false;
  request.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>1_000_000){if(!tooLarge){tooLarge=true;fail(Object.assign(new Error('Запрос слишком большой.'),{status:413}));}}else chunks.push(chunk);});
  request.once('end',()=>{if(!tooLarge)done(Buffer.concat(chunks).toString('utf8'));});request.once('error',fail);
 });
}
function within(root:string,path:string){const suffix=relative(root,path);return suffix!== '..'&&!suffix.startsWith('..'+sep)&&!isAbsolute(suffix);}
function staticFile(request:IncomingMessage,response:ServerResponse,path:string){
 if(!existsSync(path)||!statSync(path).isFile()){json(response,{error:'Файл не найден.'},404);return;}
 const size=statSync(path).size;let start=0,end=size-1,status=200;
 const headers:Record<string,string>={'Content-Type':mime[extname(path).toLowerCase()]||'application/octet-stream','X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes','Cache-Control':'no-cache'};
 if(request.headers.range){
  const match=/^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
  if(match){start=match[1]?Number(match[1]):Math.max(0,size-Number(match[2]));end=match[1]&&match[2]?Math.min(size-1,Number(match[2])):size-1;}
  if(!match||(!match[1]&&!match[2])||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=size){response.writeHead(416,{'Content-Range':`bytes */${size}`});response.end();return;}
  status=206;headers['Content-Range']=`bytes ${start}-${end}/${size}`;
 }
 headers['Content-Length']=String(Math.max(0,end-start+1));response.writeHead(status,headers);
 if(request.method==='HEAD'||size===0){response.end();return;}
 createReadStream(path,{start,end}).on('error',()=>response.destroy()).pipe(response);
}

export function createDesktopServer({root,clientDir=resolve(root,'.data/desktop-app'),databaseFile,assistantEnv={},buildId='development'}:{root:string;clientDir?:string;databaseFile?:string;assistantEnv?:AssistantEnv;buildId?:string}){
 const store=openLocalStorage(root,databaseFile),workspace=createWorkspaceAPI(store.binding),camera=createCameraAPI(store.binding),assistant=createAssistantAPI(assistantEnv);
 async function handle(request:IncomingMessage,response:ServerResponse){
  const url=new URL(request.url||'/',`http://${request.headers.host||'localhost'}`);
  if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)){json(response,{error:'Недопустимый адрес.'},403);return;}
  if(url.pathname==='/api/health'){
   json(response,{application:'TableFlow',runtime:'desktop',storage:'sqlite',ready:store.healthy(),buildId,pid:process.pid});return;
  }
  if(url.pathname.startsWith('/api/')){
   if(!['GET','HEAD'].includes(request.method||'GET')&&request.headers.origin&&request.headers.origin!==url.origin){json(response,{error:'Недопустимый источник запроса.'},403);request.resume();return;}
   if(Number(request.headers['content-length'])>1_000_000){json(response,{error:'Запрос слишком большой.'},413);request.resume();return;}
   const headers=new Headers();for(const [name,value] of Object.entries(request.headers)){if(Array.isArray(value))for(const item of value)headers.append(name,item);else if(value!==undefined)headers.set(name,value);}
   const method=request.method||'GET';const payload=['GET','HEAD'].includes(method)?undefined:await body(request);
   const input=new Request(url,{method,headers,...(payload!==undefined?{body:payload}:{})});
   let result:Response;
   if(url.pathname==='/api/workspace'&&method==='GET')result=await workspace.GET(input);
   else if(url.pathname==='/api/workspace'&&method==='PUT')result=await workspace.PUT(input);
   else if(url.pathname==='/api/camera')result=await camera(input);
   else if(url.pathname==='/api/assistant'&&method==='GET')result=await assistant.GET(input);
   else if(url.pathname==='/api/assistant'&&method==='POST')result=await assistant.POST(input);
   else{json(response,{error:'Маршрут или метод не поддерживается.'},404);return;}
   response.writeHead(result.status,Object.fromEntries(result.headers.entries()));response.end(Buffer.from(await result.arrayBuffer()));return;
  }
  if(!['GET','HEAD'].includes(request.method||'GET')){json(response,{error:'Метод не поддерживается.'},405);return;}
  const pathname=decodeURIComponent(url.pathname);
  if(/[\\\0:]/.test(pathname)||pathname.split('/').some(part=>part.startsWith('.'))){json(response,{error:'Недопустимый путь.'},403);return;}
  if(['/','/watch','/watch/'].includes(pathname)){staticFile(request,response,resolve(clientDir,'index.html'));return;}
  const base=pathname.startsWith('/assets/')?clientDir:resolve(root,'public'),file=resolve(base,'.'+pathname);
  if(!within(base,file)){json(response,{error:'Недопустимый путь.'},403);return;}
  staticFile(request,response,file);
 }
 const server=createServer((request,response)=>{handle(request,response).catch(error=>{
  console.error('TableFlow local request failed:',error instanceof Error?error.message:'Unknown error');
  if(!response.headersSent)json(response,{error:'Ошибка локального сервера.'},typeof error?.status==='number'?error.status:500);else response.destroy();
 });});
 server.on('close',()=>store.close());
 return {server,databaseFile:store.path};
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const root=process.env.TABLEFLOW_ROOT||fileURLToPath(new URL('../../',import.meta.url));
 const variables=resolve(root,'.dev.vars');if(existsSync(variables))process.loadEnvFile(variables);
 const port=Number(process.env.TABLEFLOW_PORT||3000);
 const assistantEnv:AssistantEnv={ASSISTANT_PROVIDER:process.env.ASSISTANT_PROVIDER,OLLAMA_MODEL:process.env.OLLAMA_MODEL,OLLAMA_BASE_URL:process.env.OLLAMA_BASE_URL,OPENAI_API_KEY:process.env.OPENAI_API_KEY,OPENAI_MODEL:process.env.OPENAI_MODEL};
 const buildId=JSON.parse(readFileSync(resolve(root,'.data/desktop-app/desktop-build.json'),'utf8')).buildId as string;
 const {server}=createDesktopServer({root,assistantEnv,buildId});
 server.on('error',error=>{console.error('TableFlow server:',error.message);process.exitCode=1;server.close();});
 server.listen(port,'localhost',()=>console.log(`TableFlow desktop ready: http://localhost:${port}/`));
 const close=()=>server.close(()=>process.exit(0));process.once('SIGINT',close);process.once('SIGTERM',close);
}
