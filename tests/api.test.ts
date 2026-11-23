import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createWorkspaceAPI} from '../src/lib/workspace-api';
import {initialState} from '../src/lib/engine';
function setup(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync(new URL('../drizzle/0000_superb_lady_ursula.sql',import.meta.url),'utf8'));
 const db={prepare(query:string){let args:(number|string)[]=[];const stmt=sqlite.prepare(query);const prepared={bind(...values:(number|string)[]){args=values;return prepared;},async first(){return stmt.get(...args)||null;},async run(){const result=stmt.run(...args);return {meta:{changes:Number(result.changes)}};}};return prepared;}};
 const api=createWorkspaceAPI(db as unknown as D1Database);return {api,close:()=>sqlite.close()};
}
const req=(user:string|null,body?:unknown,mode='live',origin?:string)=>new Request(`https://tableflow.test/api/workspace?mode=${mode}`,{method:body?'PUT':'GET',headers:{...(user?{'oai-authenticated-user-id':user}:{}),...(origin?{Origin:origin}:{}),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
test('database persists state, isolates users and modes, rejects conflicting writes',async()=>{
 const {api,close}=setup();try{const state=initialState('live',12345);assert.equal((await api.PUT(req('alice',{state,revision:0}))).status,200);
 const saved=await (await api.GET(req('alice'))).json() as {state:unknown;revision:number};assert.deepEqual(saved.state,state);assert.equal(saved.revision,1);
 assert.equal((await api.PUT(req('alice',{state,revision:0}))).status,409);assert.equal((await api.PUT(req('alice',{state,revision:1}))).status,200);
 const other=await (await api.GET(req('bob'))).json() as {state:unknown};assert.equal(other.state,null);
 const demo=await (await api.GET(req('alice',undefined,'demo'))).json() as {state:unknown};assert.equal(demo.state,null);
 }finally{close();}
});
test('API enforces authentication, origin, payload validation and mode allowlist',async()=>{
 const {api,close}=setup();try{assert.equal((await api.GET(req(null))).status,401);assert.equal((await api.GET(req('alice',undefined,'wrong'))).status,400);
 assert.equal((await api.PUT(req('alice',{state:initialState('live'),revision:0},'live','https://elsewhere.test'))).status,403);
 assert.equal((await api.PUT(req('alice',{state:{schema:1},revision:0}))).status,400);
 }finally{close();}
});
