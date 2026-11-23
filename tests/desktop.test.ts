import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';
import {once} from 'node:events';
import {createDesktopServer} from '../desktop/server';
import {initialState} from '../src/lib/engine';

function fixture(){
 const root=mkdtempSync(join(tmpdir(),'tableflow-desktop-test-')),clientDir=join(root,'.data/desktop-app');
 mkdirSync(join(clientDir,'assets'),{recursive:true});mkdirSync(join(root,'public/ort'),{recursive:true});
 writeFileSync(join(clientDir,'index.html'),'<!doctype html><title>TableFlow</title><div id="root"></div>');
 writeFileSync(join(clientDir,'assets/app.js'),'console.log("TableFlow")');writeFileSync(join(clientDir,'server.mjs'),'PRIVATE_SERVER_SOURCE');
 writeFileSync(join(root,'public/ort/test.wasm'),Buffer.from([0,97,115,109,1,0,0,0]));writeFileSync(join(root,'.dev.vars'),'PRIVATE_SECRET');
 return {root,clientDir,remove(){assert.equal(resolve(dirname(root)),resolve(tmpdir()));assert.ok(basename(root).startsWith('tableflow-desktop-test-'));rmSync(root,{recursive:true,force:true});}};
}
async function running(f:ReturnType<typeof fixture>){
 const app=createDesktopServer({...f,assistantEnv:{ASSISTANT_PROVIDER:'local'},buildId:'test-build'});
 app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
 const address=app.server.address();assert.ok(address&&typeof address==='object');
 return {...app,url:`http://127.0.0.1:${address.port}`,close:async()=>{app.server.closeAllConnections();await new Promise<void>((done,fail)=>app.server.close(error=>error?fail(error):done()));}};
}
const put=(url:string,state:unknown,revision:number)=>fetch(url+'/api/workspace',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({state,revision})});

test('desktop initializes its database, saves visits and restores them after a server restart',async()=>{
 const f=fixture();let app=await running(f);
 try{
  const health=await(await fetch(app.url+'/api/health')).json() as Record<string,unknown>;
  assert.equal(health.runtime,'desktop');assert.equal(health.storage,'sqlite');assert.equal(health.ready,true);assert.equal(health.buildId,'test-build');
  const empty=await fetch(app.url+'/api/workspace?mode=live');assert.equal(empty.status,200);assert.deepEqual(await empty.json(),{state:null,revision:0});
  const state=initialState('live');state.settings.restaurant='Saved desktop shift';
  state.visits=[{tableId:3,start:Date.now()-120000,end:Date.now()-60000,guests:2,source:'manual'}];
  assert.equal((await put(app.url,state,0)).status,200);assert.equal((await put(app.url,state,0)).status,409);
  await app.close();app=await running(f);
  const saved=await(await fetch(app.url+'/api/workspace?mode=live')).json() as {state:typeof state;revision:number};
  assert.equal(saved.state.settings.restaurant,'Saved desktop shift');assert.equal(saved.state.visits.length,1);assert.equal(saved.revision,1);
  const demo=await(await fetch(app.url+'/api/workspace?mode=demo')).json() as {state:unknown};assert.equal(demo.state,null);
 }finally{await app.close();f.remove();}
});

test('desktop imports existing D1 workspaces once without modifying the original database',async()=>{
 const f=fixture(),legacy=join(f.root,'.wrangler/state/v3/d1/miniflare-D1DatabaseObject');mkdirSync(legacy,{recursive:true});
 const file=join(legacy,'previous.sqlite'),db=new DatabaseSync(file),state=initialState('live');state.settings.restaurant='Previous shift';
 db.exec('CREATE TABLE workspaces (key TEXT PRIMARY KEY,payload TEXT,revision INTEGER,updated_at INTEGER)');
 db.prepare('INSERT INTO workspaces VALUES (?,?,?,?)').run('local-development:live',JSON.stringify(state),7,Date.now());db.close();
 let app=await running(f);
 try{
  const saved=await(await fetch(app.url+'/api/workspace?mode=live')).json() as {state:typeof state;revision:number};assert.equal(saved.revision,7);assert.equal(saved.state.settings.restaurant,'Previous shift');
  state.settings.restaurant='Updated desktop shift';assert.equal((await put(app.url,state,7)).status,200);
  await app.close();app=await running(f);
  const updated=await(await fetch(app.url+'/api/workspace?mode=live')).json() as {state:typeof state;revision:number};assert.equal(updated.revision,8);assert.equal(updated.state.settings.restaurant,'Updated desktop shift');
  const source=new DatabaseSync(file,{readOnly:true});assert.equal(source.prepare('SELECT revision FROM workspaces').get()!.revision,7);source.close();
 }finally{await app.close();f.remove();}
});

test('desktop serves its client and WASM correctly without exposing server files or secrets',async()=>{
 const f=fixture(),app=await running(f);
 try{
  for(const path of ['/','/watch']){const response=await fetch(app.url+path);assert.equal(response.status,200);assert.match(await response.text(),/TableFlow/);}
  const js=await fetch(app.url+'/assets/app.js');assert.match(js.headers.get('content-type')!,/javascript/);
  const wasm=await fetch(app.url+'/ort/test.wasm',{headers:{Range:'bytes=0-3'}});assert.equal(wasm.status,206);assert.equal(wasm.headers.get('content-type'),'application/wasm');assert.deepEqual([...new Uint8Array(await wasm.arrayBuffer())],[0,97,115,109]);
  assert.equal((await fetch(app.url+'/ort/test.wasm',{headers:{Range:'bytes=100-200'}})).status,416);
  assert.equal((await fetch(app.url+'/server.mjs')).status,404);assert.equal((await fetch(app.url+'/.dev.vars')).status,403);
  assert.equal((await fetch(app.url+'/%2e%2e%5c.dev.vars')).status,403);
 }finally{await app.close();f.remove();}
});

test('desktop protects writes and keeps assistant and camera endpoints functional',async()=>{
 const f=fixture(),app=await running(f);
 try{
  assert.equal((await fetch(app.url+'/api/workspace',{method:'PUT',headers:{Origin:'https://other.test'},body:'{}'})).status,403);
  assert.equal((await fetch(app.url+'/api/workspace',{method:'PUT',body:'x'.repeat(1_000_001)})).status,413);
  const state=initialState('live');
  const answer=await fetch(app.url+'/api/assistant',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state,tableIds:[1,2,3],messages:[{role:'user',content:'Какие столы свободны?'}]})});
  assert.equal(answer.status,200);assert.equal(((await answer.json()) as {mode:string}).mode,'local');
  const created=await fetch(app.url+'/api/camera',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'create'})});assert.equal(created.status,200);
  const room=await created.json() as {code:string;token:string;invite:string};assert.match(room.code,/^[A-F0-9]{12}$/);
  const viewer=crypto.randomUUID();
  const joined=await fetch(app.url+'/api/camera',{method:'POST',headers:{'Content-Type':'application/json','oai-authenticated-user-id':'viewer'},body:JSON.stringify({action:'join',code:room.code,token:viewer,invite:room.invite})});assert.equal(joined.status,200);
  const snapshot=await fetch(app.url+'/api/camera?code='+room.code,{headers:{'x-camera-token':room.token}});assert.equal(snapshot.status,200);
  assert.equal((await fetch(app.url+'/api/camera?code='+room.code,{headers:{'x-camera-token':'wrong'}})).status,403);
 }finally{await app.close();f.remove();}
});
