import {request} from 'node:https';

/** Vercel's Node transport: bypass framework fetch wrappers and use IPv4.
 * This adapter is only included through the Vercel cloudflare:workers alias. */
export const telegramFetch:typeof fetch=async(input,init)=>{
 const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
 if(url.protocol!=='https:'||url.hostname!=='api.telegram.org'||url.port||url.username||url.password)throw new Error('Unsupported Telegram endpoint');
 if(init?.body!=null&&typeof init.body!=='string')throw new Error('Telegram requests require JSON text');
 const headers:Record<string,string>={};new Headers(init?.headers).forEach((value,key)=>{headers[key]=value;});
 return new Promise<Response>((resolve,reject)=>{
  let phase='dns',received=0,status=0;
  const req=request(url,{method:init?.method||'GET',headers,family:4,agent:false,signal:init?.signal??undefined},res=>{
   phase='body';status=res.statusCode||0;
   const chunks:Buffer[]=[];let length=0;
   res.on('error',reject);
   res.on('data',(chunk:Buffer)=>{
    length+=chunk.length;received=length;
    if(length>1024*1024){req.destroy(new Error('Telegram response exceeded limit'));return;}
    chunks.push(chunk);
   });
   res.on('end',()=>{
    const responseHeaders=new Headers();
    for(const [key,value] of Object.entries(res.headers))if(value!==undefined)responseHeaders.set(key,Array.isArray(value)?value.join(', '):value);
    resolve(new Response(Buffer.concat(chunks).toString('utf8'),{status:res.statusCode||502,headers:responseHeaders}));
   });
  });
  req.on('socket',socket=>{socket.once('lookup',()=>{phase='connect';});socket.once('connect',()=>{phase='tls';});socket.once('secureConnect',()=>{phase='response';});});
  req.on('error',(error:Error&{code?:string})=>{console.error('[telegram-transport]',{phase,status,received,code:/^[A-Z_]+$/.test(error.code||'')?error.code:'unknown'});reject(error);});
  req.end(init?.body??undefined);
 });
};
