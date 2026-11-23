import type * as Ort from 'onnxruntime-web';
import * as ort from 'tableflow:ort-runtime';
import type {Detection} from './vision';
import type {VisionOptions} from './vision-worker-protocol';
import {RESTAURANT_MODEL} from './restaurant-model';
import {PEOPLE_MODEL} from './people-model';
import {decodeYolo,mergePersonTiles,nms} from './yolo-output';
import {SCENE_LABELS,staffInBlack,tabletopSurface} from './service-vision';

type Crop={x:number;y:number;w:number;h:number};
/** Worker-only implementation: no DOM, full-resolution canvas copy or page-thread WASM. */
export class YoloInference{
 private canvas=new OffscreenCanvas(640,640);
 private context=this.canvas.getContext('2d',{willReadFrequently:true})!;
 private fullInput=new Float32Array(3*640*640);
 private tileInput=new Float32Array(3*640*640);
 private framePixels!:Uint8ClampedArray;
 constructor(private people:Ort.InferenceSession,private tables:Ort.InferenceSession,private runtime:typeof Ort){}

 static async load(origin:string){
  // The runtime is an external public module, without page-only HMR imports.
  ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;
  ort.env.wasm.wasmPaths=new URL('/ort/',origin).href;
  const options:Ort.InferenceSession.SessionOptions={executionProviders:['wasm'],graphOptimizationLevel:'all'};
  const people=await ort.InferenceSession.create(new URL(PEOPLE_MODEL.url,origin).href,options);
  try{return new YoloInference(people,await ort.InferenceSession.create(new URL(RESTAURANT_MODEL.url,origin).href,options),ort);}
  catch(error){await people.release();throw error;}
 }

 private prepare(bitmap:ImageBitmap,crop:Crop,input:Float32Array){
  const scale=Math.min(640/crop.w,640/crop.h),dw=Math.round(crop.w*scale),dh=Math.round(crop.h*scale),px=Math.floor((640-dw)/2),py=Math.floor((640-dh)/2);
  const ctx=this.context;ctx.fillStyle='rgb(114,114,114)';ctx.fillRect(0,0,640,640);
  ctx.drawImage(bitmap,crop.x,crop.y,crop.w,crop.h,px,py,dw,dh);
  const pixels=ctx.getImageData(0,0,640,640).data;
  if(input===this.fullInput)this.framePixels=pixels;
  for(let i=0;i<640*640;i++){input[i]=pixels[i*4]/255;input[640*640+i]=pixels[i*4+1]/255;input[2*640*640+i]=pixels[i*4+2]/255;}
  return {scale,px,py};
 }

 private async infer(session:Ort.InferenceSession,input:Float32Array,crop:Crop,transform:{scale:number;px:number;py:number},width:number,height:number,threshold:number,labels?:Readonly<Record<number,string>>){
  const tensor=new this.runtime.Tensor('float32',input,[1,3,640,640]);
  try{
   const result=await session.run({[session.inputNames[0]]:tensor});
   try{
    const output=result[session.outputNames[0]];
    return decodeYolo(output.data as Float32Array,output.dims[1],output.dims[2],transform.scale,transform.px,transform.py,crop.x,crop.y,width,height,threshold,labels);
   }finally{for(const output of Object.values(result))output.dispose();}
  }finally{tensor.dispose();}
 }

 async detect(bitmap:ImageBitmap,options:VisionOptions):Promise<Detection[]>{
  const width=bitmap.width,height=bitmap.height;if(!width||!height)return [];
  const fullCrop={x:0,y:0,w:width,h:height},transform=this.prepare(bitmap,fullCrop,this.fullInput);
  const full=(await this.infer(this.people,this.fullInput,fullCrop,transform,width,height,options.threshold,SCENE_LABELS)).map(d=>options.frontTables&&staffInBlack(d,this.framePixels,transform)?{...d,role:'staff' as const}:d),tiles:Detection[]=[];
  if(options.detail||!options.frontTables&&options.tableDetail){
   for(const y of [0,height*.4])for(const x of [0,width*.4]){
    const crop={x,y,w:width*.6,h:height*.6},tileTransform=this.prepare(bitmap,crop,this.tileInput);
    const decoded=(await this.infer(this.people,this.tileInput,crop,tileTransform,width,height,options.threshold,SCENE_LABELS)).map(d=>options.frontTables&&staffInBlack(d,this.framePixels,transform)?{...d,role:'staff' as const}:d);
    tiles.push(...decoded.filter(d=>{
     if(d.class==='person'&&d.score<Math.max(options.threshold,.5)||d.class==='dining table'&&d.score<.3)return false;
     const [bx,by,w,h]=d.bbox,margin=4;
     return !(crop.x>0&&bx<=crop.x+margin||crop.y>0&&by<=crop.y+margin||crop.x+crop.w<width-1&&bx+w>=crop.x+crop.w-margin||crop.y+crop.h<height-1&&by+h>=crop.y+crop.h-margin);
    }));
   }
  }
  const found=mergePersonTiles(full,tiles.filter(d=>options.detail||d.class==='dining table'),width,height,options.max);
  // Both models use exactly the same prepared frame, without a second pixel readback.
  const tables=options.frontTables||options.tableDetail?await this.infer(this.tables,this.fullInput,fullCrop,transform,width,height,RESTAURANT_MODEL.confidence,{60:'dining table'}):[];
  const people=found.filter(d=>d.class==='person'),objects=found.filter(d=>d.class!=='person'&&d.class!=='dining table');
  const specialized=tables.map(d=>({...d,tableModel:'restaurant' as const,...(options.frontTables?{surface:tabletopSurface(d,people,objects,this.framePixels,transform)}:{})}));
  const candidates=options.frontTables?specialized:[...specialized,...found.filter(d=>d.class==='dining table')];
  return [...people,...objects,...nms(candidates,.4,options.frontTables?RESTAURANT_MODEL.limit:12)];
 }
}
