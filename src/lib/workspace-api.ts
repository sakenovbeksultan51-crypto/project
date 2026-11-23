import {validateState} from './engine';
import {requestOwner} from './request-owner';
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export function createWorkspaceAPI(db:Pick<D1Database,'prepare'>){
async function GET(request:Request){
 const user=requestOwner(request);if(!user)return reply({error:'Требуется вход в аккаунт.'},401);
 const mode=new URL(request.url).searchParams.get('mode');if(!['demo','live'].includes(mode||''))return reply({error:'Неверный режим.'},400);
 try{const row=await db.prepare('SELECT payload, revision FROM workspaces WHERE key = ?').bind(`${user}:${mode}`).first<{payload:string;revision:number}>();return reply(row?{state:JSON.parse(row.payload),revision:row.revision}:{state:null,revision:0});}catch{return reply({error:'Хранилище временно недоступно. Сохраните резервную копию.'},503);}
}
async function PUT(request:Request){
 const user=requestOwner(request);if(!user)return reply({error:'Требуется вход в аккаунт.'},401);
 const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return reply({error:'Недопустимый источник запроса.'},403);
 if(Number(request.headers.get('content-length'))>1_000_000)return reply({error:'Файл слишком большой.'},413);
 try{
   const raw=await request.text();if(raw.length>1_000_000)return reply({error:'Файл слишком большой.'},413);
   const {state,revision}=JSON.parse(raw);if(!validateState(state)||!Number.isSafeInteger(revision)||revision<0)return reply({error:'Некорректные данные.'},400);
   const key=`${user}:${state.mode}`,payload=JSON.stringify(state),now=Date.now();
   const result=revision===0?await db.prepare('INSERT INTO workspaces (key,payload,revision,updated_at) VALUES (?,?,1,?) ON CONFLICT(key) DO NOTHING').bind(key,payload,now).run():await db.prepare('UPDATE workspaces SET payload=?,revision=revision+1,updated_at=? WHERE key=? AND revision=?').bind(payload,now,key,revision).run();
   if(!result.meta.changes)return reply({error:'Смена изменена на другом устройстве. Загрузите свежие данные.'},409);
   return reply({revision:revision+1});
 }catch{return reply({error:'Не удалось сохранить смену.'},400);}
}

return {GET,PUT};
}
