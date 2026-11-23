// Signalling only: camera media travels over encrypted WebRTC, never through D1.
export type CameraRoom={code:string;expires:number;owner:string;inviteHash:string;host:string;viewer:string|null;offer:string|null;answer:string|null};
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(n=>n.toString(16).padStart(2,'0')).join('');
export function createCameraAPI(db:Pick<D1Database,'prepare'>){
 return async function handle(request:Request){
  const url=new URL(request.url),user=request.headers.get('oai-authenticated-user-id')||(['localhost','127.0.0.1'].includes(url.hostname)?'local-development':null);
  if(request.method!=='GET'&&request.headers.get('origin')&&request.headers.get('origin')!==url.origin)return reply({error:'Недопустимый источник.'},403);
  try{
   let input:Record<string,unknown>={};if(request.method==='POST'){const raw=await request.text();if(raw.length>100000)return reply({error:'Запрос слишком большой.'},413);input=JSON.parse(raw);}
   const code=String(input.code||url.searchParams.get('code')||'').toUpperCase(),token=String(input.token||request.headers.get('x-camera-token')||'');
   if(request.method==='POST'&&input.action==='create'){
    if(!user)return reply({error:'Для передачи камеры войдите через ChatGPT. Зрителю вход не нужен.'},401);
    const invite=Array.from(crypto.getRandomValues(new Uint8Array(32))).map(n=>n.toString(16).padStart(2,'0')).join('');
    const room:CameraRoom={code:crypto.randomUUID().replaceAll('-','').slice(0,12).toUpperCase(),expires:Date.now()+7200000,owner:user,inviteHash:await hash(invite),host:crypto.randomUUID(),viewer:null,offer:null,answer:null};
    await db.prepare('DELETE FROM workspaces WHERE instr(key, ?) = 1 AND updated_at < ?').bind('camera:',Date.now()-7200000).run();
    await db.prepare('INSERT INTO workspaces (key,payload,revision,updated_at) VALUES (?,?,1,?)').bind(`camera:${room.code}`,JSON.stringify(room),Date.now()).run();
    return reply({code:room.code,token:room.host,invite,expires:room.expires});
   }
   if(!/^[A-F0-9]{12}$/.test(code))return reply({error:'Неверный код комнаты.'},400);
   const key=`camera:${code}`;
   for(let attempt=0;attempt<4;attempt++){
    const row=await db.prepare('SELECT payload, revision FROM workspaces WHERE key = ?').bind(key).first<{payload:string;revision:number}>();
    if(!row)return reply({error:'Комната закрыта или не найдена. Попросите новую ссылку.'},404);
    const room=JSON.parse(row.payload) as CameraRoom;
    if(room.expires<Date.now())return reply({error:'Время комнаты истекло. Попросите новую ссылку.'},410);
    const isHost=!!user&&user===room.owner&&token===room.host,isViewer=!!room.viewer&&token===room.viewer;
    if(request.method==='POST'&&input.action==='join'){
     const invite=typeof input.invite==='string'?input.invite:'';
     const allowed=user===room.owner||(/^[a-f0-9]{64}$/.test(invite)&&await hash(invite)===room.inviteHash);
     if(!allowed)return reply({error:'Откройте полную ссылку-приглашение или отсканируйте QR-код.'},403);
     if(!/^[a-f0-9-]{36}$/.test(token)||token===room.host)return reply({error:'Неверный ключ устройства.'},400);
     if(room.viewer&&room.viewer!==token)return reply({error:'Камеру уже смотрят на другом устройстве. Для нового подключения создайте новую комнату.'},409);
     room.viewer=token;
    }else{
     if(!isHost&&!isViewer)return reply({error:'Нет доступа к комнате. Откройте приглашение заново.'},403);
     if(request.method==='GET')return reply({code,expires:room.expires,viewer:room.viewer,offer:room.offer,answer:room.answer});
     if(request.method!=='POST')return reply({error:'Метод не поддерживается.'},405);
     if(input.action==='close'&&isHost){await db.prepare('DELETE FROM workspaces WHERE key = ?').bind(key).run();return reply({ok:true});}
     if(input.action==='offer'&&isHost&&typeof input.sdp==='string'&&input.sdp.length<60000)room.offer=input.sdp;
     else if(input.action==='answer'&&isViewer&&typeof input.sdp==='string'&&input.sdp.length<60000)room.answer=input.sdp;
     else return reply({error:'Недопустимое действие.'},400);
    }
    const result=await db.prepare('UPDATE workspaces SET payload=?,revision=revision+1,updated_at=? WHERE key=? AND revision=?').bind(JSON.stringify(room),Date.now(),key,row.revision).run();
    if(result.meta.changes)return reply({ok:true,expires:room.expires});
   }
   return reply({error:'Повторите подключение.'},409);
  }catch{return reply({error:'Сервис подключения временно недоступен.'},503);}
 };
}
