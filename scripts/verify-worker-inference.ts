/** Real WASM models in a background thread, using prepared frames from the supplied video.
 * Canvas rasterization is replaced with the matching saved RGB input; browser drawing
 * remains a separate manual check. Run after ml/prepare_restaurant_probes.py.
 */
import {Worker,isMainThread,parentPort} from 'node:worker_threads';
import assert from 'node:assert/strict';

if(isMainThread){
 const worker=new Worker(new URL(import.meta.url),{execArgv:['--import','tsx']});
 let ticks=0,last=performance.now(),maxDelay=0;
 const heartbeat=setInterval(()=>{const now=performance.now();maxDelay=Math.max(maxDelay,now-last);last=now;ticks++;},10);
 try{
  const result=await new Promise<unknown>((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);worker.once('exit',code=>{if(code!==0)reject(new Error(`Worker exited with ${code}`));});});
  assert.ok(ticks>=5,'Page-equivalent event loop must continue while both models run');
  console.log(JSON.stringify({result,heartbeatTicks:ticks,maxHeartbeatIntervalMs:Math.round(maxDelay)},null,2));
 }finally{clearInterval(heartbeat);await worker.terminate();}
}else{
 const fs=await import('node:fs'),path=await import('node:path'),{pathToFileURL}=await import('node:url');
 const {registerHooks}=await import('node:module');
 registerHooks({resolve(specifier,context,next){return next(specifier==='tableflow:ort-runtime'?'onnxruntime-web':specifier,context);}});
 const ort=await import('onnxruntime-web');
 ort.env.wasm.numThreads=1;ort.env.wasm.wasmPaths=pathToFileURL(path.resolve('node_modules/onnxruntime-web/dist')+'/').href;
 const refs=JSON.parse(fs.readFileSync('ml/work/restaurant/references.json','utf8'));
 let rgba:Uint8ClampedArray,reads=0;
 class PreparedCanvas{
  constructor(width:number,height:number){assert.equal(width,640);assert.equal(height,640);}
  getContext(){return {fillStyle:'',fillRect(){},drawImage(){},getImageData(){reads++;return {data:rgba};}};}
 }
 Object.assign(globalThis,{OffscreenCanvas:PreparedCanvas});
 const {YoloInference}=await import('../src/lib/yolo-inference');
 const sessions=await Promise.all(['person.onnx','restaurant-tables.onnx'].map(file=>ort.InferenceSession.create(new Uint8Array(fs.readFileSync('public/models/yolo/'+file)),{executionProviders:['wasm']})));
 try{
  const model=new YoloInference(sessions[0],sessions[1],ort),frames=[];
  for(const ref of refs){
   const bytes=fs.readFileSync(`ml/work/restaurant/ref_${ref.second}.f32`),input=new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
   rgba=new Uint8ClampedArray(640*640*4);
   for(let i=0;i<640*640;i++){rgba[i*4]=Math.round(input[i]*255);rgba[i*4+1]=Math.round(input[640*640+i]*255);rgba[i*4+2]=Math.round(input[2*640*640+i]*255);rgba[i*4+3]=255;}
   const detections=await model.detect({width:ref.width,height:ref.height} as ImageBitmap,{frontTables:true,detail:false,tableDetail:true,max:100,threshold:.3});
   const tables=detections.filter(d=>d.tableModel==='restaurant');assert.equal(tables.length,4);frames.push({second:ref.second,tables:tables.length});
  }
  assert.equal(reads,refs.length,'Pixel preparation must happen once per frame, shared by the two models');
  parentPort!.postMessage({frames,pixelReadbacks:reads,modelsPerFrame:2});
 }finally{await Promise.all(sessions.map(session=>session.release()));}
}
