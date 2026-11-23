import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initialState,observe,changeStatus,type Table} from '../src/lib/engine';
import {DynamicTableTracker,SeatingTracker,tableZones,type Detection} from '../src/lib/vision';
import {TableServiceTracker} from '../src/lib/table-service';
import {applyVideoFrame} from '../src/lib/video-frame';
import {layoutTableBadges} from '../src/lib/vision-overlay';
import {applyCalibration,tableCalibration} from '../src/lib/camera-sync';

test('an empty never-used table cannot drift into cleanup after many observations',()=>{
 let s=initialState('live',0);s.tables[0].roi={x:.1,y:.4,w:.3,h:.2};
 for(let i=0;i<1500;i++)s=observe(s,1,i%5?'clear':'uncertain',i*1000);
 assert.equal(s.tables[0].status,'free');assert.equal(s.visits.length,0);assert.equal(s.alerts.length,0);
});

test('tracked video changes state only from confirmed seating or explicit departure evidence',()=>{
 let s=changeStatus(initialState('live',0),1,'occupied',0,'camera');s.tables[0].roi={x:.1,y:.4,w:.3,h:.2};
 const evidence={confirmed:new Map<number,number>(),present:new Map<number,number>(),observed:new Set([1])};
 for(let i=1;i<=40;i++)s=applyVideoFrame(s,[],100,100,i*1000,evidence);
 assert.equal(s.tables[0].status,'occupied');assert.equal(s.visits.length,0);
 s=applyVideoFrame(s,[],100,100,41000,{...evidence,departed:new Set([1])});assert.equal(s.tables[0].status,'dirty');assert.equal(s.visits.length,1);
});

test('an invisible table and a brief detection dropout do not start cleanup',()=>{
 const service=new TableServiceTracker();service.maxFrameGapMs=10000;let s=changeStatus(initialState('live',0),1,'occupied',0,'camera');s.tables[0].roi={x:.1,y:.4,w:.3,h:.2};
 const blank={confirmed:new Map<number,number>(),present:new Map<number,number>()};
 for(const at of [0,2500,5000])assert.ok(!service.update(s,[],100,100,at,{...blank,observed:new Set([1])}).departed?.has(1));
 for(const at of [7500,10000,12500,15000])assert.ok(!service.update(s,[],100,100,at,{...blank,observed:new Set()}).departed?.has(1));
 assert.ok(!service.update(s,[],100,100,17500,{...blank,observed:new Set([1])}).departed?.has(1));
});

test('a lost occupied table number is not given to a newly discovered empty table',()=>{
 const tracker=new DynamicTableTracker();let s=initialState('live',0);
 const detection:Detection={class:'dining table',score:.9,bbox:[10,30,20,10]};
 s=tracker.update(s,[detection],100,100);s=changeStatus(s,1,'occupied',0,'camera');
 for(let i=0;i<6;i++)s=tracker.update(s,[],100,100);
 assert.equal(s.tables[0].roi,null);
 s=tracker.update(s,[{...detection,bbox:[70,60,15,8]}],100,100);
 assert.equal(s.tables[0].roi,null);assert.equal(s.tables[0].status,'occupied');assert.equal(s.tables[1].status,'free');assert.ok(s.tables[1].roi);
});

test('a briefly empty-looking white surface cannot bypass the confirmed departure delay',()=>{
 const service=new TableServiceTracker();let s=initialState('live',0);s.tables[0].roi={x:.1,y:.5,w:.2,h:.1,kind:'tabletop'};s=changeStatus(s,1,'occupied',0,'camera');
 const surface:Detection={class:'dining table',score:.9,bbox:[10,50,20,10],surface:{clear:true,visible:true,objects:0,darkFraction:0}};
 const empty={confirmed:new Map<number,number>(),present:new Map<number,number>(),observed:new Set([1])};
 for(const at of [0,1000,2000,3000,4000,5000]){const evidence=service.update(s,[surface],100,100,at,empty);s=applyVideoFrame(s,[surface],100,100,at,evidence);assert.equal(s.tables[0].status,'occupied');assert.equal(s.visits.length,0);}
 const evidence=service.update(s,[surface],100,100,6000,empty);s=applyVideoFrame(s,[surface],100,100,6000,evidence);assert.equal(s.tables[0].status,'free');assert.equal(s.visits.length,1);
});

test('a standing passerby cannot mark a tabletop occupied',()=>{
 const s=initialState('live',0);s.tables[0].roi={x:.3,y:.5,w:.2,h:.08,kind:'tabletop'};const seating=new SeatingTracker();
 for(const at of [0,2000,4000,6000])assert.equal(seating.update([{class:'person',score:.9,bbox:[33,15,8,60]}],100,100,s.tables,at).confirmed.size,0);
});

test('recalibrating a previously lost camera table does not inherit its old cleanup state or invent a visit',()=>{
 let s=changeStatus(initialState('live',0),1,'dirty',0,'camera');
 const zones=tableCalibration(s);zones[0].roi={x:.2,y:.4,w:.2,h:.08,kind:'tabletop'};
 const next=applyCalibration(s,zones,1000);assert.equal(next.tables[0].status,'free');assert.equal(next.tables[0].guests,0);assert.equal(next.visits.length,s.visits.length);
});

test('real video regression: foreground empty tables stay free and occupied tables do not acquire two labels',()=>{
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/restaurant-seating.json',import.meta.url),'utf8')) as {frames:{second:number;width:number;height:number;detections:Detection[]}[]};
 for(const f of fixture.frames.filter(f=>f.second<=5)){
  const tracker=new DynamicTableTracker(),seating=new SeatingTracker(),service=new TableServiceTracker();let s=initialState('live',0);
  for(let i=0;i<7;i++){s=tracker.update(s,f.detections,f.width,f.height);const observed=s.tables.filter(t=>tracker.visibleIds.has(t.id)),at=i*2500,e=seating.update(f.detections,f.width,f.height,observed,at);s=applyVideoFrame(s,f.detections,f.width,f.height,at,service.update(s,f.detections,f.width,f.height,at,e));}
  const empty=s.tables.filter(t=>t.roi&&(t.roi.y>.57||t.roi.x>.43));assert.ok(empty.length>=2);
  for(const t of empty)assert.equal(t.status,'free',`Frame ${f.second}s: empty T${t.id} must remain free`);
  assert.equal(s.visits.length,0);assert.ok(!s.tables.some(t=>t.status==='dirty'));
  const blue=s.tables.filter(t=>t.roi&&t.roi.x>.27&&t.roi.x<.43&&t.roi.y<.55);assert.equal(blue.length,1);assert.equal(blue[0].status,'occupied');assert.equal(blue[0].guests,2);
  if(f.second===4){const left=s.tables.find(t=>t.roi&&t.roi.x<.2&&t.roi.y<.55);assert.equal(left?.guests,2,'Partially occluded seated guests share their actual table');}
 }
});

test('compact overlay badges stay in the viewport and do not overlap one another',()=>{
 const s=initialState('live',0);s.tables.forEach((t,i)=>{t.roi={x:.25+(i%4)*.09,y:.3+Math.floor(i/4)*.06,w:.09,h:.05,kind:'tabletop'};});
 const labels=layoutTableBadges(s.tables,{x:0,y:0,w:720,h:405});
 assert.equal(labels.length,12);
 for(const a of labels){assert.ok(a.x>=0&&a.y>=0&&a.x+a.w<=720&&a.y+a.h<=405);for(const b of labels){if(a.id===b.id)continue;const overlap=Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));assert.equal(overlap,0);}}
});

test('a shifted tabletop fragment cannot steal a second table number even with higher confidence',()=>{
 const zones=tableZones([
  {class:'dining table',tableModel:'restaurant',score:.48,bbox:[612,512,237,46]},
  {class:'dining table',tableModel:'restaurant',score:.85,bbox:[601,478,126,60]},
  {class:'dining table',tableModel:'restaurant',score:.8,bbox:[1371,538,239,61]},
 ],1920,1080);
 assert.equal(zones.length,2);assert.ok(zones.find(z=>z.x<.5)!.w>.12,'Preserve the complete surface rather than the smaller fragment');
});
