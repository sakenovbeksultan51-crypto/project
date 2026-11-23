import {useState,useRef,useEffect,useCallback} from 'react';
import {AppState,Mode,initialState,validateState} from './engine';
export function useWorkspace(){
 const [mode,setMode]=useState<Mode>('live'),[state,setView]=useState<AppState|null>(null),[sync,setSync]=useState('Загрузка смены…');
 const current=useRef<AppState|null>(null),dirty=useRef(false),revision=useRef(0),saving=useRef(false),blocked=useRef(false),generation=useRef(0);
 const [reloadCounter,reload]=useState(0);
 useEffect(()=>{
   const id=++generation.current;current.current=null;setView(null);dirty.current=false;blocked.current=false;saving.current=false;setSync('Загрузка смены…');
   const controller=new AbortController();
   fetch(`/api/workspace?mode=${mode}`,{signal:controller.signal}).then(async r=>{if(!r.ok)throw new Error('Сервер недоступен');return r.json() as Promise<{state:AppState|null;revision:number}>;}).then(data=>{
     if(id!==generation.current)return;revision.current=data.revision;const value=data.state&&validateState(data.state)?data.state:initialState(mode);current.current=value;setView(value);setSync('Сохранено');dirty.current=!data.state;
   }).catch(e=>{if(e.name==='AbortError'||id!==generation.current)return;const value=initialState(mode);current.current=value;setView(value);blocked.current=true;setSync('Нет связи · изменения не сохранены');});
   return()=>controller.abort();
 },[mode,reloadCounter]);
 const update=useCallback((value:AppState|((s:AppState)=>AppState))=>{const prev=current.current;if(!prev)return;const next=typeof value==='function'?value(prev):value;if(next===prev)return;current.current=next;setView(next);dirty.current=true;if(!blocked.current)setSync('Сохранение…');},[]);
 useEffect(()=>{
   const timer=setInterval(async()=>{
     if(!dirty.current||saving.current||blocked.current||!current.current)return;
     saving.current=true;const snapshot=current.current;const id=generation.current;dirty.current=false;
     try{const r=await fetch('/api/workspace',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:snapshot,revision:revision.current})});const data=await r.json() as {revision:number;error?:string};if(id!==generation.current)return;if(!r.ok){blocked.current=true;dirty.current=true;setSync(r.status===409?'Конфликт · загрузите свежую смену':'Нет связи · изменения не сохранены');return;}revision.current=data.revision;setSync(dirty.current?'Сохранение…':'Сохранено');}
     catch{if(id===generation.current){dirty.current=true;setSync('Нет связи · повторная попытка…');}}
     finally{if(id===generation.current)saving.current=false;}
   },1200);return()=>clearInterval(timer);
 },[]);
 useEffect(()=>{const warn=(e:BeforeUnloadEvent)=>{if(dirty.current){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[]);
 useEffect(()=>{
   let alive=true;
   const timer=setInterval(async()=>{
     if(dirty.current||saving.current||blocked.current||!current.current)return;
     const id=generation.current;
     try{const response=await fetch(`/api/workspace?mode=${mode}`,{cache:'no-store'});if(!response.ok)return;const data=await response.json() as {state:AppState|null;revision:number};
       if(!alive||id!==generation.current||dirty.current||saving.current||blocked.current||data.revision<=revision.current||!validateState(data.state))return;
       revision.current=data.revision;current.current=data.state;setView(data.state);setSync('Сохранено');
     }catch{}
   },8000);
   return()=>{alive=false;clearInterval(timer);};
 },[mode,reloadCounter]);
 return {state,update,mode,setMode,sync,reload:()=>reload(n=>n+1),hasUnsaved:()=>dirty.current};
}
