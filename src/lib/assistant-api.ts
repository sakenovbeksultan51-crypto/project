import {validateState} from './engine';
import {requestOwner} from './request-owner';
import {ASSISTANT_INSTRUCTIONS,buildAssistantContext,describeAssistantContext,localAssistantAnswer,type AssistantStatus,type ChatMessage} from './assistant';

export type AssistantEnv={ASSISTANT_PROVIDER?:string;OPENAI_API_KEY?:string;OPENAI_MODEL?:string;OLLAMA_BASE_URL?:string;OLLAMA_MODEL?:string;AI_GATEWAY_API_KEY?:string;AI_GATEWAY_OIDC_TOKEN?:string;AI_GATEWAY_MODEL?:string};
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const FALLBACK_NOTICE='LLM сейчас недоступна. Ответ составлен локально по данным зала.';

export function createAssistantAPI(env:AssistantEnv,fetcher:typeof fetch=fetch){
 const provider=env.ASSISTANT_PROVIDER||(env.OPENAI_API_KEY?'openai':env.AI_GATEWAY_API_KEY||env.AI_GATEWAY_OIDC_TOKEN?'gateway':'ollama');
 const gatewayModel=env.AI_GATEWAY_MODEL||'nvidia/nemotron-3.5-lightning-free';
 const gatewayToken=env.AI_GATEWAY_API_KEY||env.AI_GATEWAY_OIDC_TOKEN;
 async function gatewayRequest(input:unknown,instructions?:string,maxTokens=1200){
  const response=await fetcher('https://ai-gateway.vercel.sh/v1/responses',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${gatewayToken}`},signal:AbortSignal.timeout(60000),body:JSON.stringify({model:gatewayModel,input,instructions,max_output_tokens:maxTokens,store:false})});
  if(!response.ok){
   const error=await response.json().catch(()=>null) as {error?:{message?:string}}|null;
   if(response.status===403&&/credit card/i.test(error?.error?.message||''))throw new Error('Vercel AI Gateway требует добавить карту в аккаунте Vercel. Пока доступны сводки по данным зала.');
   if(response.status===402)throw new Error('Лимит AI Gateway исчерпан. Пока доступны сводки по данным зала.');
   throw new Error(`Языковая модель временно недоступна (AI Gateway HTTP ${response.status}). Пока доступны сводки по данным зала.`);
  }
  return response.json() as Promise<{output?:{type:string;content?:{type:string;text?:string}[]}[]}>;
 }
 const ollamaBase=(env.OLLAMA_BASE_URL||'http://127.0.0.1:11434').replace(/\/$/,'');
 async function status(probeGateway=false):Promise<AssistantStatus>{
  if(provider==='gateway'){
   if(!gatewayToken)return {available:false,provider:'local',notice:'Для AI Gateway нужен серверный ключ или OIDC-токен проекта Vercel.'};
   if(probeGateway)try{await gatewayRequest([{type:'message',role:'user',content:'Reply OK.'}],undefined,32);}catch(error){return {available:false,provider:'local',notice:error instanceof Error?error.message:FALLBACK_NOTICE};}
   return {available:true,provider:'gateway',model:gatewayModel};
  }
  if(provider==='openai')return env.OPENAI_API_KEY&&env.OPENAI_MODEL?{available:true,provider:'openai',model:env.OPENAI_MODEL}:{available:false,provider:'local',notice:'Для OpenAI задайте серверные OPENAI_API_KEY и OPENAI_MODEL.'};
  if(provider==='local')return {available:false,provider:'local',notice:'Включён режим сводок. Подключите LLM для свободного диалога.'};
  if(provider!=='ollama')return {available:false,provider:'local',notice:'Проверьте ASSISTANT_PROVIDER: gateway, ollama, openai или local.'};
  try{
   const response=await fetcher(`${ollamaBase}/api/tags`,{signal:AbortSignal.timeout(2500)});
   if(!response.ok)throw new Error();
   const data=await response.json() as {models?:{name:string}[]};
   const models=Array.isArray(data.models)?data.models.filter(m=>typeof m.name==='string'):[];
   const model=env.OLLAMA_MODEL||models.find(m=>!/embed/i.test(m.name))?.name;
   const installed=model&&models.some(m=>m.name===model||m.name===`${model}:latest`);
   return installed?{available:true,provider:'ollama',model}:{available:false,provider:'local',notice:'Ollama работает, но нужная модель не установлена. Загрузите её и проверьте подключение.'};
  }catch{return {available:false,provider:'local',notice:'Ollama не запущена. Пока доступны сводки по данным зала.'};}
 }
 async function GET(request:Request){if(!requestOwner(request))return reply({error:'Требуется вход в аккаунт.'},401);return reply(await status(true));}
 async function POST(request:Request){
  if(!requestOwner(request))return reply({error:'Требуется вход в аккаунт.'},401);
  const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return reply({error:'Недопустимый источник запроса.'},403);
  if(Number(request.headers.get('content-length'))>600_000)return reply({error:'Слишком большой запрос.'},413);
  let body;
  try{const raw=await request.text();if(raw.length>600_000)return reply({error:'Слишком большой запрос.'},413);body=JSON.parse(raw);}catch{return reply({error:'Некорректный запрос.'},400);}
  const {state,tableIds,messages}=body||{};
  if(!validateState(state)||!Array.isArray(tableIds)||tableIds.length>12||!tableIds.every((id:unknown)=>Number.isInteger(id)&&state.tables.some(t=>t.id===id))||new Set(tableIds).size!==tableIds.length)return reply({error:'Некорректные данные зала.'},400);
  if(!Array.isArray(messages)||messages.length<1||messages.length>17||!messages.every((m:ChatMessage,i:number)=>m&&m.role===(i%2?'assistant':'user')&&typeof m.content==='string'&&m.content.trim().length>0&&m.content.length<=4000)||messages.at(-1)?.role!=='user'||messages.reduce((s:number,m:ChatMessage)=>s+m.content.length,0)>24000)return reply({error:'Вопрос или история диалога слишком длинные.'},400);
  const now=Date.now(),context=buildAssistantContext(state,tableIds,now),connection=await status();
  const fallback=(notice:string)=>reply({answer:localAssistantAnswer(messages,context),mode:'local',snapshotAt:now,notice});
  if(!connection.available)return fallback(connection.notice||FALLBACK_NOTICE);
  const partyMatch=[...messages].reverse().filter((m:ChatMessage)=>m.role==='user').map((m:ChatMessage)=>m.content.match(/(?:^|\D)(\d{1,2})\s*(?:гост|чел|персон|мест|guests|people)/i)).find(Boolean);
  const party=partyMatch?Number(partyMatch[1]):null;
  const selection=party?context.seatingOptions.find(option=>option.partySize===party):null;
  const seating=selection?`\n\nПроверенный ответ для компании из ${party} гостей: ${selection.tableIds.length?selection.tableIds.map(id=>`стол №${id} (${context.tables.find(t=>t.id===id)!.capacity} мест)`).join(', '):'подходящих свободных столов нет'}.`:'';
  const instructions=ASSISTANT_INSTRUCTIONS+'\n\nПоследний снимок зала:\n'+describeAssistantContext(context)+seating;
  try{
   let answer='';
   if(connection.provider==='gateway'){
    const data=await gatewayRequest(messages.map((message:ChatMessage)=>({type:'message',...message})),instructions);
    answer=(data.output||[]).filter(item=>item.type==='message').flatMap(item=>item.content||[]).filter(item=>item.type==='output_text').map(item=>item.text||'').join('\n').trim();
   }else if(connection.provider==='openai'){
    const response=await fetcher('https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${env.OPENAI_API_KEY}`},signal:AbortSignal.timeout(90000),body:JSON.stringify({model:connection.model,instructions,input:messages,store:false,max_output_tokens:1200})});
    if(!response.ok)throw new Error();
    const data=await response.json() as {output?:{type:string;content?:{type:string;text?:string}[]}[]};
    answer=(data.output||[]).filter(item=>item.type==='message').flatMap(item=>item.content||[]).filter(item=>item.type==='output_text').map(item=>item.text||'').join('\n').trim();
   }else{
    const response=await fetcher(`${ollamaBase}/api/chat`,{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(120000),body:JSON.stringify({model:connection.model,messages:[{role:'system',content:instructions},...messages],stream:false,options:{temperature:0.3,num_predict:900,num_ctx:16384}})});
    if(!response.ok)throw new Error();
    const data=await response.json() as {message?:{content?:string}};
    answer=typeof data.message?.content==='string'?data.message.content.trim():'';
   }
   if(!answer)throw new Error();
   return reply({answer:answer.slice(0,4000),mode:'llm',model:connection.model,snapshotAt:now});
  }catch(error){return fallback(connection.provider==='gateway'&&error instanceof Error?error.message:FALLBACK_NOTICE);}
 }
 return {GET,POST};
}
