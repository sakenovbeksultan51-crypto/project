export type Status = 'free' | 'occupied' | 'dirty' | 'cleaning';
export type Source = 'demo' | 'manual' | 'camera';
export type Observation = 'person' | 'clear' | 'uncertain';
export type Mode = 'demo' | 'live';
export const STATUS: Record<Status, string> = {free:'Свободен', occupied:'Занят', dirty:'Нужна уборка', cleaning:'Уборка'};
export const STATES: Status[] = ['free', 'occupied', 'dirty'];
export const TRANSITION = [[0.97,0.03,0], [0,0.96,0.04], [0,0.015,0.985]];
export const EMISSION: Record<Observation, number[]> = {person:[0.03,0.94,0.03], clear:[0.94,0.03,0.94], uncertain:[0.33,0.34,0.33]};
export type Zone = {x:number;y:number;w:number;h:number};
export type Table = {id:number;capacity:number;zone:'main'|'window';status:Status;since:number;cleaningSince?:number|null;guests:number;servedAt:number|null;belief:number[];confidence:number|null;source:Source;roi:Zone|null;lastObservation:Observation|null;streak:number};
export type Guest = {id:string;name:string;size:number;at:number;note:string};
export type Log = {id:string;at:number;tableId:number;message:string;source:Source;kind:'state'|'service'|'info'};
export type Alert = {id:string;tableId:number;kind:'service'|'cleaning';message:string;at:number;done:boolean};
export type Visit = {tableId:number;start:number;end:number;guests:number;source:Source};
export type AppState = {schema:1;mode:Mode;tables:Table[];queue:Guest[];logs:Log[];alerts:Alert[];visits:Visit[];startedAt:number;settings:{serviceMinutes:number;cleaningMinutes:number;confidence:number;restaurant:string};cameraName:string};
const uid=()=>globalThis.crypto.randomUUID();
export function initialState(mode:Mode,now=Date.now()):AppState {
  const statuses:Status[]= mode==='demo'?['occupied','free','occupied','free','dirty','occupied','occupied','free','cleaning','occupied','free','occupied']:Array(12).fill('free');
  const tables=statuses.map((status,id):Table=>({id:id+1,capacity:[2,4,4,2,4,6,4,2,4,6,2,4][id],zone:id%4===3?'window':'main',status,since:mode==='live'?now:now-(status==='occupied'?(8+id*4):status==='dirty'?7:2)*60000,guests:status==='occupied'?[2,0,3,0,0,5,3,0,0,4,0,2][id]:0,servedAt:status==='occupied'&&id!==2?now-120000:null,belief:status==='occupied'?[0,1,0]:status==='free'?[1,0,0]:[0,0,1],confidence:null,source:mode==='demo'?'demo':'manual',roi:null,lastObservation:null,streak:0}));
  return {schema:1,mode,tables,queue:mode==='demo'?[{id:'demo-guest-1',name:'Алия',size:3,at:now-9*60000,note:'У окна, если возможно'},{id:'demo-guest-2',name:'Дамир',size:5,at:now-4*60000,note:''}]:[],logs:[],alerts:[],visits:mode==='demo'?Array.from({length:24},(_,i)=>({tableId:i%12+1,start:now-(360-i*11)*60000,end:now-(310-i*11)*60000,guests:Math.min(tables[i%12].capacity,2+i%4),source:'demo' as const})):[],startedAt:now,settings:{serviceMinutes:3,cleaningMinutes:5,confidence:0.55,restaurant:'TableFlow Bistro'},cameraName:'Камера зала'};
}
export function hmmStep(prior:number[],observation:Observation):number[]{
  const prediction=STATES.map((_,j)=>prior.reduce((a,p,i)=>a+p*TRANSITION[i][j],0));
  const weighted=prediction.map((p,j)=>p*EMISSION[observation][j]);
  const sum=weighted.reduce((a,b)=>a+b,0);
  return weighted.map(p=>p/sum);
}
function event(s:AppState,tableId:number,message:string,source:Source,at:number,kind:Log['kind']='state') {
  s.logs=[{id:uid(),at,tableId,message,source,kind},...s.logs].slice(0,500);
}
export function changeStatus(state:AppState,id:number,status:Status,at:number,source:Source,guests?:number):AppState{
  const s=structuredClone(state),t=s.tables.find(t=>t.id===id);if(!t||t.status===status)return state;
  const previous=t.status;
  t.cleaningSince=status==='dirty'?at:status==='cleaning'?(t.cleaningSince??t.since):null;
  if(previous==='occupied'&&status!=='occupied')s.visits=[...s.visits,{tableId:id,start:t.since,end:at,guests:t.guests,source:t.source}].slice(-2000);
  t.status=status;t.since=at;t.source=source;t.servedAt=null;t.guests=status==='occupied'?Math.min(t.capacity,Math.max(1,guests||1)):0;
  t.belief=status==='free'?[1,0,0]:status==='occupied'?[0,1,0]:[0,0,1];t.confidence=null;t.streak=0;t.lastObservation=null;
  s.alerts=s.alerts.map(a=>a.tableId===id?{...a,done:true}:a);
  event(s,id,`${STATUS[previous]} → ${STATUS[status]}`,source,at);return s;
}
export function observe(state:AppState,id:number,observation:Observation,at:number):AppState{
  const s=structuredClone(state),t=s.tables.find(t=>t.id===id);if(!t||t.status==='cleaning')return state;
  t.belief=hmmStep(t.belief,observation);t.confidence=Math.max(...t.belief);t.streak=t.lastObservation===observation?t.streak+1:1;t.lastObservation=observation;
  const next=STATES[t.belief.indexOf(t.confidence)];
  // A short occlusion cannot clear a table. A human confirms completed cleaning.
  if(t.streak>=3&&t.confidence>0.86&&next!==t.status&&!(t.status==='dirty'&&next==='free')){
    const changed=changeStatus(s,id,next,at,'camera');const nt=changed.tables.find(t=>t.id===id)!;nt.confidence=t.confidence;nt.belief=t.belief;nt.lastObservation=observation;nt.streak=t.streak;return changed;
  }
  return s;
}
export function runAgent(state:AppState,at:number):AppState{
  let changed=false;const s=structuredClone(state);
  for(const t of s.tables){
    const cleaningSince=t.cleaningSince??t.since;
    const kind=t.status==='occupied'&&!t.servedAt&&at-t.since>=s.settings.serviceMinutes*60000?'service':(t.status==='dirty'||t.status==='cleaning')&&at-cleaningSince>=s.settings.cleaningMinutes*60000?'cleaning':null;
    if(!kind)continue;
    const id=`${t.id}:${kind==='cleaning'?cleaningSince:t.since}:${kind}`;if(s.alerts.some(a=>a.id===id))continue;
    s.alerts.unshift({id,tableId:t.id,kind,at,done:false,message:kind==='service'?'Гости ждут первого подхода':'Стол ожидает уборки'});changed=true;
    event(s,t.id,kind==='service'?'Агент: требуется первый подход':'Агент: задержка уборки',state.mode==='demo'?'demo':t.source,at,'info');
  }
  s.alerts=s.alerts.slice(0,200);return changed?s:state;
}
export function serve(state:AppState,id:number,at:number):AppState{
  const s=structuredClone(state),t=s.tables.find(t=>t.id===id);if(!t||t.status!=='occupied')return state;
  t.servedAt=at;s.alerts=s.alerts.map(a=>a.tableId===id&&a.kind==='service'?{...a,done:true}:a);event(s,id,'Первый подход подтверждён','manual',at,'service');return s;
}
export function recommend(tables:Table[],size:number):Table|undefined{
  return tables.filter(t=>t.status==='free'&&t.capacity>=size).sort((a,b)=>a.capacity-b.capacity||a.id-b.id)[0];
}
export function seatGuest(state:AppState,guestId:string,at:number):AppState{
  const g=state.queue.find(g=>g.id===guestId);if(!g)return state;const t=recommend(state.tables,g.size);if(!t)return state;
  const s=changeStatus(state,t.id,'occupied',at,'manual',g.size);s.queue=s.queue.filter(g=>g.id!==guestId);event(s,t.id,`Группа ${g.name}: ${g.size} чел.`,'manual',at,'info');return s;
}
export function elapsed(since:number,now:number):string{
  const minutes=Math.max(0,Math.floor((now-since)/60000));return minutes>=60?`${Math.floor(minutes/60)} ч ${minutes%60} м`:`${minutes} мин`;
}
export function validateState(value:unknown):value is AppState{
  if(!value||typeof value!=='object')return false;const s=value as AppState;
  const finite=(n:unknown)=>typeof n==='number'&&Number.isFinite(n);
  const str=(v:unknown,max=200)=>typeof v==='string'&&v.length<=max;
  const source=(v:unknown)=>['demo','manual','camera'].includes(String(v));
  if(s.schema!==1||!['demo','live'].includes(s.mode)||!Array.isArray(s.tables)||s.tables.length!==12||!Array.isArray(s.queue)||s.queue.length>100||!Array.isArray(s.logs)||s.logs.length>500||!Array.isArray(s.alerts)||s.alerts.length>200||!Array.isArray(s.visits)||s.visits.length>2000)return false;
  if(!s.tables.every(t=>t&&Number.isInteger(t.id)&&t.id>=1&&t.id<=12&&Object.keys(STATUS).includes(t.status)&&finite(t.since)&&Number.isInteger(t.capacity)&&t.capacity>=1&&t.capacity<=20&&Number.isInteger(t.guests)&&t.guests>=0&&t.guests<=t.capacity&&['main','window'].includes(t.zone)&&source(t.source)&&(t.servedAt===null||finite(t.servedAt))&&(t.confidence===null||(finite(t.confidence)&&t.confidence>=0&&t.confidence<=1))&&Number.isInteger(t.streak)&&t.streak>=0&&(t.lastObservation===null||['person','clear','uncertain'].includes(t.lastObservation))&&Array.isArray(t.belief)&&t.belief.length===3&&t.belief.every(n=>finite(n)&&n>=0&&n<=1)&&Math.abs(t.belief.reduce((a,b)=>a+b)-1)<0.001&&(t.roi===null||(typeof t.roi==='object'&&['x','y','w','h'].every(k=>finite(t.roi![k as keyof Zone])&&t.roi![k as keyof Zone]>=0&&t.roi![k as keyof Zone]<=1)&&t.roi.x+t.roi.w<=1.001&&t.roi.y+t.roi.h<=1.001))))return false;
  if(new Set(s.tables.map(t=>t.id)).size!==12)return false;
  if(!s.tables.every(t=>t.cleaningSince===undefined||t.cleaningSince===null||finite(t.cleaningSince)))return false;
  if(!s.settings||!Number.isFinite(s.settings.serviceMinutes)||s.settings.serviceMinutes<1||s.settings.serviceMinutes>60||!Number.isFinite(s.settings.cleaningMinutes)||s.settings.cleaningMinutes<1||s.settings.cleaningMinutes>60||!Number.isFinite(s.settings.confidence)||s.settings.confidence<0.2||s.settings.confidence>0.95||typeof s.settings.restaurant!=='string'||s.settings.restaurant.length>80)return false;
  if(!finite(s.startedAt)||!str(s.cameraName,80))return false;
  if(!s.queue.every(g=>g&&str(g.id,100)&&str(g.name,80)&&g.name.trim().length>0&&str(g.note,200)&&Number.isInteger(g.size)&&g.size>=1&&g.size<=20&&finite(g.at)))return false;
  if(!s.logs.every(l=>l&&str(l.id,100)&&str(l.message,300)&&finite(l.at)&&Number.isInteger(l.tableId)&&l.tableId>=1&&l.tableId<=12&&source(l.source)&&['state','service','info'].includes(l.kind)))return false;
  if(!s.alerts.every(a=>a&&str(a.id,100)&&str(a.message,200)&&finite(a.at)&&Number.isInteger(a.tableId)&&a.tableId>=1&&a.tableId<=12&&['service','cleaning'].includes(a.kind)&&typeof a.done==='boolean'))return false;
  return s.visits.every(v=>v&&Number.isInteger(v.tableId)&&v.tableId>=1&&v.tableId<=12&&finite(v.start)&&finite(v.end)&&v.end>=v.start&&Number.isInteger(v.guests)&&v.guests>=0&&v.guests<=20&&source(v.source));
}

/** Clear shift records while preserving the configured hall and camera calibration. */
export function resetShift(state:AppState,at=Date.now()):AppState{
 const fresh=initialState('live',at);fresh.mode=state.mode;fresh.settings={...state.settings};fresh.cameraName=state.cameraName;
 fresh.tables=fresh.tables.map(t=>{const old=state.tables.find(x=>x.id===t.id)!;return {...t,capacity:old.capacity,zone:old.zone,roi:old.roi?{...old.roi}:null,source:state.mode==='demo'?'demo':'manual'};});return fresh;
}
