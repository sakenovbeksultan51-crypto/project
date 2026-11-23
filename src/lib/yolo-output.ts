import {Detection} from './vision';
export function nms(found:Detection[],iou=0.45,limit=100):Detection[]{
 const out:Detection[]=[];
 for(const d of [...found].sort((a,b)=>b.score-a.score)){
  if(out.some(p=>{if(p.class!==d.class)return false;const [x,y,w,h]=d.bbox,[px,py,pw,ph]=p.bbox;const overlap=Math.max(0,Math.min(x+w,px+pw)-Math.max(x,px))*Math.max(0,Math.min(y+h,py+ph)-Math.max(y,py));return overlap/(w*h+pw*ph-overlap)>iou;}))continue;
  out.push(d);if(out.length>=limit)break;
 }return out;
}
export function decodeYolo(data:Float32Array,channels:number,count:number,scale:number,padX:number,padY:number,offsetX:number,offsetY:number,width:number,height:number,threshold:number,labels?:Readonly<Record<number,string>>):Detection[]{
 const found:Detection[]=[];
 for(let i=0;i<count;i++){
  let cls=0,score=data[4*count+i];for(let k=5;k<channels;k++){const p=data[k*count+i];if(p>score){score=p;cls=k-4;}}
  if(labels?(!labels[cls]||score<threshold):(score<(cls===60?0.3:threshold)||(cls!==0&&cls!==60)))continue;
  const cx=data[i],cy=data[count+i],w=data[2*count+i],h=data[3*count+i];
  const left=Math.max(0,(cx-w/2-padX)/scale)+offsetX,top=Math.max(0,(cy-h/2-padY)/scale)+offsetY;
  const right=Math.min(width,(cx+w/2-padX)/scale+offsetX),bottom=Math.min(height,(cy+h/2-padY)/scale+offsetY);
  if(right>left&&bottom>top)found.push({bbox:[left,top,right-left,bottom-top],class:labels?labels[cls]:cls===0?'person':'dining table',score});
 }return nms(found);
}

/** Full-frame boxes anchor nearby people; tiles only supplement small, complete figures. */
export function mergePersonTiles(full:Detection[],tiles:Detection[],width:number,height:number,limit=100):Detection[]{
 const anchors=nms(full,0.45,limit),extra:Detection[]=[];
 for(const d of tiles){
  if(d.class==='dining table'){if(d.score>=0.3)extra.push(d);continue;}
  if(d.class!=='person')continue;
  const [x,y,w,h]=d.bbox;
  if(h>height*0.45||w>width*0.3)continue;
  const duplicate=anchors.some(a=>{
   if(a.class!=='person')return false;
   const [ax,ay,aw,ah]=a.bbox;
   const intersection=Math.max(0,Math.min(x+w,ax+aw)-Math.max(x,ax))*Math.max(0,Math.min(y+h,ay+ah)-Math.max(y,ay));
   const contained=intersection/(w*h)>0.8;
   const sameColumn=Math.abs(x+w/2-ax-aw/2)<aw*0.3;
   return contained&&sameColumn;
  });
  if(!duplicate)extra.push(d);
 }
 return nms([...anchors,...extra],0.45,limit);
}
