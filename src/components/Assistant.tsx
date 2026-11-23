'use client';
import {useEffect,useRef,useState} from 'react';
import {Bot,MessageSquare,ArrowUp,Square,RotateCcw,Sparkles,Clock3,Armchair,ChartNoAxesCombined,Info,Plug,LoaderCircle} from 'lucide-react';
import type {AppState,Table} from '../lib/engine';
import type {AssistantReply,AssistantStatus,ChatMessage} from '../lib/assistant';
import {formatForecastTime} from '../lib/table-forecast';

type Message=ChatMessage&{mode?:'llm'|'local';snapshotAt?:number;model?:string};
const suggestions=[{icon:Armchair,text:'Какие столы сейчас свободны?'},{icon:Clock3,text:'Какие столы скоро освободятся?'},{icon:ChartNoAxesCombined,text:'Когда была самая высокая загрузка?'},{icon:Sparkles,text:'Объясни байесовский прогноз простыми словами'}];

export function AssistantMethod(){
 return <section className="panel forecast-method"><div className="panel-head"><div><h2>Как работает генеративный помощник</h2><p>Неделя 10 · LLMs; Generative AI; AI Safety</p></div><Bot size={21}/></div><div className="forecast-method-body"><p>Теория: большая языковая модель (LLM) обучается на текстах и генерирует ответ, последовательно предсказывая следующий токен с учётом запроса и контекста. Поэтому она может вести диалог и объяснять результат своими словами. Это генеративный ИИ.</p><p>Практика: при каждом вопросе TableFlow рассчитывает свежую сводку текущей смены: свободные и занятые столы, очередь, среднее время посещений, байесовские вероятности и пиковый час за последние 8 часов. Эта сводка и последние сообщения диалога передаются модели. Специальные инструкции требуют опираться на данные и говорить, когда информации недостаточно. Дообучение LLM на видеозаписи не выполняется.</p><div className="forecast-formula">Вопрос + история диалога + свежие данные зала → LLM → ответ на естественном языке</div><p>Надёжность: видео, имена гостей и заметки не входят в сводку для модели. Помощник предлагает действия, а изменения столов подтверждает сотрудник в обычных разделах. Прогноз ухода не гарантирует готовность стола. Текст LLM может содержать ошибки — важные числа можно сверить с прогнозами и аналитикой.</p><p>Подключение: локальная модель через Ollama или облачная через OpenAI API. При отсутствии или сбое модели включается явно обозначенный режим локальных сводок по типовым вопросам; он не является LLM и не выполняет генерацию свободных ответов.</p></div></section>;
}

export default function Assistant({state,tables,active}:{state:AppState;tables:Table[];active:boolean}){
 const [messages,setMessages]=useState<Message[]>([]),[question,setQuestion]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [connection,setConnection]=useState<AssistantStatus|null>(null),[checking,setChecking]=useState(false),[notice,setNotice]=useState('');
 const requestRef=useRef<AbortController|null>(null),end=useRef<HTMLDivElement>(null),textarea=useRef<HTMLTextAreaElement>(null);
 useEffect(()=>()=>{requestRef.current?.abort();requestRef.current=null;},[]);
 useEffect(()=>{if(!active)return;const controller=new AbortController();checkConnection(controller.signal);return()=>controller.abort();},[active]);
 useEffect(()=>{if(active)end.current?.scrollIntoView?.({block:'nearest',behavior:'smooth'});},[messages,busy,active]);
 async function checkConnection(signal?:AbortSignal){
  setChecking(true);
  try{const response=await fetch('/api/assistant',{signal});if(!response.ok)throw new Error();const data=await response.json() as AssistantStatus;if(!signal?.aborted)setConnection(data);}
  catch{if(!signal?.aborted)setConnection({available:false,provider:'local',notice:'Не удалось проверить модель. Попробуйте ещё раз.'});}
  finally{if(!signal?.aborted)setChecking(false);}
 }
 function clear(){requestRef.current?.abort();requestRef.current=null;setBusy(false);setMessages([]);setQuestion('');setError('');setNotice('');}
 function stop(){requestRef.current?.abort();requestRef.current=null;setBusy(false);setMessages(list=>[...list,{role:'assistant',content:'Ответ остановлен. Можно задать новый вопрос.'}]);}
 async function send(value=question){
  const content=value.trim();if(!content||content.length>2000||busy)return;
  const next:Message[]=[...messages,{role:'user',content}];setMessages(next);setQuestion('');setError('');setNotice('');setBusy(true);
  const controller=new AbortController();requestRef.current=controller;
  // Keep whole exchanges, starting with a user message and ending with this question.
  let history=next.slice(-13).map(({role,content})=>({role,content}));
  while(history.length>1&&history.reduce((sum,m)=>sum+m.content.length,0)>20000)history=history.slice(2);
  try{
   const response=await fetch('/api/assistant',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({state,tableIds:tables.map(t=>t.id),messages:history})});
   const data=await response.json() as AssistantReply&{error?:string};
   if(!response.ok||typeof data.answer!=='string')throw new Error(data.error||'Не удалось получить ответ.');
   if(requestRef.current!==controller)return;
   setMessages([...next,{role:'assistant',content:data.answer,mode:data.mode,snapshotAt:data.snapshotAt,model:data.model}]);setNotice(data.notice||'');
   setConnection(data.mode==='llm'?{available:true,provider:connection?.provider==='openai'?'openai':'ollama',model:data.model}:{available:false,provider:'local',notice:data.notice});
  }catch(e){
   if(requestRef.current!==controller)return;
   setMessages(messages);setQuestion(content);setError(e instanceof Error?e.message:'Не удалось получить ответ. Попробуйте ещё раз.');
  }finally{if(requestRef.current===controller){requestRef.current=null;setBusy(false);}}
 }
 const free=tables.filter(t=>t.status==='free').length,occupied=tables.filter(t=>t.status==='occupied').length;
 return <div className="assistant-layout">
  <section className="panel assistant-chat" aria-label="Чат с помощником">
   <div className="panel-head"><div className="assistant-heading"><span className="assistant-avatar"><Bot size={23}/></span><div><h2>Помощник TableFlow</h2><p>{checking?'Проверяем подключение…':connection?.available?`LLM · ${connection.model}`:'Режим сводок · LLM не подключена'}</p></div></div><button className="icon-btn" aria-label="Очистить диалог" title="Очистить диалог" disabled={!messages.length&&!busy} onClick={clear}><RotateCcw size={18}/></button></div>
   <div className="assistant-messages" role="log" aria-label="Сообщения помощника" aria-live="polite" aria-busy={busy}>
    {!messages.length&&<div className="assistant-welcome"><span><Sparkles size={28}/></span><h3>Спросите о своём зале</h3><p>Помогу найти свободный стол, оценить ожидание и разобраться в данных смены.</p><div className="assistant-suggestions">{suggestions.map(s=><button key={s.text} disabled={busy} onClick={()=>send(s.text)}><s.icon size={18}/><span>{s.text}</span><ArrowUp size={14}/></button>)}</div></div>}
    {messages.map((message,i)=><article className={`assistant-message ${message.role}`} key={i}><span className="assistant-message-author">{message.role==='user'?'Вы':message.mode==='llm'?'Помощник · LLM':message.mode==='local'?'Помощник · локальная сводка':'Помощник'}</span><div>{message.content}</div>{message.snapshotAt&&<small>Данные на {formatForecastTime(message.snapshotAt,message.snapshotAt)}{message.model?` · ${message.model}`:''}</small>}</article>)}
    {busy&&<div className="assistant-thinking" role="status"><LoaderCircle size={16} className="spin"/>Готовлю ответ по данным зала…</div>}<div ref={end}/>
   </div>
   {notice&&<div className="assistant-notice"><Info size={15}/><span>{notice}</span></div>}
   {error&&<div className="error" role="alert">{error}</div>}
   <form className="assistant-composer" onSubmit={e=>{e.preventDefault();send();}}><label className="sr-only" htmlFor="assistant-question">Ваш вопрос помощнику</label><textarea id="assistant-question" ref={textarea} value={question} maxLength={2000} rows={2} placeholder="Например: когда освободится стол 3?" disabled={busy} onChange={e=>setQuestion(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();send();}}}/>{busy?<button type="button" className="assistant-send" aria-label="Остановить ответ" onClick={stop}><Square size={17}/></button>:<button type="submit" className="assistant-send" aria-label="Отправить вопрос" disabled={!question.trim()}><ArrowUp size={20}/></button>}<small>Enter — отправить · Shift + Enter — новая строка</small></form>
  </section>
  <aside className="assistant-aside"><section className="panel assistant-context"><span className="eyebrow">КОНТЕКСТ ПОМОЩНИКА</span><h3>Текущая смена</h3><span className="pill neutral">{state.mode==='demo'?'Учебные данные':'Рабочие данные'}</span><dl><div><dt>Свободно столов</dt><dd>{free}</dd></div><div><dt>Занято столов</dt><dd>{occupied}</dd></div><div><dt>В ожидании групп</dt><dd>{state.queue.length}</dd></div><div><dt>Завершено посещений</dt><dd>{state.visits.filter(v=>tables.some(t=>t.id===v.tableId)&&v.end>v.start&&v.end<=Date.now()).length}</dd></div></dl><p><Info size={15}/>Данные обновляются при каждом вопросе. Ответы относятся к моменту запроса.</p></section>
   <section className="panel assistant-connection"><div className="assistant-section-title"><Plug size={19}/><h3>Подключение модели</h3></div><p>{connection?.available?`Подключена ${connection.model}. Доступен свободный диалог.`:connection?.notice||'Проверяем доступность языковой модели.'}</p><button className="btn wide" disabled={checking||busy} onClick={()=>checkConnection()}><RotateCcw size={15}/>{checking?'Проверяем…':'Проверить подключение'}</button><details><summary>Как подключить LLM</summary><p>Для локального чата установите <a href="https://ollama.com/download/windows" target="_blank" rel="noreferrer">Ollama</a> и загрузите модель:</p><code>ollama pull qwen2.5:3b</code><p>Оставьте Ollama запущенной и нажмите «Проверить подключение». Если модель одна, TableFlow выберет её автоматически.</p><p>Для OpenAI API задайте на сервере ASSISTANT_PROVIDER=openai, OPENAI_API_KEY и OPENAI_MODEL. Пример настройки — в .dev.vars.example проекта. После изменения настроек перезапустите сервер сайта.</p></details></section>
   <div className="assistant-footnote"><MessageSquare size={17}/><p>Помощник отвечает и предлагает действия. Состояния столов меняются через обычные разделы TableFlow.</p></div>
  </aside>
 </div>;
}
