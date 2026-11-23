import * as ort from 'onnxruntime-web';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {tableZones,DynamicTableTracker} from '../src/lib/vision';
import {initialState} from '../src/lib/engine';
import {RESTAURANT_MODEL} from '../src/lib/restaurant-model';
import {decodeYolo,nms} from '../src/lib/yolo-output';
ort.env.wasm.numThreads=1;ort.env.wasm.wasmPaths=pathToFileURL(path.resolve('node_modules/onnxruntime-web/dist')+'/').href;
const refs=JSON.parse(fs.readFileSync('ml/work/restaurant/references.json','utf8'));
const threshold=RESTAURANT_MODEL.confidence;assert.equal(threshold,JSON.parse(fs.readFileSync('ml/restaurant-report.json','utf8')).threshold);
const annotation=JSON.parse(fs.readFileSync('ml/restaurant-annotations.json','utf8'));
function iou(a:number[],b:number[]){const inter=Math.max(0,Math.min(a[2],b[2])-Math.max(a[0],b[0]))*Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1]));return inter/Math.max(1,(a[2]-a[0])*(a[3]-a[1])+(b[2]-b[0])*(b[3]-b[1])-inter);}
const results:Record<string,{tp:number;fp:number;fn:number;frames:unknown[]}>= {};
for(const [name,file] of [['baseline','person.onnx'],['trained','restaurant-tables.onnx']]){
 const session=await ort.InferenceSession.create(new Uint8Array(fs.readFileSync('public/models/yolo/'+file)),{executionProviders:['wasm']});let tp=0,fp=0,fn=0;const frames=[];
 for(const ref of refs){
  const bytes=fs.readFileSync(`ml/work/restaurant/ref_${ref.second}.f32`);const pixels=new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));const input=new ort.Tensor('float32',pixels,[1,3,640,640]);const result=await session.run({[session.inputNames[0]]:input});const output=result[session.outputNames[0]];
  const detections=nms(decodeYolo(output.data as Float32Array,output.dims[1],output.dims[2],ref.scale,ref.px,ref.py,0,0,ref.width,ref.height,threshold,{60:'dining table'}),.4,4);
  if(name==='trained'){const marked=detections.map(d=>({...d,tableModel:'restaurant' as const}));assert.equal(tableZones(marked,ref.width,ref.height).length,4,'The seating pipeline must retain all four calibrated detections');const tracker=new DynamicTableTracker();tracker.limit=4;const state=tracker.update(initialState('live'),marked,ref.width,ref.height);assert.equal(state.tables.filter(t=>t.roi).length,4);}
  const gt=(annotation.boxes[String(ref.second)] as number[][]).map(b=>b.map((v,i)=>v*(i%2===0?ref.width/annotation.size[0]:ref.height/annotation.size[1]))),used=new Set<number>();let hits=0;
  for(const d of detections){const [x,y,w,h]=d.bbox;const box=[x,y,x+w,y+h];const choices=gt.map((b,i)=>({i,overlap:iou(box,b)})).filter(v=>!used.has(v.i)&&v.overlap>=.5).sort((a,b)=>b.overlap-a.overlap);if(choices[0]){used.add(choices[0].i);hits++;}}
  tp+=hits;fp+=detections.length-hits;fn+=gt.length-hits;frames.push({second:ref.second,detected:detections.length,matched:hits,boxes:detections.map(d=>d.bbox)});input.dispose();for(const item of Object.values(result))item.dispose();
 }
 results[name]={tp,fp,fn,frames};await session.release();
}
console.log(JSON.stringify(results,null,2));
fs.writeFileSync('ml/restaurant-wasm-report.json',JSON.stringify({...results,input:{frames:refs,confidence:threshold,matching_iou:.5}},null,2));
assert.ok(results.trained.frames.every((f:any)=>f.matched>=3),'Every held-out frame must have at least three correctly separated tables');
assert.ok(results.trained.tp>=9,'Must detect at least three focus tables per frame on average');assert.ok(results.trained.tp>results.baseline.tp,'Must improve focus-table recall');assert.ok(results.trained.fp<=results.baseline.fp,'Must not increase spurious focus boxes');
