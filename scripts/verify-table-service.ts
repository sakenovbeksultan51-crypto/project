/** Replay original-video frame probes through real models and the service state machine.
 * Requires ml/prepare_service_probes.py. Pixel input is the saved letterboxed frame.
 */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {registerHooks} from 'node:module';
import assert from 'node:assert/strict';
import * as ort from 'onnxruntime-web';
import {initialState} from '../src/lib/engine';
import {DynamicTableTracker,SeatingTracker,sameTableZone,tableZones} from '../src/lib/vision';
import {TableServiceTracker} from '../src/lib/table-service';
import {applyVideoFrame} from '../src/lib/video-frame';

registerHooks({resolve(specifier,context,next){return next(specifier==='tableflow:ort-runtime'?'onnxruntime-web':specifier,context);}});
ort.env.wasm.numThreads=1;ort.env.wasm.wasmPaths=pathToFileURL(path.resolve('node_modules/onnxruntime-web/dist')+'/').href;
const refs=JSON.parse(fs.readFileSync('ml/work/service-probes/references.json','utf8'));
let rgba:Uint8ClampedArray;
class PreparedCanvas{getContext(){return {fillStyle:'',fillRect(){},drawImage(){},getImageData(){return {data:rgba};}};}}
Object.assign(globalThis,{OffscreenCanvas:PreparedCanvas});
const {YoloInference}=await import('../src/lib/yolo-inference');
const sessions=await Promise.all(['person.onnx','restaurant-tables.onnx'].map(file=>ort.InferenceSession.create(new Uint8Array(fs.readFileSync('public/models/yolo/'+file)),{executionProviders:['wasm']})));
try{
 const model=new YoloInference(sessions[0],sessions[1],ort),discovery=new DynamicTableTracker(),seating=new SeatingTracker(),service=new TableServiceTracker();discovery.limit=4;discovery.excludedIds.add(1);
 let state=initialState('live',0),frontId=0,whiteState=initialState('live',0);const frames=[],whiteFrames=[];
 const whiteService=new TableServiceTracker();
 for(const ref of refs){
  const bytes=fs.readFileSync(`ml/work/service-probes/${ref.second}.f32`),input=new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));rgba=new Uint8ClampedArray(640*640*4);
  for(let i=0;i<640*640;i++){rgba[i*4]=Math.round(input[i]*255);rgba[i*4+1]=Math.round(input[640*640+i]*255);rgba[i*4+2]=Math.round(input[2*640*640+i]*255);rgba[i*4+3]=255;}
  const found=await model.detect({width:ref.width,height:ref.height} as ImageBitmap,{frontTables:true,detail:false,tableDetail:true,max:100,threshold:.3});
  state=discovery.update(state,found,ref.width,ref.height);
  if(!frontId)frontId=[...state.tables].filter(t=>t.roi).sort((a,b)=>(b.roi!.y+b.roi!.h/2)-(a.roi!.y+a.roi!.h/2))[0]?.id||0;
  const people=found.filter(d=>d.class==='person'&&d.score>=.45),at=ref.second*1000;
  const evidence=service.update(state,found,ref.width,ref.height,at,seating.update(people,ref.width,ref.height,state.tables,at));
  state=applyVideoFrame(state,people,ref.width,ref.height,at,evidence);
  const table=state.tables.find(t=>t.id===frontId)!;
  if(ref.second>=90){
   whiteState={...whiteState,tables:whiteState.tables.map(t=>t.id===frontId?{...t,roi:table.roi,status:ref.second===90?'dirty':t.status}:t)};
   const empty={confirmed:new Map<number,number>(),present:new Map<number,number>()};
   whiteState=applyVideoFrame(whiteState,[],ref.width,ref.height,at,whiteService.update(whiteState,found,ref.width,ref.height,at,empty));
   whiteFrames.push({second:ref.second,status:whiteState.tables.find(t=>t.id===frontId)!.status});
  }
  const surface=found.find(d=>d.surface&&table.roi&&tableZones([d],ref.width,ref.height).some(z=>sameTableZone(z,table.roi!)))?.surface;
  frames.push({second:ref.second,frontId,status:table.status,guests:evidence.present.get(frontId)||0,staff:people.filter(p=>p.role==='staff').map(p=>p.bbox),surface});
 }
 const report={frontId,frames,whiteWithoutStaff: whiteFrames,logs:state.logs.filter(l=>l.tableId===frontId)};
 fs.writeFileSync('ml/restaurant-service-report.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(frames.map(({second,status,guests,staff,surface})=>({second,status,guests,staff:staff.length,surface})),null,2));
 assert.equal(frames.find(f=>f.second===64)?.status,'occupied');
 assert.equal(frames.find(f=>f.second===80)?.status,'dirty');
 assert.equal(frames.find(f=>f.second===88)?.status,'cleaning');
 assert.equal(frames.find(f=>f.second===90)?.status,'free');
 assert.equal(frames.find(f=>f.second===98)?.status,'free');
 assert.equal(whiteFrames.find(f=>f.second===92)?.status,'free');
}finally{await Promise.all(sessions.map(session=>session.release()));}
