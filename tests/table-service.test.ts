import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initialState,changeStatus} from '../src/lib/engine';
import {peopleByTable,SeatingTracker,Detection} from '../src/lib/vision';
import {TableServiceTracker} from '../src/lib/table-service';
import {applyVideoFrame} from '../src/lib/video-frame';
import {staffInBlack,tabletopSurface} from '../src/lib/service-vision';
import {normalizePeople,normalizeScene,parseCameraMessage,tableCalibration} from '../src/lib/camera-sync';

const table=(x:number,clear:boolean):Detection=>({class:'dining table',tableModel:'restaurant',score:.8,bbox:[x,50,20,10],surface:{clear,visible:true,objects:clear?0:1,darkFraction:clear?0:.1}});
const staff:Detection={class:'person',role:'staff',score:.9,bbox:[10,20,10,50]};
const empty={confirmed:new Map<number,number>(),present:new Map<number,number>()};

test('slow inference retains evidence but a genuinely interrupted stream resets it',()=>{
 const state=initialState('live',0);state.tables[0].roi={x:.04,y:.45,w:.32,h:.2};
 const occupied=changeStatus(state,1,'occupied',0,'camera');
 const service=new TableServiceTracker();service.maxFrameGapMs=7000;
 service.update(occupied,[],100,100,0,empty);
 assert.ok(!service.update(occupied,[],100,100,3000,empty).departed?.has(1));
 assert.ok(service.update(occupied,[],100,100,6000,empty).departed?.has(1));
 assert.ok(!service.update(occupied,[],100,100,14000,empty).departed?.has(1));
 const seating=new SeatingTracker();seating.maxFrameGapMs=7000;
 const guest:Detection={class:'person',score:.9,bbox:[10,30,10,30]};
 seating.update([guest],100,100,state.tables,0);
 assert.equal(seating.update([guest],100,100,state.tables,2500).confirmed.size,0);
 assert.equal(seating.update([guest],100,100,state.tables,5000).confirmed.get(1),1);
 assert.equal(seating.update([guest],100,100,state.tables,13000).confirmed.size,0);
});

test('people seated behind an empty front table do not keep the front table occupied',()=>{
 const state=initialState('live');state.tables[0].roi={x:.25,y:.55,w:.25,h:.25};
 const behind:Detection={class:'person',score:.9,bbox:[24,35,12,34]};
 assert.equal(peopleByTable([behind],100,100,state.tables).size,0);
 assert.equal(peopleByTable([{...behind,bbox:[26,48,12,35]}],100,100,state.tables).get(1),1);
});

test('staff departure immediately frees only the serviced table without waiting for surface confidence',()=>{
 const lifecycle=new TableServiceTracker();let state=initialState('live',0);
 lifecycle.departureDelayMs=2000;
 state.tables[0].roi={x:.04,y:.45,w:.32,h:.2};state.tables[1].roi={x:.54,y:.45,w:.32,h:.2};
 state=changeStatus(state,1,'occupied',0,'camera');state=changeStatus(state,2,'occupied',0,'camera');
 const frame=(at:number,scene:Detection[])=>{const evidence=lifecycle.update(state,scene,100,100,at,empty);state=applyVideoFrame(state,scene,100,100,at,evidence);};
 for(const at of [1000,2000,3000])frame(at,[table(10,false),table(60,false)]);
 assert.equal(state.tables[0].status,'dirty');assert.equal(state.tables[1].status,'dirty');assert.equal(state.visits.length,2);
 for(const at of [4000,5000])frame(at,[table(10,false),table(60,false),staff]);
 assert.equal(state.tables[0].status,'cleaning');assert.equal(state.tables[1].status,'dirty');
 frame(6000,[table(10,false),table(60,false)]);
 assert.equal(state.tables[0].status,'free','The first observed staff departure completes the visit even before surface confidence settles');
 for(const at of [8000,9000,10000])frame(at,[table(10,true),table(60,false)]);
 assert.equal(state.tables[0].status,'free');assert.equal(state.tables[1].status,'dirty');assert.equal(state.visits.length,2);
});

test('staff are never counted as seated guests, even while stationary',()=>{
 const state=initialState('live');state.tables[0].roi={x:0,y:0,w:1,h:1};const seating=new SeatingTracker();
 for(const at of [0,1000,2000,3000]){const evidence=seating.update([staff],100,100,state.tables,at);assert.equal(evidence.confirmed.size,0);assert.equal(evidence.present.size,0);}
});

test('a brief pass-by and an occluded or single empty-looking frame do not trigger automatic white-table release',()=>{
 const lifecycle=new TableServiceTracker();let state=initialState('live',0);state.tables[0].roi={x:.04,y:.45,w:.32,h:.2};state=changeStatus(state,1,'dirty',0,'camera');
 const frame=(at:number,scene:Detection[])=>{state=applyVideoFrame(state,scene,100,100,at,lifecycle.update(state,scene,100,100,at,empty));};
 frame(1000,[table(10,false),staff]);frame(2000,[table(10,true)]);assert.equal(state.tables[0].status,'dirty');
 frame(3000,[table(10,false),staff]);frame(4000,[table(10,false),staff]);assert.equal(state.tables[0].status,'cleaning');
 frame(5000,[]);assert.equal(state.tables[0].status,'free','A confirmed staff visit ends on departure even if the tabletop detector misses that frame');
});

test('the black-uniform cue excludes seated people and brown clothing',()=>{
 const pixels=new Uint8ClampedArray(640*640*4),person:Detection={class:'person',score:.9,bbox:[10,10,40,140]},transform={scale:1,px:0,py:0};
 assert.equal(staffInBlack(person,pixels,transform),true);
 assert.equal(staffInBlack({...person,bbox:[10,10,90,100]},pixels,transform),false);
 for(let i=0;i<pixels.length;i+=4){pixels[i]=110;pixels[i+1]=65;pixels[i+2]=40;pixels[i+3]=255;}
 assert.equal(staffInBlack(person,pixels,transform),false);
});

test('a visible white surface is clear only when detected objects and occlusion are absent',()=>{
 const pixels=new Uint8ClampedArray(640*640*4).fill(255),surface:Detection={class:'dining table',score:.9,bbox:[100,100,200,100]},transform={scale:1,px:0,py:0};
 assert.equal(tabletopSurface(surface,[],[],pixels,transform).clear,true);
 assert.equal(tabletopSurface(surface,[],[{class:'bottle',score:.8,bbox:[150,90,20,45]}],pixels,transform).clear,false);
 assert.equal(tabletopSurface(surface,[{class:'person',role:'staff',score:.9,bbox:[110,30,100,200]}],[],pixels,transform).visible,false);
});

test('dark rim and chair shadows outside the white tabletop interior do not block automatic release',()=>{
 const pixels=new Uint8ClampedArray(640*640*4).fill(255);
 for(let y=175;y<200;y++)for(let x=100;x<300;x++){const i=(y*640+x)*4;pixels[i]=pixels[i+1]=pixels[i+2]=15;}
 const surface:Detection={class:'dining table',score:.9,bbox:[100,100,200,100]};
 assert.equal(tabletopSurface(surface,[],[],pixels,{scale:1,px:0,py:0}).clear,true);
});

test('remote observations preserve service evidence and reject invalid surface or staff metadata',()=>{
 const state=initialState('live'),scene=normalizeScene([staff,table(10,true)],100,100);
 const message={type:'observations',epoch:'scene',frame:1,ms:100,people:normalizePeople([staff],100,100),scene,zones:tableCalibration(state)};
 const parsed=parseCameraMessage(JSON.stringify(message));assert.equal(parsed?.type,'observations');
 if(parsed?.type==='observations'){assert.equal(parsed.people[0].role,'staff');assert.equal(parsed.scene?.[1].surface?.clear,true);}
 assert.equal(parseCameraMessage(JSON.stringify({...message,scene:[{...scene[1],surface:{...scene[1].surface,darkFraction:2}}]})),null);
 assert.equal(parseCameraMessage(JSON.stringify({...message,scene:[{...scene[1],role:'staff'}]})),null);
});


test('an empty white table becomes free without requiring a previous staff visit or earlier objects',()=>{
 for(const status of ['dirty','cleaning'] as const){
  const lifecycle=new TableServiceTracker();let state=initialState('live',0);state.tables[0].roi={x:.04,y:.45,w:.32,h:.2};state=changeStatus(state,1,status,0,'camera');
  const frame=(at:number,scene:Detection[],seating=empty)=>{state=applyVideoFrame(state,scene,100,100,at,lifecycle.update(state,scene,100,100,at,seating));};
  frame(1000,[table(10,true)]);assert.equal(state.tables[0].status,status);
  frame(1400,[table(10,true)]);assert.equal(state.tables[0].status,'free');
 }
});
test('white tabletop release respects seated guests, objects, missing surface evidence and staff still at the table',()=>{
 for(const scene of [[table(10,false)],[],[{...table(10,true),surface:{clear:true,visible:false,objects:0,darkFraction:0}}],[table(10,true),staff]]){
  const lifecycle=new TableServiceTracker();let state=initialState('live',0);state.tables[0].roi={x:.04,y:.45,w:.32,h:.2};state=changeStatus(state,1,'dirty',0,'camera');
  for(const at of [1000,1400,1800])state=applyVideoFrame(state,scene,100,100,at,lifecycle.update(state,scene,100,100,at,empty));
  assert.notEqual(state.tables[0].status,'free');
 }
 const lifecycle=new TableServiceTracker();let occupied=initialState('live',0);occupied.tables[0].roi={x:.04,y:.45,w:.32,h:.2};occupied=changeStatus(occupied,1,'occupied',0,'camera');
 const guest={confirmed:new Map([[1,1]]),present:new Map([[1,1]])};
 for(const at of [1000,1400,1800])occupied=applyVideoFrame(occupied,[table(10,true)],100,100,at,lifecycle.update(occupied,[table(10,true)],100,100,at,guest));
 assert.equal(occupied.tables[0].status,'occupied');
});

test('cleanup evidence stays available until the state consumer applies the free transition',()=>{
 const service=new TableServiceTracker();let state=initialState('live',0);state.tables[0].roi={x:.04,y:.45,w:.32,h:.2};state=changeStatus(state,1,'cleaning',0,'camera');
 service.update(state,[table(10,false),staff],100,100,1000,empty);
 service.update(state,[table(10,false),staff],100,100,1600,empty);
 assert.ok(service.update(state,[table(10,false)],100,100,2000,empty).cleaned?.has(1));
 const next=service.update(state,[table(10,false)],100,100,2400,empty);assert.ok(next.cleaned?.has(1));
 state=applyVideoFrame(state,[],100,100,2400,next);assert.equal(state.tables[0].status,'free');
 assert.equal(service.update(state,[table(10,false)],100,100,2800,empty).cleaned?.size,0);
});
