import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createCameraAPI} from '../src/lib/camera-api';
function setup(){const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../drizzle/0000_superb_lady_ursula.sql',import.meta.url),'utf8'));const db={prepare(query:string){const stmt=sql.prepare(query);let args:(string|number)[]=[];const p={bind(...v:(string|number)[]){args=v;return p;},async first(){return stmt.get(...args)||null;},async run(){return {meta:{changes:Number(stmt.run(...args).changes)}};}};return p;}};return {api:createCameraAPI(db as unknown as D1Database),sql};}
const req=(user:string|null,body?:unknown,code='',token='',origin='https://tableflow.test')=>new Request(`https://tableflow.test/api/camera?code=${code}`,{method:body?'POST':'GET',headers:{...(user?{'oai-authenticated-user-id':user}:{}),'x-camera-token':token,origin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
test('camera signalling pairs two devices, protects SDP by account and token, rejects extra viewers and expires',async()=>{
 const {api,sql}=setup();try{
  assert.equal((await api(req(null,{action:'create'}))).status,401);
  assert.equal((await api(req('a',{action:'create'},'','','https://evil.test'))).status,403);
  const room=await (await api(req('a',{action:'create'}))).json() as {code:string;token:string};assert.match(room.code,/^[A-F0-9]{12}$/);
  assert.equal((await api(req('b',undefined,room.code,room.token))).status,403);
  assert.equal((await api(req('a',undefined,room.code,'wrong'))).status,403);
  const token=crypto.randomUUID();assert.equal((await api(req('a',{action:'join',code:room.code,token}))).status,200);
  assert.equal((await api(req('a',{action:'join',code:room.code,token:crypto.randomUUID()}))).status,409);
  assert.equal((await api(req('a',{action:'offer',code:room.code,token,sdp:'wrong sender'}))).status,400);
  assert.equal((await api(req('a',{action:'offer',...room,sdp:'host SDP'}))).status,200);
  assert.equal((await api(req('a',{action:'answer',code:room.code,token,sdp:'viewer SDP'}))).status,200);
  const result=await (await api(req('a',undefined,room.code,token))).json() as Record<string,unknown>;assert.equal(result.offer,'host SDP');assert.equal(result.answer,'viewer SDP');assert.equal(result.host,undefined);
  const key=`camera:${room.code}`;const row=sql.prepare('SELECT payload FROM workspaces WHERE key=?').get(key) as {payload:string};const expired={...JSON.parse(row.payload),expires:1};sql.prepare('UPDATE workspaces SET payload=? WHERE key=?').run(JSON.stringify(expired),key);
  assert.equal((await api(req('a',undefined,room.code,token))).status,410);
 }finally{sql.close();}
});
test('closing a broadcast removes its room immediately',async()=>{const {api,sql}=setup();try{const room=await (await api(req('a',{action:'create'}))).json() as {code:string;token:string};assert.equal((await api(req('a',{action:'close',...room}))).status,200);assert.equal((await api(req('a',undefined,room.code,room.token))).status,404);}finally{sql.close();}});
test('guest invitation grants only one viewer capability, hides secrets, and is revoked by host close',async()=>{
 const {api,sql}=setup();try{
  const room=await (await api(req('owner',{action:'create'}))).json() as {code:string;token:string;invite:string};
  assert.match(room.invite,/^[a-f0-9]{64}$/);
  const stored=sql.prepare('SELECT payload FROM workspaces WHERE key=?').get(`camera:${room.code}`) as {payload:string};assert.ok(!stored.payload.includes(room.invite),'raw invite must not be stored');
  const token=crypto.randomUUID();
  assert.equal((await api(req(null,{action:'join',code:room.code,token}))).status,403);
  assert.equal((await api(req('other',{action:'join',code:room.code,token,invite:'0'.repeat(64)}))).status,403);
  assert.equal((await api(req(null,undefined,room.code,room.token))).status,403,'host requires authenticated owner even with host token');
  assert.equal((await api(req(null,{action:'join',code:room.code,token,invite:room.invite}))).status,200);
  assert.equal((await api(req(null,{action:'join',code:room.code,token:crypto.randomUUID(),invite:room.invite}))).status,409);
  assert.equal((await api(req('owner',{action:'offer',code:room.code,token:room.token,sdp:'offer'}))).status,200);
  assert.equal((await api(req(null,{action:'answer',code:room.code,token,sdp:'answer'}))).status,200);
  const data=await (await api(req(null,undefined,room.code,token))).json() as Record<string,unknown>;assert.equal(data.offer,'offer');for(const key of ['host','owner','invite','inviteHash'])assert.equal(data[key],undefined);
  assert.equal((await api(req(null,{action:'close',code:room.code,token}))).status,400);
  assert.equal((await api(req(null,{action:'offer',code:room.code,token,sdp:'unauthorized'}))).status,400);
  assert.equal((await api(req('owner',{action:'close',code:room.code,token:room.token}))).status,200);
  assert.equal((await api(req(null,undefined,room.code,token))).status,404);
  assert.equal((await api(req(null,{action:'join',code:room.code,token,invite:room.invite}))).status,404);
 }finally{sql.close();}
});
