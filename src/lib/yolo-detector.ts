import type {Detection} from './vision';
import type {VisionOptions,VisionRequest,VisionResponse} from './vision-worker-protocol';

/** The page only captures a transferable frame; all pixels and inference stay in a worker. */
export class YoloDetector{
 public detail=false;
 public tableDetail=false;
 public frontTables=false;
 public frame:ImageBitmap|null=null;
 public frameTime=0;
 clearFrame(){this.frame?.close();this.frame=null;}
 private closed=false;
 private sequence=0;
 private inFlight:Promise<Detection[]>|null=null;
 private pending=new Map<number,{resolve:(value:Detection[])=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>;frameTime?:number}>();

 private constructor(private worker:Worker){
  worker.onmessage=({data}:MessageEvent<VisionResponse>)=>{
   const request=this.pending.get(data.id);if(!request){data.bitmap?.close();return;}
   clearTimeout(request.timer);this.pending.delete(data.id);
   if(data.error){data.bitmap?.close();request.reject(new Error(data.error));}else{if(data.bitmap){this.frame?.close();this.frame=data.bitmap;this.frameTime=request.frameTime||0;}request.resolve(data.detections||[]);}
  };
  worker.onerror=event=>{event.preventDefault?.();this.close(new Error(event.message||'Video analysis worker failed'));};
  worker.onmessageerror=()=>{this.close(new Error('Video analysis message could not be read'));};
 }

 static async load(createWorker?:()=>Promise<Worker>){
  const worker=createWorker?await createWorker():new (await import('../workers/vision.worker?worker')).default({name:'tableflow-vision'});
  const detector=new YoloDetector(worker);
  try{await detector.request({type:'init',origin:window.location.origin});return detector;}
  catch(error){detector.dispose();throw error;}
 }

 private request(message:Omit<Extract<VisionRequest,{type:'init'}>,'id'>|Omit<Extract<VisionRequest,{type:'detect'}>,'id'>,transfer:Transferable[]=[],frameTime?:number):Promise<Detection[]>{
  if(this.closed)return Promise.reject(new Error('Video detector is closed'));
  const id=++this.sequence;
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>this.close(new Error('Video analysis timed out')),message.type==='init'?55000:30000);
   this.pending.set(id,{resolve,reject,timer,frameTime});
   try{this.worker.postMessage({...message,id},transfer);}
   catch(error){clearTimeout(timer);this.pending.delete(id);reject(error);}
  });
 }

 detect(video:HTMLVideoElement,max=100,threshold=.45):Promise<Detection[]>{
  if(this.closed)return Promise.resolve([]);
  // Never capture or queue another 4K frame while the worker is still busy.
  if(this.inFlight)return this.inFlight;
  if(!video.videoWidth||!video.videoHeight)return Promise.resolve([]);
  const options:VisionOptions={detail:this.detail,tableDetail:this.tableDetail,frontTables:this.frontTables,max,threshold};
  this.inFlight=this.analyze(video,options).finally(()=>{this.inFlight=null;});
  return this.inFlight;
 }

 async idle(){
  if(this.inFlight)await this.inFlight;
  if(this.closed)throw new Error('Video detector is closed');
 }

 private async analyze(video:HTMLVideoElement,options:VisionOptions){
  const frameTime=video.currentTime,bitmap=await createImageBitmap(video);
  if(this.closed){bitmap.close();return [];}
  try{return await this.request({type:'detect',bitmap,options},[bitmap],frameTime);}
  catch(error){bitmap.close();throw error;}
 }

 private close(error:Error){
  if(this.closed)return;this.closed=true;this.worker.terminate();this.clearFrame();
  for(const request of this.pending.values()){clearTimeout(request.timer);request.reject(error);}
  this.pending.clear();
 }
 dispose(){this.close(new Error('Video detector disposed'));}
}
