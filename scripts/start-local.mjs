import {appendFileSync,closeSync,existsSync,mkdirSync,openSync,readFileSync,statSync,unlinkSync,writeFileSync} from 'node:fs';
import {createConnection} from 'node:net';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {uptime} from 'node:os';
import {startServerWithRetry,startOllamaWithLogging} from './local-server.mjs';
import {ensureDesktopBuild} from './build-desktop.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const data=resolve(root,'.data'),url='http://localhost:3000/';
const noBrowser=process.argv.includes('--no-browser');
mkdirSync(data,{recursive:true});
const log=message=>appendFileSync(resolve(data,'tableflow-launch.log'),`${new Date().toISOString()} ${message}\n`);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let requiredBuild;

async function health(timeout=2500){
 try{const response=await fetch(url+'api/health',{signal:AbortSignal.timeout(timeout)});if(!response.ok)return null;const data=await response.json();return data.application==='TableFlow'&&data.runtime==='desktop'&&data.ready===true?data:null;}catch{return null;}
}
async function siteReady(timeout=2500){const status=await health(timeout);return !!status&&(!requiredBuild||status.buildId===requiredBuild);}
async function portBusy(){
 return new Promise(resolve=>{const socket=createConnection({host:'localhost',port:3000});const finish=value=>{socket.destroy();resolve(value);};socket.setTimeout(1000);socket.once('connect',()=>finish(true));socket.once('error',()=>finish(false));socket.once('timeout',()=>finish(false));});
}
function browser(){
 return new Promise((resolve,reject)=>{
  const child=spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{windowsHide:true,detached:true,stdio:'ignore'});
  child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});
 });
}
function acquireLock(){
 const path=resolve(data,'tableflow-launch.lock');
 try{const fd=openSync(path,'wx');writeFileSync(fd,JSON.stringify({pid:process.pid}));closeSync(fd);return true;}
 catch(error){
  if(error.code!=='EEXIST')throw error;
  let alive=false;
  try{const {pid}=JSON.parse(readFileSync(path,'utf8'));process.kill(pid,0);alive=true;}catch{}
  const modified=statSync(path).mtimeMs,age=Date.now()-modified,bootTime=Date.now()-uptime()*1000;
  if(age<1500||(alive&&age<8*60000&&modified>=bootTime-5000))return false;
  unlinkSync(path);return acquireLock();
 }
}

let locked=false;
try{
 if(process.platform!=='win32')throw new Error('Этот файл запуска предназначен для Windows.');
 if(!existsSync(resolve(root,'node_modules/vite/bin/vite.js'))&&!existsSync(resolve(root,'.data/desktop-app/server.mjs')))throw new Error('Не найдена сборка TableFlow. Выполните npm install в папке проекта.');
 locked=acquireLock();
 if(!locked){log('Another launch is already in progress.');process.exit(0);}
 const modelReady=startOllamaWithLogging({root,log});
 const build=await ensureDesktopBuild();requiredBuild=build.buildId;
 const current=await health();
 if(current&&current.buildId!==requiredBuild){
  const recordPath=resolve(data,'tableflow-server.json');
  const record=existsSync(recordPath)?JSON.parse(readFileSync(recordPath,'utf8')):null;
  if(record&&record.pid===current.pid&&resolve(record.root).toLowerCase()===resolve(root).toLowerCase()){
   log(`Restarting owned desktop server ${current.pid} after an application update.`);process.kill(current.pid);
   for(let i=0;i<20&&await portBusy();i++)await sleep(250);
  }
 }
 let launched=false;
 if(!await siteReady()){
  if(await portBusy()){
   // A previous launch may already be starting the desktop server.
   for(let attempt=0;attempt<10&&!await siteReady();attempt++)await sleep(1000);
   if(!await siteReady())throw new Error('Порт 3000 занят, но TableFlow не отвечает. Закройте другое приложение на этом порту и попробуйте снова.');
  }else{
   await startServerWithRetry({isReady:()=>siteReady(10000),onFailure:(message,attempt)=>log(`Server attempt ${attempt}/3 failed: ${message}`),spawnServer:attempt=>{
    const stdoutPath=resolve(data,'tableflow-dev.log'),stderrPath=resolve(data,'tableflow-dev-error.log');
    const marker=`\r\n--- ${new Date().toISOString()} | launch ${process.pid}, attempt ${attempt}/3 ---\r\n`;
    appendFileSync(stdoutPath,marker);appendFileSync(stderrPath,marker);
    const errorOffset=statSync(stderrPath).size;
    const output=openSync(stdoutPath,'a'),errors=openSync(stderrPath,'a');
    const child=spawn(process.execPath,[resolve(root,'.data/desktop-app/server.mjs')],{cwd:root,env:{...process.env,TABLEFLOW_ROOT:root,TABLEFLOW_PORT:'3000'},windowsHide:true,detached:true,stdio:['ignore',output,errors]});
    closeSync(output);closeSync(errors);
    let startupError,exited=false;
    child.once('error',error=>{startupError=error;exited=true;});
    child.once('exit',(code,signal)=>{startupError=new Error(`Сервер завершился с кодом ${code}${signal?`, сигнал ${signal}`:''}.`);exited=true;});child.unref();
    writeFileSync(resolve(data,'tableflow-server.json'),JSON.stringify({pid:child.pid,root,url,runtime:'desktop',buildId:requiredBuild,attempt,stdoutPath,stderrPath}));
    log(`Started server PID ${child.pid}, attempt ${attempt}/3.`);
    return {failure:()=>startupError,diagnostics:()=>readFileSync(stderrPath).subarray(errorOffset).toString('utf8').slice(-4000),stop:async()=>{
     if(exited)return;
     await new Promise(done=>{const timer=setTimeout(done,2000);child.once('exit',()=>{clearTimeout(timer);done();});child.kill();});
    }};
   }});
   launched=true;
  }
 }
 if(!noBrowser)await browser();
 await modelReady;
 log(`Ready: ${url}; new server: ${launched}`);
 console.log(JSON.stringify({status:'ready',url,launched,browserOpened:!noBrowser}));
}catch(error){
 const message=`Не удалось запустить TableFlow.\r\n\r\n${error.message}\r\n\r\nЖурнал запуска: ${resolve(data,'tableflow-launch.log')}`;
 log(message);writeFileSync(resolve(data,'tableflow-launch-error.txt'),'\uFEFF'+message,'utf16le');console.error(message);process.exitCode=1;
}finally{if(locked)try{unlinkSync(resolve(data,'tableflow-launch.lock'));}catch{}}
