import {createHash} from 'node:crypto';
import {existsSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {resolve,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
function inputs(directory){return readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(entry=>entry.isDirectory()?inputs(resolve(directory,entry.name)):[resolve(directory,entry.name)]);}
export function desktopFingerprint(){
 const hash=createHash('sha256');
 const files=[...inputs(resolve(root,'src')),...inputs(resolve(root,'desktop')),resolve(root,'app/globals.css'),resolve(root,'package.json'),resolve(root,'package-lock.json'),fileURLToPath(import.meta.url)];
 for(const file of files){hash.update(relative(root,file));hash.update(readFileSync(file));}
 return hash.digest('hex');
}
export async function ensureDesktopBuild({force=false}={}){
 const buildId=desktopFingerprint(),output=resolve(root,'.data/desktop-app'),manifest=resolve(output,'desktop-build.json');
 if(!force&&existsSync(manifest)&&existsSync(resolve(output,'index.html'))&&existsSync(resolve(output,'server.mjs'))){
  try{if(JSON.parse(readFileSync(manifest,'utf8')).buildId===buildId)return {buildId,rebuilt:false};}catch{}
 }
 console.log('TableFlow: building the desktop application...');
 const {build}=await import('vite'),configFile=resolve(root,'desktop/vite.config.ts');
 await build({configFile,mode:'desktop-client'});
 await build({configFile,mode:'desktop-server'});
 writeFileSync(manifest,JSON.stringify({buildId,builtAt:new Date().toISOString()}));
 return {buildId,rebuilt:true};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)console.log(JSON.stringify(await ensureDesktopBuild({force:process.argv.includes('--force')})));
