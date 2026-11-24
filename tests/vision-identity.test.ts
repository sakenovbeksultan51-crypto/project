import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initialState,changeStatus} from '../src/lib/engine';
import {DynamicTableTracker,SeatingTracker,tableZones,peopleByTable,tablesWithPossibleGuests,type Detection} from '../src/lib/vision';
import {TableServiceTracker} from '../src/lib/table-service';
import {applyVideoFrame} from '../src/lib/video-frame';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/cctv-table-identity.json',import.meta.url),'utf8')) as {frames:{second:number;width:number;height:number;detections:Detection[]}[]};

test('a COCO whole table and a specialist tabletop describe one physical table',()=>{
 const detections:Detection[]=[
  {class:'dining table',score:.74,bbox:[304,246,160,122]},
  {class:'dining table',tableModel:'restaurant',score:.73,bbox:[311,245,145,54]},
  {class:'dining table',score:.68,bbox:[820,500,199,215]},
 ];
 const zones=tableZones(detections,1280,720);assert.equal(zones.length,2);
 assert.ok(zones.every(z=>z.h<.2),'Legs and chairs must not become extra seating zones');
});

test('switching between a full surface, a fragment and a long occlusion preserves one table ID',()=>{
 const tracker=new DynamicTableTracker();let s=initialState('live',0);
 const full:Detection={class:'dining table',tableModel:'restaurant',score:.8,bbox:[100,200,200,80]};
 s=tracker.update(s,[full],1000,600);s=changeStatus(s,1,'occupied',0,'camera');const original=s.tables[0].roi;
 for(let i=0;i<15;i++)s=tracker.update(s,[{...full,bbox:[145,220,80,25]}],1000,600);
 assert.equal(s.tables.filter(t=>t.roi).length,1);assert.deepEqual(s.tables[0].roi,original);
 for(let i=0;i<30;i++)s=tracker.update(s,[],1000,600);
 assert.ok(!tracker.visibleIds.has(1));assert.deepEqual(s.tables[0].roi,original);
 s=tracker.update(s,[full],1000,600);assert.deepEqual([...tracker.visibleIds],[1]);assert.equal(s.tables[0].status,'occupied');assert.equal(s.tables.filter(t=>t.roi).length,1);
});

test('a weak nearby person blocks false departure without occupying a free table',()=>{
 let s=initialState('live',0);s.tables[0].roi={x:.7,y:.45,w:.15,h:.12,kind:'tabletop'};
 const person:Detection={class:'person',score:.32,bbox:[66,30,9,27]};
 assert.equal(peopleByTable([person],100,100,s.tables).size,0);assert.ok(tablesWithPossibleGuests([person],100,100,s.tables).has(1));
 const blank={confirmed:new Map<number,number>(),present:new Map<number,number>(),observed:new Set([1])};
 const service=new TableServiceTracker();
 for(let at=0;at<=14000;at+=2000)s=applyVideoFrame(s,[person],100,100,at,service.update(s,[person],100,100,at,blank));
 assert.equal(s.tables[0].status,'free');
 s=changeStatus(s,1,'occupied',14000,'camera');
 let untracked=s;for(let at=16000;at<=30000;at+=2000)untracked=applyVideoFrame(untracked,[person],100,100,at);assert.equal(untracked.tables[0].status,'occupied');
 for(let at=16000;at<=30000;at+=2000)s=applyVideoFrame(s,[person],100,100,at,service.update(s,[person],100,100,at,blank));
 assert.equal(s.tables[0].status,'occupied');assert.equal(s.visits.length,0);
 for(const at of [32000,34000,36000]){s=applyVideoFrame(s,[],100,100,at,service.update(s,[],100,100,at,blank));assert.equal(s.tables[0].status,'occupied');}
 s=applyVideoFrame(s,[],100,100,38000,service.update(s,[],100,100,38000,blank));assert.equal(s.tables[0].status,'dirty');
});

for(const cadence of [1,2,3,4])test(`43-second CCTV regression at ${cadence}s sampling: six stable tables, no false cleaning`,()=>{
 const tracker=new DynamicTableTracker(),seating=new SeatingTracker(),service=new TableServiceTracker();let s=initialState('live',0);
 service.maxFrameGapMs=cadence*1000+500;seating.maxFrameGapMs=service.maxFrameGapMs;
 for(const f of fixture.frames.filter(f=>f.second%cadence===0)){
  const at=f.second*1000;s=tracker.update(s,f.detections,f.width,f.height);
  const e=seating.update(f.detections,f.width,f.height,s.tables.filter(t=>tracker.visibleIds.has(t.id)),at);
  s=applyVideoFrame(s,f.detections,f.width,f.height,at,service.update(s,f.detections,f.width,f.height,at,e));
  assert.deepEqual(s.tables.filter(t=>t.roi).map(t=>t.id),[1,2,3,4,5,6],`No duplicate IDs at ${f.second}s`);
  assert.equal(s.visits.length,0,`Guests have not left during the clip at ${f.second}s`);
  assert.ok(!s.tables.some(t=>t.status==='dirty'),`No cleanup while guests remain at ${f.second}s`);
 }
 assert.equal(s.tables[2].status,'occupied','The guests at the right-hand table must still be seated');
 assert.equal(s.tables[0].status,'free','The worker wiping the rear table is not a completed guest visit');
});

test('a guest behind the foreground table cannot keep it occupied after its guest leaves',()=>{
 const frames=JSON.parse(readFileSync(new URL('./fixtures/lifecycle-observations.json',import.meta.url),'utf8')) as {time:number;detections:Detection[]}[];
 const tracker=new DynamicTableTracker(),seating=new SeatingTracker(),service=new TableServiceTracker();let s=initialState('live',0);
 service.maxFrameGapMs=10000;seating.maxFrameGapMs=10000;let before=false,after=false;
 for(const f of frames){const at=f.time*1000;s=tracker.update(s,f.detections,3840,2160);
  const evidence=seating.update(f.detections,3840,2160,s.tables.filter(t=>tracker.visibleIds.has(t.id)),at);
  s=applyVideoFrame(s,f.detections,3840,2160,at,service.update(s,f.detections,3840,2160,at,evidence));
  if(f.time>=61&&f.time<65){assert.equal(s.tables[6].status,'occupied');before=true;}
  if(f.time>=84&&f.time<87){assert.equal(s.tables[6].status,'dirty');assert.equal(s.tables[9].status,'occupied');after=true;}
 }
 assert.ok(before&&after);
});
