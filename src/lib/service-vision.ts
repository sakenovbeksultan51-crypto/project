import type {Detection} from './vision';

export const SCENE_LABELS:Readonly<Record<number,string>>={0:'person',24:'backpack',26:'handbag',39:'bottle',40:'wine glass',41:'cup',42:'fork',43:'knife',44:'spoon',45:'bowl',60:'dining table',63:'laptop',67:'cell phone',73:'book'};
type Transform={scale:number;px:number;py:number};
function sample(pixels:Uint8ClampedArray,x:number,y:number){
 const i=(Math.max(0,Math.min(639,Math.round(y)))*640+Math.max(0,Math.min(639,Math.round(x))))*4;
 const r=pixels[i],g=pixels[i+1],b=pixels[i+2];return {light:(r+g+b)/3,saturation:(Math.max(r,g,b)-Math.min(r,g,b))/Math.max(1,r,g,b)};
}
/** Scene-specific cue supplied by the user; clothing alone is not a general staff classifier. */
export function staffInBlack(person:Detection,pixels:Uint8ClampedArray,t:Transform):boolean{
 const [x,y,w,h]=person.bbox;if(person.class!=='person'||h/w<2.05)return false;
 let dark=0,total=0;
 for(let row=0;row<10;row++)for(let col=0;col<8;col++){
  const p=sample(pixels,(x+w*(.25+.5*col/7))*t.scale+t.px,(y+h*(.23+.35*row/9))*t.scale+t.py);
  if(p.light<65&&p.saturation<.48)dark++;total++;
 }
 return dark/total>=.65;
}

/** Estimate whether a white tabletop is visibly cleared, with explicit occlusion handling. */
export function tabletopSurface(table:Detection,people:Detection[],objects:Detection[],pixels:Uint8ClampedArray,t:Transform):NonNullable<Detection['surface']>{
 const [x,y,w,h]=table.bbox,cx=x+w/2,cy=y+h*.42;
 const overlaps=people.some(p=>{const [px,py,pw,ph]=p.bbox;return (p.role==='staff'||py+ph*.55>=y-h*.2)&&Math.max(0,Math.min(x+w,px+pw)-Math.max(x,px))*Math.max(0,Math.min(y+h,py+ph)-Math.max(y,py))/(w*h)>.18;});
 const items=objects.filter(o=>{const [ox,oy,ow,oh]=o.bbox;return ox+ow/2>=x&&ox+ow/2<=x+w&&oy+oh*.85>=y-h*.2&&oy+oh*.85<=y+h;}).length;
 const samples:{light:number;saturation:number}[]=[];
 for(let row=0;row<16;row++)for(let col=0;col<24;col++){
  const nx=(col/23-.5)*2,ny=(row/15-.5)*2;if(nx*nx+ny*ny>1)continue;
  // Stay inside the tabletop: the rim, legs and a coat on the chair are not items on it.
  samples.push(sample(pixels,(cx+nx*w*.38)*t.scale+t.px,(cy+ny*h*.28)*t.scale+t.py));
 }
 const median=[...samples].sort((a,b)=>a.light-b.light)[Math.floor(samples.length/2)]?.light||0;
 const dark=samples.filter(p=>p.light<Math.min(170,median*.75)||p.saturation>.3).length/Math.max(1,samples.length);
 const visible=!overlaps&&median>130;
 return {clear:visible&&items===0&&dark<.025,visible,objects:items,darkFraction:dark};
}
