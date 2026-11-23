import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {startServerWithRetry,startOllamaWithLogging} from '../scripts/local-server.mjs';

test('Ollama receives its actual script path and startup waits for the helper',async()=>{
 const child=Object.assign(new EventEmitter(),{stdout:new EventEmitter(),stderr:new EventEmitter(),kill(){}});
 const messages:string[]=[];let argumentsPassed:unknown,executablePassed:unknown,settled=false;
 const spawnProcess=((executable:unknown,args:unknown)=>{executablePassed=executable;argumentsPassed=args;return child;}) as unknown as typeof spawn;
 const root=resolve('test-project');
 const startup=startOllamaWithLogging({root,log:message=>messages.push(message),spawnProcess});
 startup.then(()=>{settled=true;});await Promise.resolve();
 assert.equal(settled,false);assert.equal(executablePassed,process.execPath);
 assert.deepEqual(argumentsPassed,[resolve(root,'scripts/ensure-ollama.mjs')]);
 child.stdout.emit('data',Buffer.from('Ollama ready'));child.emit('close',0);await startup;
 assert.match(messages.join('\n'),/Ollama ready/);
});

test('Ollama startup errors are recorded without preventing website startup',async()=>{
 const child=Object.assign(new EventEmitter(),{stdout:new EventEmitter(),stderr:new EventEmitter(),kill(){}});
 const messages:string[]=[];
 const startup=startOllamaWithLogging({root:resolve('test-project'),log:message=>messages.push(message),spawnProcess:(()=>child) as unknown as typeof spawn});
 child.stderr.emit('data',Buffer.from('Real startup error'));child.emit('close',1);await startup;
 assert.match(messages.join('\n'),/Real startup error/);assert.match(messages.join('\n'),/exited with code 1/);
});

test('a ready server is reused without starting a duplicate',async()=>{
 await startServerWithRetry({isReady:async()=>true,spawnServer:()=>{throw new Error('Must not spawn a duplicate');}});
});

test('a failed cold start is stopped and automatically retried',async()=>{
 let started=0,stopped=0;const failures:string[]=[];
 await startServerWithRetry({isReady:async()=>started===2,wait:async()=>{},onFailure:message=>failures.push(message),spawnServer:()=>{
  started++;return {failure:()=>new Error('Exit code 1'),stop:async()=>{stopped++;},diagnostics:()=>`Attempt ${started}: temporary startup failure`};
 }});
 assert.equal(started,2);assert.equal(stopped,1);assert.match(failures[0],/temporary startup failure/);
});

test('persistent errors stop after three attempts and preserve the real diagnostic',async()=>{
 let started=0,stopped=0;const failures:string[]=[];
 await assert.rejects(startServerWithRetry({isReady:async()=>false,wait:async()=>{},onFailure:message=>failures.push(message),spawnServer:()=>{
  started++;return {failure:()=>new Error('Exit code 1'),stop:async()=>{stopped++;},diagnostics:()=>`Actual stderr for attempt ${started}`};
 }}),/после 3 попыток[\s\S]*Actual stderr for attempt 3/);
 assert.equal(started,3);assert.equal(stopped,3);assert.equal(failures.length,3);
 assert.match(failures[0],/stderr for attempt 1/);assert.match(failures[1],/stderr for attempt 2/);
});

test('a startup that never becomes ready is timed out and cleaned up',async()=>{
 let clock=0,stopped=0;
 await assert.rejects(startServerWithRetry({isReady:async()=>false,maxAttempts:1,timeoutMs:2000,now:()=>clock,wait:async ms=>{clock+=ms;},spawnServer:()=>({failure:()=>undefined,stop:async()=>{stopped++;},diagnostics:()=>''})}),/не успел запуститься/);
 assert.equal(stopped,1);assert.equal(clock,2000);
});

test('an already recovered site wins the race against a failed startup',async()=>{
 const readiness=[false,false,true];let stopped=0;
 await startServerWithRetry({isReady:async()=>readiness.shift()||false,spawnServer:()=>({failure:()=>new Error('Exit code 1'),stop:async()=>{stopped++;},diagnostics:()=>''})});
 assert.equal(stopped,0);
});
