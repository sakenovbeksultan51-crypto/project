import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
function ortRuntime(){return {name:'tableflow-desktop-ort',enforce:'pre' as const,resolveId(id:string){if(id==='tableflow:ort-runtime')return {id:'/ort/ort-runtime.mjs',external:true};}};}

// The desktop shortcut uses a built React client and Node server. Cloudflare
// Workers remain available through the original hosting/development config.
export default defineConfig(({mode})=>({
 root:resolve(root,'desktop'),publicDir:false,
 plugins:mode==='desktop-server'?[]:[ortRuntime(),react()],
 css:{postcss:{plugins:[tailwindcss()]}},
 worker:{format:'es',plugins:()=>[ortRuntime()]},
 build:{
  outDir:resolve(root,'.data/desktop-app'),emptyOutDir:mode!=='desktop-server',sourcemap:false,
  ...(mode==='desktop-server'?{ssr:resolve(root,'desktop/server.ts'),rollupOptions:{output:{entryFileNames:'server.mjs'}}}:{}),
 },
}));
