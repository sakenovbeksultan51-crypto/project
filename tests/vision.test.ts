import {test} from 'node:test';
import assert from 'node:assert/strict';
import {peopleByTable} from '../src/lib/vision';
import {initialState} from '../src/lib/engine';
test('a person is never counted twice in overlapping zones; other classes are ignored',()=>{
 const tables=initialState('live').tables;tables[0].roi={x:0,y:0,w:0.7,h:0.7};tables[1].roi={x:0.3,y:0.3,w:0.5,h:0.5};
 const counts=peopleByTable([{class:'person',bbox:[30,20,20,30],score:0.9},{class:'chair',bbox:[30,20,20,30],score:0.95}],100,100,tables);
 assert.equal([...counts.values()].reduce((a,b)=>a+b,0),1);
});
test('detections outside calibration zones and invalid dimensions produce no occupants',()=>{
 const tables=initialState('live').tables;tables[0].roi={x:0,y:0,w:0.1,h:0.1};
 assert.equal(peopleByTable([{class:'person',bbox:[50,50,20,30],score:0.9}],100,100,tables).size,0);
 assert.equal(peopleByTable([],0,0,tables).size,0);
});
test('additional tables are confirmed twice while existing table identity and status stay unchanged',async()=>{
 const {TableDiscovery,addTableZones}=await import('../src/lib/vision');const d=new TableDiscovery();let s=initialState('live');s.tables[0].roi={x:.05,y:.5,w:.2,h:.3};s.tables[0].status='occupied';const found=[{class:'dining table',bbox:[50,5,15,10] as [number,number,number,number],score:.8}];
 assert.equal(d.candidates(s,found,100,100).length,0);const second=d.candidates(s,found,100,100);assert.equal(second.length,1);s=addTableZones(s,second);assert.equal(s.tables[0].status,'occupied');assert.deepEqual(s.tables[0].roi,{x:.05,y:.5,w:.2,h:.3});assert.ok(s.tables[1].roi);assert.equal(addTableZones(s,second),s);
 const ignored=s.tables[1].roi!;d.reject(ignored);s={...s,tables:s.tables.map((t,i)=>i===1?{...t,roi:null}:t)};d.candidates(s,found,100,100);assert.equal(d.candidates(s,found,100,100).length,0);
});
test('a small distant table proposal is not discarded solely for its size',async()=>{
 const {tableZones}=await import('../src/lib/vision');const zones=tableZones([{class:'dining table',score:.6,bbox:[500,120,18,12]}],1000,600);assert.equal(zones.length,1);assert.ok(zones[0].w<.03);
});


test('dynamic zones follow table position and size while preserving status and identity',async()=>{
 const {DynamicTableTracker}=await import('../src/lib/vision');const tracker=new DynamicTableTracker();let s=initialState('live');
 const table=(x:number,w=12)=>({class:'dining table',score:.8,bbox:[x,30,w,10] as [number,number,number,number]});
 s=tracker.update(s,[table(20),table(60)],100,100);s.tables[0].status='occupied';
 const old=s.tables[0].roi!;s=tracker.update(s,[table(63,14),table(23,14)],100,100);
 assert.equal(s.tables.filter(t=>t.roi).length,2);assert.equal(s.tables[0].status,'occupied');assert.ok(s.tables[0].roi!.x>old.x);assert.ok(s.tables[0].roi!.w>old.w);
 tracker.pin(1);const pinned=s.tables[0].roi;s=tracker.update(s,[table(26,14),table(65,14)],100,100);assert.deepEqual(s.tables[0].roi,pinned);
 s=tracker.update(s,[],100,100);assert.equal(s.tables.filter(t=>t.roi).length,2);
});
test('nearby distinct tabletops survive expanded seating area overlap',async()=>{
 const {tableZones}=await import('../src/lib/vision');const zones=tableZones([{class:'dining table',score:.8,bbox:[10,30,30,10]},{class:'dining table',score:.7,bbox:[22,30,30,10]}],100,100);assert.equal(zones.length,2);
});
test('dynamic discovery confirms new lower-confidence distant tables on two scans',async()=>{
 const {DynamicTableTracker}=await import('../src/lib/vision');const tracker=new DynamicTableTracker();let s=initialState('live');
 const first={class:'dining table',score:.8,bbox:[10,50,20,10] as [number,number,number,number]},distant={class:'dining table',score:.32,bbox:[75,10,4,3] as [number,number,number,number]};
 s=tracker.update(s,[first],100,100);s=tracker.update(s,[first,distant],100,100);assert.equal(s.tables.filter(t=>t.roi).length,1);
 s=tracker.update(s,[first,distant],100,100);assert.equal(s.tables.filter(t=>t.roi).length,2);
});


test('focus tracking caps automatic zones and retires stale boxes after consecutive misses',async()=>{
 const {DynamicTableTracker}=await import('../src/lib/vision');const tracker=new DynamicTableTracker();tracker.limit=4;let s=initialState('live');
 const found=Array.from({length:5},(_,i)=>({class:'dining table',score:.8,bbox:[i*20,20,8,5] as [number,number,number,number]}));
 s=tracker.update(s,found,100,100);assert.equal(s.tables.filter(t=>t.roi).length,4);
 tracker.pin(1);for(let i=0;i<6;i++)s=tracker.update(s,[],100,100);assert.equal(s.tables.filter(t=>t.roi).length,1);assert.ok(s.tables[0].roi);
});


test('excluding T01 removes its zone without reassigning it to another table as the camera moves',async()=>{
 const {DynamicTableTracker}=await import('../src/lib/vision');const tracker=new DynamicTableTracker();tracker.limit=4;tracker.excludedIds.add(1);let s=initialState('live');
 const tables=(dx:number)=>Array.from({length:4},(_,i)=>({class:'dining table',tableModel:'restaurant' as const,score:.8,bbox:[10+i*20+dx,20,8,5] as [number,number,number,number]}));
 for(const dx of [0,1,2,3,4]){s=tracker.update(s,tables(dx),100,100);assert.equal(s.tables[0].roi,null);assert.deepEqual(s.tables.filter(t=>t.roi).map(t=>t.id),[2,3,4]);}
});
test('a low-confidence trained proposal needs another scan before it becomes a new table',async()=>{
 const {DynamicTableTracker}=await import('../src/lib/vision');const tracker=new DynamicTableTracker();let s=initialState('live');
 const first={class:'dining table',tableModel:'restaurant' as const,score:.8,bbox:[10,20,8,5] as [number,number,number,number]};
 s=tracker.update(s,[first],100,100);s=tracker.update(s,[first,{...first,score:.22,bbox:[60,20,8,5]}],100,100);
 assert.equal(s.tables.filter(t=>t.roi).length,1);
 s=tracker.update(s,[first,{...first,score:.22,bbox:[60,20,8,5]}],100,100);assert.equal(s.tables.filter(t=>t.roi).length,2);
});
