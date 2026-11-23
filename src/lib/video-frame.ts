import {AppState,observe,runAgent,changeStatus} from './engine';
import {Detection,peopleByTable,tableZones} from './vision';
import type {VideoEvidence} from './table-service';
export function applyVideoFrame(state:AppState,detections:Detection[],width:number,height:number,at:number,tracking?:VideoEvidence):AppState{
 const counts=tracking?.confirmed||peopleByTable(detections,width,height,state.tables);let next=state;
 for(const table of state.tables){
  if(!table.roi)continue;
  const count=counts.get(table.id)||0;
  if(tracking?.departed?.has(table.id)&&table.status==='occupied')next=changeStatus(next,table.id,'dirty',at,'camera');
  if(tracking?.servicing?.has(table.id)&&next.tables.find(t=>t.id===table.id)?.status==='dirty')next=changeStatus(next,table.id,'cleaning',at,'camera');
  if(tracking?.cleaned?.has(table.id)&&!count&&!tracking.present.has(table.id))next=changeStatus(next,table.id,'free',at,'camera');
  // A moving or newly arrived person is ambiguous; do not advance the HMM.
  if(!count&&tracking?.present.has(table.id))continue;
  // The tracker has already confirmed dwell over multiple frames. Apply that
  // confirmation immediately instead of requiring another three HMM frames.
  if(tracking&&count&&(table.status==='free'||table.status==='dirty'))next=changeStatus(next,table.id,'occupied',at,'camera',count);
  else next=observe(next,table.id,count?'person':'clear',at);
  const t=next.tables.find(t=>t.id===table.id)!;
  if(count&&t.status==='occupied'&&t.source==='camera')t.guests=Math.min(t.capacity,count);
 }
 return runAgent(next,at);
}

/** A new recording must not inherit a stale camera belief from the previous clip. */
export function resetVideoZones(state:AppState,at:number):AppState{
 const resetIds=state.tables.filter(t=>t.source==='camera').map(t=>t.id);
 return {...state,tables:state.tables.map(t=>({...t,roi:null,lastObservation:null,streak:0,...(t.source==='camera'?{status:'free' as const,since:at,guests:0,servedAt:null,confidence:null,belief:[1,0,0]}:{})})),alerts:state.alerts.map(a=>resetIds.includes(a.tableId)?{...a,done:true}:a)};
}

/** Find table zones again on later frames if the first frame had none. */
export function discoverTableZones(state:AppState,detections:Detection[],width:number,height:number):AppState{
 if(state.tables.some(t=>t.roi))return state;
 const zones=tableZones(detections,width,height);
 return zones.length?{...state,tables:state.tables.map((t,i)=>({...t,roi:zones[i]||null}))}:state;
}
