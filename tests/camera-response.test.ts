import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readCameraResponse} from '../src/lib/camera-response';
import {requestOwner, withBrowserSession} from '../src/lib/request-owner';

test('camera responses explain empty server errors and preserve API errors', async()=>{
  await assert.rejects(readCameraResponse(new Response(null,{status:500})), /HTTP 500/);
  await assert.rejects(readCameraResponse(new Response('<html>Not found</html>',{status:404})), /HTTP 404/);
  await assert.rejects(readCameraResponse(Response.json({error:'Комната закрыта'},{status:410})), /Комната закрыта/);
  assert.deepEqual(await readCameraResponse(Response.json({code:'ABCDEF123456'})),{code:'ABCDEF123456'});
});

test('browser sessions accept wrapped requests and preserve POST body, origin and cookie', async()=>{
  const previous=process.env.VERCEL;
  process.env.VERCEL='1';
  try {
    assert.equal(requestOwner(new Request('https://tableflow.test/api/camera',{headers:{'oai-authenticated-user-id':'another-user'}})),null);
    const original=new Request('https://tableflow.test/api/camera',{
      method:'POST', headers:{origin:'https://tableflow.test','content-type':'application/json'},
      body:JSON.stringify({action:'create'}),
    });
    // Model vinext's request wrapper: public getters/methods work, but native
    // Request internals cannot be read from the wrapper object.
    const wrapped=new Proxy(original,{get(target,key){
      const value=Reflect.get(target,key,target);
      return typeof value==='function'?value.bind(target):value;
    }});
    const response=await withBrowserSession(wrapped,async(request)=>{
      assert.equal(request.method,'POST');
      assert.equal(request.headers.get('origin'),'https://tableflow.test');
      assert.deepEqual(await request.json(),{action:'create'});
      assert.match(requestOwner(request)!,/^web:/);
      return Response.json({ok:true});
    });
    assert.equal(response.status,200);
    assert.match(response.headers.get('set-cookie')!,/tableflow_session=.+; Path=\/; HttpOnly; SameSite=Lax/);
  } finally {
    if(previous===undefined)delete process.env.VERCEL;
    else process.env.VERCEL=previous;
  }
});
