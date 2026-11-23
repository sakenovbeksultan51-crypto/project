import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initialState,changeStatus,validateState} from '../src/lib/engine';
import {tableZones,Detection} from '../src/lib/vision';
import {applyVideoFrame} from '../src/lib/video-frame';
test('video frames update occupancy, completed visits and cleaning workflow without manual seating',()=>{
 let state=initialState('live',1000);state.tables[0].roi={x:0,y:0,w:0.8,h:0.8};
 const detected:Detection[]=[{class:'person',score:0.95,bbox:[20,20,20,40]}];
 for(let i=0;i<8;i++)state=applyVideoFrame(state,detected,100,100,2000+i*1000);
 assert.equal(state.tables[0].status,'occupied');assert.equal(state.tables[0].source,'camera');assert.equal(state.tables[0].guests,1);
 // One clear frame must not register a visit end.
 state=applyVideoFrame(state,[],100,100,10000);assert.equal(state.visits.length,0);
 for(let i=0;i<10;i++)state=applyVideoFrame(state,[],100,100,11000+i*1000);
 assert.equal(state.tables[0].status,'dirty');assert.equal(state.visits.length,1);assert.equal(state.tables[1].status,'free');
 assert.ok(state.logs.some(e=>e.source==='camera'&&e.message.includes('Нужна уборка')));
 state=changeStatus(state,1,'cleaning',22000,'manual');state=applyVideoFrame(state,detected,100,100,23000);assert.equal(state.tables[0].status,'cleaning');
 state=changeStatus(state,1,'free',24000,'manual');assert.ok(validateState(state));assert.equal(state.tables[0].status,'free');
});
test('automatic table proposals use detected tables only and stay inside video bounds',()=>{
 const found:Detection[]=[{class:'dining table',score:0.8,bbox:[-5,70,80,40]},{class:'dining table',score:0.8,bbox:[-5,70,80,40]},{class:'person',score:0.99,bbox:[20,20,20,40]}];
 const zones=tableZones(found,100,100);assert.equal(zones.length,1);assert.ok(zones.every(z=>z.x>=0&&z.y>=0&&z.x+z.w<=1&&z.y+z.h<=1));assert.equal(tableZones([found[2]],100,100).length,0);
});
test('new clip clears old camera beliefs without inventing completed visits',async()=>{
 const {resetVideoZones}=await import('../src/lib/video-frame');let s=initialState('live',0);s=changeStatus(s,1,'occupied',1000,'camera');s.tables[0].roi={x:0,y:0,w:0.5,h:0.5};
 const next=resetVideoZones(s,2000);assert.equal(next.tables[0].status,'free');assert.equal(next.tables[0].roi,null);assert.equal(next.visits.length,0);assert.ok(validateState(next));
});
