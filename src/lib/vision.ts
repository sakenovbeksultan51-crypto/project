import {Table} from './engine';
import {RESTAURANT_MODEL} from './restaurant-model';
export type Detection={bbox:[number,number,number,number];class:string;score:number;tableModel?:'restaurant';role?:'staff';surface?:{clear:boolean;visible:boolean;objects:number;darkFraction:number}};
/** Assign one detected person to at most one table, even when ROIs overlap. */
export function peopleByTable(detections:Detection[],width:number,height:number,tables:Table[]):Map<number,number>{
 const counts=new Map<number,number>();if(width<=0||height<=0)return counts;
 for(const d of detections){if(d.class!=='person'||d.role==='staff')continue;const x=(d.bbox[0]+d.bbox[2]/2)/width,y=(d.bbox[1]+d.bbox[3]*0.55)/height;
  const choices=tables.filter(t=>t.roi&&x>=t.roi.x&&x<=t.roi.x+t.roi.w&&y>=t.roi.y&&y<=t.roi.y+t.roi.h);
  choices.sort((a,b)=>{const az=a.roi!,bz=b.roi!;return Math.hypot(x-az.x-az.w/2,y-az.y-az.h/2)-Math.hypot(x-bz.x-bz.w/2,y-bz.y-bz.h/2)||a.id-b.id;});
  if(choices[0])counts.set(choices[0].id,(counts.get(choices[0].id)||0)+1);
 }return counts;
}

/** Candidate seating areas inferred from detected dining tables; users may correct them. */
export function tableZones(detections:Detection[],width:number,height:number):{x:number;y:number;w:number;h:number}[]{
 if(width<=0||height<=0)return [];
 const zones=detections.filter(d=>d.class==='dining table'&&d.score>=(d.tableModel==='restaurant'?RESTAURANT_MODEL.confidence:.3)).sort((a,b)=>b.score-a.score).filter((d,i,all)=>!all.slice(0,i).some(p=>{const [x,y,w,h]=d.bbox,[px,py,pw,ph]=p.bbox;const overlap=Math.max(0,Math.min(x+w,px+pw)-Math.max(x,px))*Math.max(0,Math.min(y+h,py+ph)-Math.max(y,py));return overlap/(w*h+pw*ph-overlap)>.55;})).map(d=>{
  const [bx,by,bw,bh]=d.bbox;
  const x=Math.max(0,(bx-bw*0.3)/width),y=Math.max(0,(by-bh*0.5)/height);
  const right=Math.min(1,(bx+bw*1.3)/width),bottom=Math.min(1,(by+bh*1.5)/height);
  return {x,y,w:right-x,h:bottom-y};
 }).filter(z=>z.w>0.015&&z.h>0.015).sort((a,b)=>a.y-b.y||a.x-b.x);
 return zones.slice(0,12);
}

/** Treat strongly overlapping proposals as the same table, without renumbering saved zones. */
export function sameTableZone(a:{x:number;y:number;w:number;h:number},b:{x:number;y:number;w:number;h:number}):boolean{
 const overlap=Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
 return overlap/(a.w*a.h+b.w*b.h-overlap)>.5;
}
export function addTableZones(state:import('./engine').AppState,zones:import('./engine').Zone[]):import('./engine').AppState{
 const existing=state.tables.flatMap(t=>t.roi?[t.roi]:[]),fresh:import('./engine').Zone[]=[];
 for(const z of zones){if(![...existing,...fresh].some(x=>sameTableZone(x,z)))fresh.push(z);}
 if(!fresh.length)return state;let i=0;const tables=state.tables.map(t=>t.roi||i>=fresh.length?t:{...t,roi:fresh[i++]});
 return i?{...state,tables}:state;
}
export class TableDiscovery{
 private previous:import('./engine').Zone[]=[];private ignored:import('./engine').Zone[]=[];
 clear(){this.previous=[];this.ignored=[];}
 reject(zone:import('./engine').Zone){this.ignored.push(zone);this.previous=[];}
 candidates(state:import('./engine').AppState,detections:Detection[],width:number,height:number):import('./engine').Zone[]{
  return this.zones(state,tableZones(detections,width,height));
 }
 zones(state:import('./engine').AppState,zones:import('./engine').Zone[],immediate=false):import('./engine').Zone[]{
  const found=zones.filter(z=>!this.ignored.some(x=>sameTableZone(x,z)));
  const existing=state.tables.flatMap(t=>t.roi?[t.roi]:[]),unseen=found.filter(z=>!existing.some(x=>sameTableZone(x,z)));
  // Initial proposals are visible immediately. Add later proposals after two scans.
  const accepted=existing.length&&!immediate?unseen.filter(z=>this.previous.some(x=>sameTableZone(x,z))):unseen;
  this.previous=unseen;return accepted;
 }
}

/** Match each visible table once and move its zone while retaining its identity. */
export class DynamicTableTracker {
 public limit=12;
 public excludedIds=new Set<number>();
 private excludedZones=new Map<number,import('./engine').Zone>();
 private discovery=new TableDiscovery();
 private pinned=new Set<number>();
 private missing=new Map<number,number>();
 clear(){this.discovery.clear();this.pinned.clear();this.missing.clear();this.excludedZones.clear();}
 pin(id:number){this.pinned.add(id);}
 reject(zone:import('./engine').Zone){this.discovery.reject(zone);}
 update(state:import('./engine').AppState,detections:Detection[],width:number,height:number):import('./engine').AppState{
  state={...state,tables:state.tables.map(t=>this.excludedIds.has(t.id)&&this.excludedZones.has(t.id)?{...t,roi:this.excludedZones.get(t.id)!}:t)};
  const found=tableZones(detections,width,height),used=new Set<number>();
  const pairs: {id:number;index:number;distance:number}[]=[];
  for(const t of state.tables){if(!t.roi)continue;const a=t.roi;
   found.forEach((b,index)=>{const ratio=Math.max(a.w*b.h/(b.w*a.h),b.w*a.h/(a.w*b.h));const distance=Math.hypot((a.x+a.w/2-b.x-b.w/2)/Math.max(a.w,b.w),(a.y+a.h/2-b.y-b.h/2)/Math.max(a.h,b.h));if(distance<.65&&ratio<2.5)pairs.push({id:t.id,index,distance});});
  }
  pairs.sort((a,b)=>a.distance-b.distance);const matched=new Map<number,number>();
  for(const p of pairs)if(!matched.has(p.id)&&!used.has(p.index)){matched.set(p.id,p.index);used.add(p.index);}
  let next={...state,tables:state.tables.map(t=>{const index=matched.get(t.id);if(this.pinned.has(t.id)||!t.roi)return t;if(index===undefined){const missed=(this.missing.get(t.id)||0)+1;this.missing.set(t.id,missed);return missed>=6?{...t,roi:null}:t;}this.missing.delete(t.id);return {...t,roi:found[index]};})};
  // Only unmatched detections can create new tables; match against this frame's positions.
  const unseen=found.filter((_,i)=>!used.has(i));
  const proposals=this.discovery.zones(next,unseen,detections.some(d=>d.tableModel==='restaurant'));
  next=addTableZones(next,proposals.slice(0,Math.max(0,this.limit-next.tables.filter(t=>t.roi).length)));
  this.excludedZones.clear();
  next={...next,tables:next.tables.map(t=>{if(!this.excludedIds.has(t.id))return t;if(t.roi)this.excludedZones.set(t.id,t.roi);return {...t,roi:null};})};return next;
 }
}

/** Track short-lived, approximately stationary people within each seating zone.
 * This is a motion heuristic, not seated-pose recognition. */
export class SeatingTracker {
 maxFrameGapMs=4000;
 private tracks=new Map<number,{x:number;y:number;anchorX:number;anchorY:number;w:number;h:number;since:number;last:number;frames:number}[]>();
 clear(){this.tracks.clear();}
 update(detections:Detection[],width:number,height:number,tables:Table[],at:number):{confirmed:Map<number,number>;present:Map<number,number>}{
  const confirmed=new Map<number,number>(),present=new Map<number,number>();
  if(width<=0||height<=0){this.clear();return {confirmed,present};}
  const assigned=new Map<number,Detection[]>();
  // Use the same single-table assignment as occupancy, preserving overlap handling.
  for(const person of detections){const match=peopleByTable([person],width,height,tables);const id=match.keys().next().value as number|undefined;if(id!==undefined)assigned.set(id,[...(assigned.get(id)||[]),person]);}
  const next=new Map<number,NonNullable<ReturnType<typeof this.tracks.get>>>();
  for(const table of tables){
   if(!table.roi)continue;
   const previous=(this.tracks.get(table.id)||[]).filter(t=>at>=t.last&&at-t.last<=this.maxFrameGapMs),used=new Set<number>(),current:typeof previous=[];
   for(const d of assigned.get(table.id)||[]){
    const [bx,by,bw,bh]=d.bbox,x=(bx+bw/2)/width,y=(by+bh*.55)/height,w=bw/width,h=bh/height;
    let best=-1,bestDistance=Infinity;
    previous.forEach((p,i)=>{if(used.has(i))return;const dist=Math.hypot((x-p.x)/Math.max(.015,w,p.w),(y-p.y)/Math.max(.015,h,p.h));if(dist<.75&&dist<bestDistance){best=i;bestDistance=dist;}});
    let track=best<0?{x,y,anchorX:x,anchorY:y,w,h,since:at,last:at,frames:1}:{...previous[best],x,y,w,h,last:at,frames:previous[best].frames+1};
    if(best>=0)used.add(best);
    // Reset the dwell timer when accumulated movement exceeds the person's size.
    if(Math.abs(x-track.anchorX)>Math.max(.012,track.w*.45)||Math.abs(y-track.anchorY)>Math.max(.012,track.h*.25))track={...track,anchorX:x,anchorY:y,since:at,frames:1};
    current.push(track);if(track.frames>=2&&at-track.since>=1500)confirmed.set(table.id,(confirmed.get(table.id)||0)+1);
   }
   if(current.length)present.set(table.id,current.length);
   // Brief detector dropouts do not erase a person's track.
   const retained=previous.filter((_,i)=>!used.has(i));
   if(current.length||retained.length)next.set(table.id,[...current,...retained]);
  }
  this.tracks=next;return {confirmed,present};
 }
}
