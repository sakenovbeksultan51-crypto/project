import {YoloInference} from '../lib/yolo-inference';
import type {VisionRequest,VisionResponse} from '../lib/vision-worker-protocol';

const scope=globalThis as unknown as {
 onmessage:((event:MessageEvent<VisionRequest>)=>void)|null;
 postMessage:(message:VisionResponse)=>void;
};
let model:YoloInference|null=null;
scope.onmessage=async({data})=>{
 try{
  if(data.type==='init'){
   model=await YoloInference.load(data.origin);
   scope.postMessage({id:data.id,detections:[]});
  }else{
   if(!model)throw new Error('Detector is not initialized');
   const detections=await model.detect(data.bitmap,data.options);
   scope.postMessage({id:data.id,detections});
  }
 }catch(error){
  scope.postMessage({id:data.id,error:error instanceof Error?error.message:String(error)});
 }finally{
  if(data.type==='detect')data.bitmap.close();
 }
};
