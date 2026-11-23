// Exercise the built inference worker and actual ONNX models without a browser.
// Run: node --experimental-vm-modules scripts/verify-desktop-worker.mjs
import vm from 'node:vm';
import {readdirSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';

const origin='http://localhost:3000',assets=resolve('.data/desktop-app/assets');
const entry=readdirSync(assets).find(name=>name.startsWith('vision.worker-')&&name.endsWith('.js')&&statSync(resolve(assets,name)).size>1000);
assert.ok(entry,'Built inference worker is missing');
const workerUrl=origin+'/assets/'+entry,messages=[];
const pixels=new Uint8ClampedArray(640*640*4).fill(240);
const context=vm.createContext({console,URL,Blob,fetch,Response,Request,Headers,performance,crypto,WebAssembly,TextDecoder,TextEncoder,
 ArrayBuffer,SharedArrayBuffer,Uint8Array,Uint8ClampedArray,Float32Array,location:new URL(workerUrl),
 setTimeout,clearTimeout,setInterval,clearInterval,structuredClone,
 importScripts(){throw new Error('Unexpected classic worker');},postMessage(message){messages.push(message);},
 OffscreenCanvas:class{getContext(){return {fillRect(){},drawImage(){},getImageData(){return {data:pixels};}};}},
});
vm.runInContext('self=globalThis; WorkerGlobalScope=class {static [Symbol.hasInstance](){return true;}}',context);
const modules=new Map();
async function moduleAt(url){
 if(modules.has(url))return modules.get(url);
 const response=await fetch(url);assert.equal(response.status,200,`Cannot load ${url}`);
 const module=new vm.SourceTextModule(await response.text(),{context,identifier:url,initializeImportMeta(meta){meta.url=url;},
  async importModuleDynamically(name,parent){const child=await moduleAt(new URL(name,parent.identifier).href);if(child.status==='unlinked')await child.link((specifier,referrer)=>moduleAt(new URL(specifier,referrer.identifier).href));if(child.status==='linked')await child.evaluate();return child;},
 });modules.set(url,module);return module;
}
const timeout=setTimeout(()=>{console.error('Desktop worker initialization timed out');process.exit(1);},45000);
try{
 const worker=await moduleAt(workerUrl);await worker.link((name,parent)=>moduleAt(new URL(name,parent.identifier).href));await worker.evaluate();
 await context.onmessage({data:{id:1,type:'init',origin}});
 assert.equal(messages[0]?.error,undefined,messages[0]?.error);assert.equal(messages[0]?.id,1);
 let closed=false;
 await context.onmessage({data:{id:2,type:'detect',bitmap:{width:640,height:360,close(){closed=true;}},options:{threshold:0.45,max:16,detail:false,tableDetail:false,frontTables:true}}});
 assert.equal(messages[1]?.error,undefined,messages[1]?.error);assert.ok(Array.isArray(messages[1]?.detections));assert.equal(closed,true);
 console.log(JSON.stringify({initialized:true,inferenceCompleted:true,modelSessions:2,windowPresent:vm.runInContext('typeof window',context),detections:messages[1].detections.length}));
}finally{clearTimeout(timeout);}
