import type {Table} from './engine';
import type {Detection} from './vision';

type Rect={x:number;y:number;w:number;h:number};
export type OverlayBadge=Rect&{id:number;text:string;color:string;anchorX:number;anchorY:number};
const colors={free:'#8abfa5',occupied:'#f4bd64',dirty:'#fb967e',cleaning:'#88c8f4'};
const overlap=(a:Rect,b:Rect)=>Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));

/** Compact table labels stay in the picture and avoid heads and other labels. */
export function layoutTableBadges(tables:Table[],viewport:Rect,heads:Rect[]=[]):OverlayBadge[]{
 const placed:OverlayBadge[]=[];
 for(const t of [...tables].filter(t=>t.roi).sort((a,b)=>a.roi!.y-b.roi!.y||a.id-b.id)){
  const z=t.roi!,anchorX=viewport.x+(z.x+z.w/2)*viewport.w,anchorY=viewport.y+(z.y+z.h/2)*viewport.h;
  const text=`T${String(t.id).padStart(2,'0')}${t.status==='occupied'&&t.guests?` · ${t.guests}`:''}`,w=t.status==='occupied'&&t.guests?70:48,h=25;
  let best:Rect={x:anchorX-w/2,y:anchorY-h/2,w,h},cost=Infinity;
  for(let ring=0;ring<=5;ring++)for(const [dx,dy] of ring?[[0,-1],[1,0],[-1,0],[0,1],[1,-1],[-1,1],[1,1],[-1,-1]]:[[0,0]]){
   const r={x:Math.max(viewport.x+3,Math.min(viewport.x+viewport.w-w-3,anchorX-w/2+dx*ring*28)),y:Math.max(viewport.y+3,Math.min(viewport.y+viewport.h-h-3,anchorY-h/2+dy*ring*28)),w,h};
   const collision=[...heads,...placed].reduce((sum,p)=>sum+overlap({...r,x:r.x-3,y:r.y-3,w:w+6,h:h+6},p),0),score=collision*1000+Math.hypot(r.x+w/2-anchorX,r.y+h/2-anchorY);
   if(score<cost){cost=score;best=r;}
  }
  placed.push({...best,id:t.id,text,color:colors[t.status],anchorX,anchorY});
 }return placed;
}

function rounded(ctx:CanvasRenderingContext2D,r:Rect,radius=9){
 const {x,y,w,h}=r;ctx.beginPath();ctx.moveTo(x+radius,y);ctx.arcTo(x+w,y,x+w,y+h,radius);ctx.arcTo(x+w,y+h,x,y+h,radius);ctx.arcTo(x,y+h,x,y,radius);ctx.arcTo(x,y,x+w,y,radius);ctx.closePath();
}

export function drawVisionOverlay(ctx:CanvasRenderingContext2D,options:{viewport:Rect;people:Detection[];tables:Table[];width:number;height:number;debug?:boolean;calibrating?:boolean;selected?:number}){
 const {viewport:v,people,tables,width,height,debug,calibrating,selected}=options;if(!width||!height)return;
 ctx.save();ctx.beginPath();ctx.rect(v.x,v.y,v.w,v.h);ctx.clip();ctx.font='600 12px sans-serif';
 const headRects:Rect[]=[];
 for(const d of people){
  const [bx,by,bw,bh]=d.bbox,x=v.x+(bx+bw/2)/width*v.w,y=Math.max(v.y+15,v.y+by/height*v.h-3);
  headRects.push({x:x-9,y:y-17,w:18,h:20});
  ctx.save();ctx.shadowColor='rgba(0,0,0,.4)';ctx.shadowBlur=4;ctx.fillStyle='#87c4ff';ctx.strokeStyle='#f4fbff';ctx.lineWidth=1.7;
  ctx.beginPath();ctx.moveTo(x-6,y-11);ctx.lineTo(x+6,y-11);ctx.lineTo(x,y);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
  if(debug){ctx.strokeStyle='rgba(135,196,255,.7)';ctx.lineWidth=1;ctx.strokeRect(v.x+bx/width*v.w,v.y+by/height*v.h,bw/width*v.w,bh/height*v.h);ctx.fillStyle='#e0efff';ctx.fillText(`${Math.round(d.score*100)}%`,v.x+bx/width*v.w+3,Math.max(v.y+12,v.y+by/height*v.h-3));}
 }
 if(debug||calibrating)for(const t of tables){const z=t.roi;if(!z)continue;const x=v.x+z.x*v.w,y=v.y+z.y*v.h,w=z.w*v.w,h=z.h*v.h;ctx.setLineDash([]);ctx.strokeStyle='rgba(0,0,0,.85)';ctx.lineWidth=5;ctx.strokeRect(x,y,w,h);ctx.strokeStyle=t.id===selected?'#fff':colors[t.status];ctx.lineWidth=2.5;ctx.strokeRect(x,y,w,h);}
 for(const badge of layoutTableBadges(tables,v,headRects)){
  const cx=badge.x+badge.w/2,cy=badge.y+badge.h/2;
  if(Math.hypot(cx-badge.anchorX,cy-badge.anchorY)>16){ctx.strokeStyle=badge.color;ctx.globalAlpha=.65;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(badge.anchorX,badge.anchorY);ctx.lineTo(cx,cy);ctx.stroke();ctx.globalAlpha=1;}
  ctx.save();ctx.shadowColor='rgba(0,0,0,.25)';ctx.shadowBlur=7;rounded(ctx,badge);ctx.fillStyle='rgba(12,31,30,.9)';ctx.fill();ctx.shadowBlur=0;ctx.strokeStyle='rgba(255,255,255,.24)';ctx.lineWidth=1;ctx.stroke();
  ctx.beginPath();ctx.arc(badge.x+10,badge.y+12.5,3,0,Math.PI*2);ctx.fillStyle=badge.color;ctx.fill();ctx.fillStyle='#fff';ctx.fillText(badge.text,badge.x+18,badge.y+16.5);ctx.restore();
 }
 ctx.restore();
}
