import type {AppState,Table} from './engine';
import {Detection,sameTableZone,tableZones,tablesWithPossibleGuests} from './vision';

export type SeatingEvidence={confirmed:Map<number,number>;present:Map<number,number>;observed?:Set<number>};
export type VideoEvidence=SeatingEvidence&{departed?:Set<number>;servicing?:Set<number>;cleaned?:Set<number>};
type Memory={emptySince:number|null;emptyFrames:number;staffSince:number|null;staffFrames:number;started:boolean;clearFrames:number};

/** Staff departure ends cleaning immediately; an empty white tabletop also frees a table. */
export class TableServiceTracker{
 maxFrameGapMs=2500;
 departureDelayMs=6000;
 private memory=new Map<number,Memory>();
 private lastAt:number|null=null;
 clear(){this.memory.clear();this.lastAt=null;}
 pause(){this.lastAt=null;for(const m of this.memory.values()){m.emptySince=null;m.emptyFrames=0;m.staffSince=null;m.staffFrames=0;m.clearFrames=0;}}
 update(state:AppState,detections:Detection[],width:number,height:number,at:number,seating:SeatingEvidence):VideoEvidence{
  if(this.lastAt!==null&&(at<this.lastAt||at-this.lastAt>this.maxFrameGapMs))this.pause();this.lastAt=at;
  const departed=new Set<number>(),servicing=new Set<number>(),cleaned=new Set<number>(),staffNear=new Set<number>(),possibleGuests=tablesWithPossibleGuests(detections,width,height,state.tables);
  for(const person of detections.filter(d=>d.class==='person'&&d.role==='staff')){
   const [x,y,w,h]=person.bbox,px=(x+w/2)/width,py=(y+h*.75)/height;
   const choices=state.tables.filter(t=>{const z=t.roi;return z&&px>=z.x-z.w*.4&&px<=z.x+z.w*1.4&&py>=z.y-z.h&&py<=z.y+z.h*2;});
   const distance=(t:Table)=>{const z=t.roi!;return Math.hypot((px-z.x-z.w/2)/z.w,(py-z.y-z.h/2)/(z.h*2));};
   choices.sort((a,b)=>distance(a)-distance(b));if(choices[0])staffNear.add(choices[0].id);
  }
  const surfaces=detections.filter(d=>d.class==='dining table'&&d.surface).map(d=>({zone:tableZones([d],width,height)[0],surface:d.surface!}));
  const tableSurfaces=new Map<number,NonNullable<Detection['surface']>>();
  for(const s of surfaces){if(!s.zone)continue;const z=s.zone,cx=z.x+z.w/2,cy=z.y+z.h/2;
   const choices=state.tables.filter(t=>t.roi&&(sameTableZone(z,t.roi)||t.roi.kind!=='tabletop'&&cx>=t.roi.x&&cx<=t.roi.x+t.roi.w&&cy>=t.roi.y&&cy<=t.roi.y+t.roi.h));
   choices.sort((a,b)=>Math.hypot(cx-a.roi!.x-a.roi!.w/2,cy-a.roi!.y-a.roi!.h/2)-Math.hypot(cx-b.roi!.x-b.roi!.w/2,cy-b.roi!.y-b.roi!.h/2));
   if(choices[0]&&!tableSurfaces.has(choices[0].id))tableSurfaces.set(choices[0].id,s.surface);
  }
  for(const table of state.tables){
   if(!table.roi){this.memory.delete(table.id);continue;}
   const m=this.memory.get(table.id)||{emptySince:null,emptyFrames:0,staffSince:null,staffFrames:0,started:false,clearFrames:0};
   this.memory.set(table.id,m);
   if(seating.observed&&!seating.observed.has(table.id)){m.emptySince=null;m.emptyFrames=0;m.staffSince=null;m.staffFrames=0;m.clearFrames=0;continue;}
   const guests=(seating.present.get(table.id)||0)>0||(seating.confirmed.get(table.id)||0)>0;
   if(guests||possibleGuests.has(table.id)){m.emptySince=null;m.emptyFrames=0;m.staffSince=null;m.staffFrames=0;m.clearFrames=0;m.started=false;continue;}
   m.emptySince??=at;m.emptyFrames++;
   if(table.status==='free'){m.started=false;m.clearFrames=0;}
   if(table.status==='occupied'&&m.emptyFrames>=3&&at-m.emptySince>=this.departureDelayMs)departed.add(table.id);
   const waiting=table.status==='dirty'||departed.has(table.id),cleaning=table.status==='cleaning';
   const surface=tableSurfaces.get(table.id);
   if(staffNear.has(table.id)){
    m.staffSince??=at;m.staffFrames++;m.clearFrames=0;
    if((waiting||cleaning)&&m.staffFrames>=2&&at-m.staffSince>=600){m.started=true;if(waiting)servicing.add(table.id);}
    continue;
   }
   m.staffSince=null;m.staffFrames=0;
   // A completed staff visit ends on the first observed departure, without waiting
   // for foreground/colour thresholds to settle after the person's occlusion.
   if(m.started&&(waiting||cleaning)){
    cleaned.add(table.id);m.clearFrames=0;continue;
   }
   // A visibly empty white tabletop is sufficient by itself. Previous objects or
   // a previously observed staff visit are not required.
   m.clearFrames=surface?.visible&&surface.clear&&surface.objects===0?m.clearFrames+1:0;
   if(m.clearFrames>=2&&(waiting||cleaning)){
    cleaned.add(table.id);
   }

  }
  return {...seating,departed,servicing,cleaned};
 }
}
