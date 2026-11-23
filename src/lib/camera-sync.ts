import {AppState,Table,Zone,initialState,validateState} from './engine';
import {Detection} from './vision';
import {SCENE_LABELS} from './service-vision';
import type {VideoEvidence} from './table-service';
import {applyVideoFrame} from './video-frame';
export type CameraMessage=
 |{type:'layout';epoch:string;revision:number;tables:Table[]}
 |{type:'observations';epoch:string;frame:number;people:Detection[];scene?:Detection[];zones:{id:number;roi:Zone|null}[];ms:number}
 |{type:'calibration';epoch:string;zones:{id:number;roi:Zone|null}[]}
 |{type:'analysis-status';epoch:string;active:boolean};
export type CameraSender=(message:CameraMessage)=>boolean;
const finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n);
function validZones(value:unknown):value is {id:number;roi:Zone|null}[]{
 if(!Array.isArray(value)||value.length!==12||new Set(value.map(t=>t?.id)).size!==12)return false;
 return value.every(t=>t&&typeof t==='object'&&Number.isInteger(t.id)&&t.id>=1&&t.id<=12&&(t.roi===null||['x','y','w','h'].every(k=>finite(t.roi?.[k])&&t.roi[k]>=0&&t.roi[k]<=1)&&t.roi.w>=.005&&t.roi.h>=.005&&t.roi.x+t.roi.w<=1.001&&t.roi.y+t.roi.h<=1.001));
}
function validScene(value:unknown):value is Detection[]{
 if(!Array.isArray(value)||value.length>100)return false;
 const classes=new Set(Object.values(SCENE_LABELS));
 return value.every((d:Detection)=>d&&classes.has(d.class)&&finite(d.score)&&d.score>=0&&d.score<=1&&Array.isArray(d.bbox)&&d.bbox.length===4&&d.bbox.every(finite)&&d.bbox[0]>=0&&d.bbox[1]>=0&&d.bbox[2]>0&&d.bbox[3]>0&&d.bbox[0]+d.bbox[2]<=1.001&&d.bbox[1]+d.bbox[3]<=1.001&&(d.role===undefined||d.role==='staff'&&d.class==='person')&&(d.tableModel===undefined||d.tableModel==='restaurant')&&(d.surface===undefined||d.class==='dining table'&&typeof d.surface.clear==='boolean'&&typeof d.surface.visible==='boolean'&&Number.isInteger(d.surface.objects)&&d.surface.objects>=0&&d.surface.objects<=100&&finite(d.surface.darkFraction)&&d.surface.darkFraction>=0&&d.surface.darkFraction<=1));
}
export function parseCameraMessage(raw:unknown):CameraMessage|null{
 if(typeof raw!=='string'||raw.length>50000)return null;
 try{const m=JSON.parse(raw);if(!m||typeof m.epoch!=='string'||m.epoch.length>64||!m.epoch)return null;
  if(m.type==='layout'&&Number.isSafeInteger(m.revision)&&m.revision>0&&validateState({...initialState('live'),tables:m.tables}))return {type:m.type,epoch:m.epoch,revision:m.revision,tables:m.tables.map(publicTable)};
  if(m.type==='calibration'&&validZones(m.zones))return {type:m.type,epoch:m.epoch,zones:m.zones};
  if(m.type==='analysis-status'&&typeof m.active==='boolean')return {type:m.type,epoch:m.epoch,active:m.active};
  if(m.type==='observations'&&(m.scene===undefined||validScene(m.scene))&&validScene(m.people)&&Number.isSafeInteger(m.frame)&&m.frame>0&&finite(m.ms)&&m.ms>=0&&m.ms<=600000&&validZones(m.zones)&&Array.isArray(m.people)&&m.people.length<=100&&m.people.every((d:Detection)=>d?.class==='person'&&finite(d.score)&&d.score>=0&&d.score<=1&&Array.isArray(d.bbox)&&d.bbox.length===4&&d.bbox.every(finite)&&d.bbox[0]>=0&&d.bbox[1]>=0&&d.bbox[2]>0&&d.bbox[3]>0&&d.bbox[0]+d.bbox[2]<=1.001&&d.bbox[1]+d.bbox[3]<=1.001))return {type:m.type,epoch:m.epoch,frame:m.frame,people:m.people,scene:m.scene,zones:m.zones,ms:m.ms};
 }catch{}return null;
}
function publicTable(t:Table):Table{return {id:t.id,capacity:t.capacity,zone:t.zone,status:t.status,since:t.since,guests:t.guests,servedAt:null,belief:[...t.belief],confidence:t.confidence,source:t.source,roi:t.roi?{...t.roi}:null,lastObservation:t.lastObservation,streak:t.streak};}
export function layoutMessage(state:AppState,epoch:string,revision:number):CameraMessage{return {type:'layout',epoch,revision,tables:state.tables.map(publicTable)};}
export const tableCalibration=(state:AppState)=>state.tables.map(t=>({id:t.id,roi:t.roi?{...t.roi}:null}));
export function normalizePeople(people:Detection[],width:number,height:number):Detection[]{
 if(width<=0||height<=0)return [];
 return normalizeScene(people.filter(d=>d.class==='person'),width,height);
}
export function normalizeScene(people:Detection[],width:number,height:number):Detection[]{
 if(width<=0||height<=0)return [];
 return people.map(d=>{const [x,y,w,h]=d.bbox,left=Math.max(0,x/width),top=Math.max(0,y/height),right=Math.min(1,(x+w)/width),bottom=Math.min(1,(y+h)/height);return {...d,bbox:[left,top,right-left,bottom-top] as Detection['bbox']};}).filter(d=>d.bbox[2]>0&&d.bbox[3]>0).slice(0,100);
}
export function applyCalibration(state:AppState,zones:{id:number;roi:Zone|null}[]):AppState{
 if(!validZones(zones))return state;
 return {...state,tables:state.tables.map(t=>{const roi=zones.find(z=>z.id===t.id)!.roi;if(JSON.stringify(roi)===JSON.stringify(t.roi))return t;return {...t,roi,lastObservation:null,streak:0,confidence:null,belief:t.status==='occupied'?[0,1,0]:t.status==='free'?[1,0,0]:[0,0,1]};})};
}
export function applyRemoteObservations(state:AppState,m:Extract<CameraMessage,{type:'observations'}>,at:number,tracking?:VideoEvidence){
 const calibrated=state.tables.some(t=>t.roi)?state:applyCalibration(state,m.zones);
 return applyVideoFrame(calibrated,m.people,1,1,at,tracking);
}
