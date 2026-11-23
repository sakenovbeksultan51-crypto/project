import {existsSync,mkdirSync,openSync,closeSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

// Start the optional local model server alongside development, without opening
// a terminal window. Existing Ollama installations and running servers are reused.
const root=fileURLToPath(new URL('../',import.meta.url));
if(process.platform!=='win32'||process.env.ASSISTANT_PROVIDER==='openai'||process.env.ASSISTANT_PROVIDER==='local')process.exit(0);
async function ready(){try{return (await fetch('http://127.0.0.1:11434/api/version',{signal:AbortSignal.timeout(1000)})).ok;}catch{return false;}}
if(await ready())process.exit(0);
const candidates=[resolve(root,'.data/ollama-runtime/ollama.exe'),process.env.LOCALAPPDATA&&join(process.env.LOCALAPPDATA,'Programs/Ollama/ollama.exe')].filter(Boolean);
const executable=candidates.find(path=>existsSync(path));
if(!executable){console.log('TableFlow: Ollama is not installed; assistant summaries remain available.');process.exit(0);}
mkdirSync(resolve(root,'.data'),{recursive:true});
const log=openSync(resolve(root,'.data/ollama-server.log'),'a');
const child=spawn(executable,['serve'],{cwd:root,windowsHide:true,detached:true,stdio:['ignore',log,log],env:{...process.env,OLLAMA_HOST:'127.0.0.1:11434',OLLAMA_NO_CLOUD:'1'}});
child.on('error',error=>console.error('TableFlow: could not start Ollama:',error.message));
child.unref();closeSync(log);
for(let attempt=0;attempt<20;attempt++){if(await ready()){console.log('TableFlow: local Ollama server is ready.');process.exit(0);}await new Promise(resolve=>setTimeout(resolve,300));}
console.log('TableFlow: Ollama is starting; check the connection in Assistant.');
