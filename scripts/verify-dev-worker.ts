/** Load the actual dev-server worker module graph without any window/document.
 * This checks worker startup and real model initialization, not browser playback.
 * Run: node --experimental-vm-modules --import tsx scripts/verify-dev-worker.ts
 */
import vm from 'node:vm';
import assert from 'node:assert/strict';

const origin='http://localhost:3000';
const responses:{id:number;error?:string;detections?:unknown[]}[]=[];
const context=vm.createContext({
 console,URL,Blob,fetch,performance,crypto,WebAssembly,TextDecoder,TextEncoder,
 ArrayBuffer,SharedArrayBuffer,Uint8Array,Float32Array,
 location:new URL(origin+'/src/workers/vision.worker.ts?worker_file&type=module'),
 setTimeout,clearTimeout,setInterval,clearInterval,structuredClone,
 importScripts(){throw new Error('Unexpected classic-worker import');},
 postMessage(message:typeof responses[number]){responses.push(message);},
 // Startup allocates the canvas; no drawing is performed by this smoke check.
 OffscreenCanvas:class {getContext(){return {};}}
});
vm.runInContext('self=globalThis; WorkerGlobalScope=class {static [Symbol.hasInstance](){return true;}}',context);
const modules=new Map<string,vm.SourceTextModule>();
async function getModule(url:string):Promise<vm.SourceTextModule>{
 const cached=modules.get(url);if(cached)return cached;
 const response=await fetch(url);assert.equal(response.status,200,`Cannot load ${url}`);
 const source=await response.text();
 const module=new vm.SourceTextModule(source,{
  context,identifier:url,
  initializeImportMeta(meta){meta.url=url;},
  async importModuleDynamically(specifier,referrer){
   const child=await getModule(new URL(specifier,referrer.identifier).href);
   if(child.status==='unlinked')await child.link((name,parent)=>getModule(new URL(name,parent.identifier).href));
   if(child.status==='linked')await child.evaluate();return child;
  }
 });
 modules.set(url,module);return module;
}
const worker=await getModule(origin+'/src/workers/vision.worker.ts?worker_file&type=module');
await worker.link((name,parent)=>getModule(new URL(name,parent.identifier).href));
await worker.evaluate();
const timer=setTimeout(()=>{console.error('Worker startup timed out');process.exit(1);},30000);
try{
 await context.onmessage({data:{id:1,type:'init',origin}});
 assert.equal(responses.length,1);assert.equal(responses[0].error,undefined,responses[0].error);
 assert.ok(Array.isArray(responses[0].detections));assert.equal(responses[0].detections.length,0);
 assert.ok(![...modules.keys()].some(url=>url.includes('/@vite/client')),'Page-only dev client must not enter the worker');
 console.log(JSON.stringify({initialized:true,windowPresent:vm.runInContext('typeof window',context),modelSessions:2,moduleCount:modules.size},null,2));
}finally{clearTimeout(timer);}
