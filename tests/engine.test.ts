import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initialState,hmmStep,observe,changeStatus,runAgent,serve,recommend,seatGuest,validateState} from '../src/lib/engine';
test('HMM normalizes likelihood and suppresses a single occlusion',()=>{
  const belief=hmmStep([0,1,0],'clear');assert.ok(Math.abs(belief.reduce((a,b)=>a+b)-1)<1e-9);
  let s=changeStatus(initialState('live',0),1,'occupied',0,'manual');s=observe(s,1,'clear',1000);assert.equal(s.tables[0].status,'occupied');
  for(let i=0;i<10;i++)s=observe(s,1,'clear',2000+i*1000);assert.equal(s.tables[0].status,'dirty');
  for(let i=0;i<20;i++)s=observe(s,1,'clear',20000+i*1000);assert.equal(s.tables[0].status,'dirty');
});
test('sustained person observation occupies free table; cleanup is explicitly confirmed',()=>{
 let s=initialState('live',0);for(let i=0;i<8;i++)s=observe(s,1,'person',i*1000);assert.equal(s.tables[0].status,'occupied');
 s=changeStatus(s,1,'cleaning',10000,'manual');assert.equal(observe(s,1,'person',11000),s);
 s=changeStatus(s,1,'free',12000,'manual');assert.deepEqual(s.tables[0].belief,[1,0,0]);
});
test('agent emits one alert per visit and service acknowledgement prevents repetition',()=>{
 let s=changeStatus(initialState('live',0),1,'occupied',0,'manual');s=runAgent(s,6*60000);assert.equal(s.alerts.length,1);s=runAgent(s,7*60000);assert.equal(s.alerts.length,1);
 s=serve(s,1,8*60000);s=runAgent(s,10*60000);assert.equal(s.alerts.filter(a=>!a.done).length,0);
});
test('queue chooses smallest sufficient free table and seating is atomic',()=>{
 let s=initialState('live',0);s.queue=[{id:'g',name:'Guest',size:5,at:0,note:''}];assert.equal(recommend(s.tables,5)?.capacity,6);
 s=seatGuest(s,'g',2000);assert.equal(s.queue.length,0);assert.equal(s.tables.find(t=>t.status==='occupied')?.guests,5);assert.equal(recommend(s.tables,20),undefined);
});
test('live session contains no fabricated history and malformed imports are rejected',()=>{
 const s=initialState('live');assert.equal(s.visits.length,0);assert.equal(s.queue.length,0);assert.ok(validateState(s));assert.equal(validateState({...s,tables:[s.tables[0]]}),false);assert.equal(validateState({...s,settings:{...s.settings,serviceMinutes:-1}}),false);
});
test('corrupt backup events and impossible ROI bounds are rejected',()=>{
 const s=initialState('live');assert.equal(validateState({...s,logs:[{}]}),false);assert.equal(validateState({...s,tables:s.tables.map((t,i)=>i===0?{...t,roi:{x:0.9,y:0.1,w:0.5,h:0.2}}:t)}),false);assert.equal(validateState({...s,tables:[null,...s.tables.slice(1)]}),false);
});
