import {spawn} from 'node:child_process';
import {resolve as resolvePath} from 'node:path';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

/** @param {{root:string,log:(message:string)=>void,spawnProcess?:typeof spawn,timeoutMs?:number}} options */
export function startOllamaWithLogging({root,log,spawnProcess=spawn,timeoutMs=45000}){
 return new Promise(finish=>{
  const child=spawnProcess(process.execPath,[resolvePath(root,'scripts/ensure-ollama.mjs')],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',chunk=>log(`Ollama: ${chunk.toString().trim()}`));
  child.stderr.on('data',chunk=>log(`Ollama: ${chunk.toString().trim()}`));
  const timer=setTimeout(()=>{child.kill();log('Ollama startup is taking longer than expected.');finish();},timeoutMs);
  child.once('error',error=>{clearTimeout(timer);log(`Ollama: ${error.message}`);finish();});
  child.once('close',code=>{clearTimeout(timer);if(code)log(`Ollama helper exited with code ${code}.`);finish();});
 });
}

/** Retry only servers created by this launcher, never unrelated applications.
 * @param {{spawnServer:(attempt:number)=>{failure:()=>Error|undefined,stop:()=>Promise<void>,diagnostics:()=>string},isReady:()=>Promise<boolean>,onFailure?:(message:string,attempt:number)=>void,maxAttempts?:number,timeoutMs?:number,wait?:(ms:number)=>Promise<void>,now?:()=>number}} options */
export async function startServerWithRetry({spawnServer,isReady,onFailure=()=>{},maxAttempts=3,timeoutMs=120000,wait=sleep,now=Date.now}){
 let lastError;
 for(let attempt=1;attempt<=maxAttempts;attempt++){
  if(await isReady())return;
  let server;
  try{
   server=spawnServer(attempt);
   const deadline=now()+timeoutMs;
   while(!await isReady()){
    const failure=server.failure();if(failure)throw failure;
    if(now()>=deadline)throw new Error('Сервер не успел запуститься за две минуты.');
    await wait(1000);
   }
   return;
  }catch(error){
   // Another launch may have become ready while this process was exiting.
   if(await isReady())return;
   await server?.stop();
   const details=server?.diagnostics().trim()||'';
   lastError=new Error(`${error.message}${details?'\n\n'+details:''}`);
   onFailure(lastError.message,attempt);
   if(attempt<maxAttempts)await wait(attempt*1500);
  }
 }
 throw new Error(`Не удалось запустить сервер после ${maxAttempts} попыток.\n${lastError?.message||''}`);
}
