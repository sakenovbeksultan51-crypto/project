import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decodeYolo,nms} from '../src/lib/yolo-output';
test('YOLO decoding maps letterboxed crop coordinates back to the original frame',()=>{
 const data=new Float32Array(84);data[0]=320;data[1]=320;data[2]=100;data[3]=200;data[4]=0.8;
 const result=decodeYolo(data,84,1,2,0,0,50,20,1000,1000,0.3);assert.equal(result.length,1);assert.deepEqual(result[0].bbox,[185,130,50,100]);
});
test('overlapping tiled detections merge once; low confidence and unrelated classes are ignored',()=>{
 assert.equal(nms([{class:'person',score:0.9,bbox:[0,0,100,100]},{class:'person',score:0.8,bbox:[1,1,100,100]}]).length,1);
 const data=new Float32Array(84);data[0]=320;data[1]=320;data[2]=100;data[3]=200;data[4]=0.1;assert.equal(decodeYolo(data,84,1,1,0,0,0,0,640,640,0.3).length,0);
 data[6]=0.9;assert.equal(decodeYolo(data,84,1,1,0,0,0,0,640,640,0.3).length,0);
});
test('close seated people keep one body each even when tiles return high-score heads',async()=>{
 const {mergePersonTiles}=await import('../src/lib/yolo-output');
 const full=[{class:'person',score:.86,bbox:[200,120,210,300] as [number,number,number,number]},{class:'person',score:.8,bbox:[480,160,160,260] as [number,number,number,number]}];
 const tiles=[{class:'person',score:.93,bbox:[265,120,100,105] as [number,number,number,number]},{class:'person',score:.7,bbox:[205,125,205,290] as [number,number,number,number]},{class:'person',score:.75,bbox:[505,160,90,100] as [number,number,number,number]}];
 const merged=mergePersonTiles(full,tiles,700,450);assert.equal(merged.length,2);assert.ok(merged.every(d=>d.bbox[3]>200));
});
test('small distant people supplement the full frame while adjacent people remain separate',async()=>{
 const {mergePersonTiles}=await import('../src/lib/yolo-output');const full=[{class:'person',score:.9,bbox:[200,100,160,300] as [number,number,number,number]}];
 const tiles=[{class:'person',score:.7,bbox:[400,100,30,65] as [number,number,number,number]},{class:'person',score:.72,bbox:[445,105,30,60] as [number,number,number,number]}];assert.equal(mergePersonTiles(full,tiles,700,450).length,3);
});
test('tile detections include distant tables without duplicate full-frame boxes',async()=>{
 const {mergePersonTiles}=await import('../src/lib/yolo-output');
 const full=[{class:'dining table',score:.8,bbox:[20,30,100,45] as [number,number,number,number]}];
 const tiles=[{class:'dining table',score:.9,bbox:[21,31,100,45] as [number,number,number,number]},{class:'dining table',score:.65,bbox:[400,40,60,30] as [number,number,number,number]}];
 const result=mergePersonTiles(full,tiles,800,500).filter(d=>d.class==='dining table');assert.equal(result.length,2);assert.ok(result.some(d=>d.bbox[0]===400));
});


test('specialized single-class table model decodes as tables rather than people',()=>{
 const data=new Float32Array([320,320,120,35,.85]);const result=decodeYolo(data,5,1,1,0,0,0,0,640,640,.4,{0:'dining table'});
 assert.equal(result.length,1);assert.equal(result[0].class,'dining table');assert.deepEqual(result[0].bbox,[260,302.5,120,35]);
 assert.equal(decodeYolo(data,5,1,1,0,0,0,0,640,640,.9,{0:'dining table'}).length,0);
});
