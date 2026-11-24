import {test} from 'node:test';
import assert from 'node:assert/strict';
import {YoloDetector} from '../src/lib/yolo-detector';
import type {VisionRequest,VisionResponse} from '../src/lib/vision-worker-protocol';
import {peopleDetailSize} from '../src/lib/people-model';

test('detailed inference uses the faster size for 1280px video but retains detail on larger frames',()=>{
 assert.equal(peopleDetailSize(1280),800);assert.equal(peopleDetailSize(1920),960);
});

class FakeWorker{
 static instances:FakeWorker[]=[];
 static initError=false;
 onmessage:((event:{data:VisionResponse})=>void)|null=null;
 onerror:((event:{message:string})=>void)|null=null;
 onmessageerror:(()=>void)|null=null;
 messages:VisionRequest[]=[];
 transfers:Transferable[][]=[];
 terminated=false;
 constructor(public url:URL,public options:WorkerOptions){FakeWorker.instances.push(this);}
 postMessage(message:VisionRequest,transfer:Transferable[]){
  this.messages.push(message);this.transfers.push(transfer);
  if(message.type==='init')queueMicrotask(()=>this.respond(FakeWorker.initError?{id:message.id,error:'Model unavailable'}:{id:message.id,detections:[]}));
 }
 respond(response:VisionResponse){this.onmessage?.({data:response});}
 terminate(){this.terminated=true;}
}

async function withWorker(run:(video:HTMLVideoElement)=>Promise<void>){
 const originals={Worker:globalThis.Worker,createImageBitmap:globalThis.createImageBitmap,window:globalThis.window};
 FakeWorker.instances=[];FakeWorker.initError=false;
 Object.assign(globalThis,{Worker:FakeWorker,window:{location:{origin:'http://localhost:3000'}}});
 try{await run({videoWidth:3840,videoHeight:2160} as HTMLVideoElement);}
 finally{Object.assign(globalThis,originals);}
}

test('slow inference transfers one frame, leaves the event loop free and never queues duplicate frames',async()=>withWorker(async video=>{
 let captures=0;const bitmap={width:3840,height:2160,close(){}} as ImageBitmap;
 globalThis.createImageBitmap=(async()=>{captures++;return bitmap;}) as typeof createImageBitmap;
 const detector=await YoloDetector.load(async()=>new FakeWorker(new URL('http://localhost/worker'),{type:'module'}) as unknown as Worker),worker=FakeWorker.instances[0];
 try{
  assert.equal(worker.options.type,'module');
  const first=detector.detect(video),second=detector.detect(video);assert.equal(first,second);
  let heartbeat=false;await new Promise<void>(resolve=>setTimeout(()=>{heartbeat=true;resolve();},0));
  assert.ok(heartbeat);assert.equal(captures,1);
  const requests=worker.messages.filter(m=>m.type==='detect');assert.equal(requests.length,1);
  assert.deepEqual(worker.transfers.at(-1),[bitmap]);
  const detections=[{class:'dining table',score:.8,bbox:[100,100,300,100] as [number,number,number,number]}];
  worker.respond({id:requests[0].id,detections});assert.deepEqual(await first,detections);
  const next=detector.detect(video);await new Promise<void>(resolve=>setTimeout(resolve,0));assert.equal(captures,2);
  worker.respond({id:worker.messages.at(-1)!.id,detections:[]});await next;
 }finally{detector.dispose();assert.ok(worker.terminated);}
}));

test('disposing during frame capture closes the bitmap without sending it to a dead worker',async()=>withWorker(async video=>{
 let finish!:(bitmap:ImageBitmap)=>void,closed=0;
 globalThis.createImageBitmap=(()=>new Promise<ImageBitmap>(resolve=>{finish=resolve;})) as typeof createImageBitmap;
 const detector=await YoloDetector.load(async()=>new FakeWorker(new URL('http://localhost/worker'),{type:'module'}) as unknown as Worker),worker=FakeWorker.instances[0],pending=detector.detect(video);
 detector.dispose();finish({close(){closed++;}} as ImageBitmap);
 assert.deepEqual(await pending,[]);assert.equal(closed,1);assert.equal(worker.messages.filter(m=>m.type==='detect').length,0);
}));

test('the displayed snapshot belongs to the analyzed frame and old snapshots are released',async()=>withWorker(async video=>{
 let closed=0;globalThis.createImageBitmap=(async()=>({width:1920,height:1080,close(){closed++;}})) as typeof createImageBitmap;
 const detector=await YoloDetector.load(async()=>new FakeWorker(new URL('http://localhost/worker'),{type:'module'}) as unknown as Worker),worker=FakeWorker.instances[0];
 try{
  Object.assign(video,{currentTime:4});const pending=detector.detect(video);await new Promise<void>(r=>setTimeout(r,0));const request=worker.messages.at(-1)!;assert.equal(request.type,'detect');if(request.type!=='detect')throw new Error('Expected frame');
  Object.assign(video,{currentTime:7});worker.respond({id:request.id,detections:[],bitmap:request.bitmap});await pending;
  assert.equal(detector.frameTime,4);assert.equal(detector.frame,request.bitmap);detector.clearFrame();assert.equal(closed,1);assert.equal(detector.frame,null);
 }finally{detector.dispose();}
}));

test('worker failure rejects in-flight work and terminates instead of leaving analysis hanging',async()=>withWorker(async video=>{
 globalThis.createImageBitmap=(async()=>({width:3840,height:2160,close(){}})) as typeof createImageBitmap;
 const detector=await YoloDetector.load(async()=>new FakeWorker(new URL('http://localhost/worker'),{type:'module'}) as unknown as Worker),worker=FakeWorker.instances[0];const pending=detector.detect(video);
 const rejected=assert.rejects(pending,/Worker crashed/);await new Promise<void>(resolve=>setTimeout(resolve,0));
 worker.onerror?.({message:'Worker crashed'});await rejected;assert.ok(worker.terminated);
}));

test('model initialization errors terminate the worker and remain retryable',async()=>withWorker(async()=>{
 FakeWorker.initError=true;await assert.rejects(YoloDetector.load(async()=>new FakeWorker(new URL('http://localhost/worker'),{type:'module'}) as unknown as Worker),/Model unavailable/);assert.ok(FakeWorker.instances[0].terminated);
 FakeWorker.initError=false;const detector=await YoloDetector.load(async()=>new FakeWorker(new URL('http://localhost/worker'),{type:'module'}) as unknown as Worker);detector.dispose();
}));
