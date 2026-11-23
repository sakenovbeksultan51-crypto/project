'use client';
import {useRef,useState,useEffect} from 'react';
import {Video,Upload,Play,Pause,ScanLine,LoaderCircle,Camera,Trash2,Info,Maximize,Minimize} from 'lucide-react';
import {AppState,Zone,STATUS} from '../lib/engine';
import {Detection,DynamicTableTracker,SeatingTracker} from '../lib/vision';
import {TableServiceTracker} from '../lib/table-service';
import {applyVideoFrame,resetVideoZones} from '../lib/video-frame';
import LiveMap from './LiveMap';
import RemoteCamera from './RemoteCamera';
import {CameraMessage,CameraSender,layoutMessage,tableCalibration,normalizePeople,normalizeScene,applyCalibration,applyRemoteObservations} from '../lib/camera-sync';
import {changeStatus,resetShift} from '../lib/engine';
export type VideoSession={source:string;active:boolean;frames:number;remoteRole?:''|'host'|'viewer'};
type Detector={detect:(v:HTMLVideoElement,n?:number,min?:number)=>Promise<Detection[]>;dispose:()=>void;idle?:()=>Promise<void>;detail?:boolean;tableDetail?:boolean;frontTables?:boolean};
type Props={guest?:boolean;state:AppState;update:(f:(s:AppState)=>AppState)=>void;notify:(text:string)=>void;goLive:()=>void;onSession:(v:VideoSession)=>void};
export default function VideoPanel({guest=false,state,update,notify,goLive,onSession}:Props){
 const video=useRef<HTMLVideoElement>(null),file=useRef<HTMLInputElement>(null),model=useRef<Detector|null>(null),stream=useRef<MediaStream|null>(null),objectURL=useRef(''),alive=useRef(true),running=useRef(false),timer=useRef<ReturnType<typeof setTimeout>|null>(null),epoch=useRef(0),canvas=useRef<HTMLCanvasElement>(null);
 const stage=useRef<HTMLDivElement>(null);
 const [fullscreen,setFullscreen]=useState(false);
 const latest=useRef(state);latest.current=state;
 const [remoteRole,setRemoteRole]=useState<''|'host'|'viewer'>('');
 const [frontTables,setFrontTables]=useState(true);
 const [detailed,setDetailed]=useState(false),[personThreshold,setPersonThreshold]=useState(0.45);
 const [frames,setFrames]=useState(0),[source,setSource]=useState(''),[loading,setLoading]=useState(false),[active,setActive]=useState(false),[modelReady,setModelReady]=useState(false),[error,setError]=useState(''),[count,setCount]=useState(0),[ms,setMs]=useState(0),[calibrating,setCalibrating]=useState(false),[tableId,setTableId]=useState(1),[drag,setDrag]=useState<Zone|null>(null),[aspect,setAspect]=useState(16/9);
 const send=useRef<CameraSender|null>(null),sharedEpoch=useRef(''),sentFrame=useRef(0),receivedFrame=useRef(0),layoutRevision=useRef(0),receivedRevision=useRef(0),remoteTimer=useRef<ReturnType<typeof setTimeout>|null>(null),previousShift=useRef(state.startedAt),roleRef=useRef(remoteRole);roleRef.current=remoteRole;
 const [syncReady,setSyncReady]=useState(false),[remoteEpoch,setRemoteEpoch]=useState(''),[remoteAnalysis,setRemoteAnalysis]=useState(false);
 const lastObservationAt=useRef(0);
 const pendingAuto=useRef(false),initialized=useRef(false),starting=useRef(false),tableScan=useRef(false),frameNumber=useRef(0),tableDiscovery=useRef(new DynamicTableTracker()),seatingTracker=useRef(new SeatingTracker()),serviceTracker=useRef(new TableServiceTracker());
 useEffect(()=>{onSession({source,active:active||remoteAnalysis,frames,remoteRole});},[source,active,frames,remoteRole,remoteAnalysis]);
 const anchor=useRef<{x:number;y:number}|null>(null),results=useRef<Detection[]>([]);
 function stop(){seatingTracker.current.clear();serviceTracker.current.pause();epoch.current++;running.current=false;setActive(false);if(timer.current)clearTimeout(timer.current);}
 function clearSource(){stop();serviceTracker.current.clear();lastObservationAt.current=0;tableDiscovery.current.clear();tableScan.current=false;frameNumber.current=0;initialized.current=false;setFrames(0);stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;if(objectURL.current)URL.revokeObjectURL(objectURL.current);objectURL.current='';results.current=[];}
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;running.current=false;if(timer.current)clearTimeout(timer.current);if(remoteTimer.current)clearTimeout(remoteTimer.current);stream.current?.getTracks().forEach(t=>t.stop());if(objectURL.current)URL.revokeObjectURL(objectURL.current);model.current?.dispose();};},[]);
 function transport(sender:CameraSender|null){if(!sender)seatingTracker.current.clear();send.current=sender;setSyncReady(!!sender);if(!sender)setRemoteAnalysis(false);}
 function receive(message:CameraMessage){
  if(roleRef.current==='host'){
   if(message.epoch!==sharedEpoch.current)return;
   if(message.type==='observations'&&message.frame>receivedFrame.current){receivedFrame.current=message.frame;const vw=video.current?.videoWidth||1,vh=video.current?.videoHeight||1;results.current=message.people.map(d=>({...d,bbox:[d.bbox[0]*vw,d.bbox[1]*vh,d.bbox[2]*vw,d.bbox[3]*vh]}));const now=Date.now(),calibrated=latest.current.tables.some(t=>t.roi)?latest.current:applyCalibration(latest.current,message.zones),seating=seatingTracker.current.update(message.people,1,1,calibrated.tables,now),tracking=serviceTracker.current.update(calibrated,message.scene||message.people,1,1,now,seating);if(now-lastObservationAt.current>=1000||tracking.departed?.size||tracking.servicing?.size||tracking.cleaned?.size){lastObservationAt.current=now;update(s=>applyRemoteObservations(s,message,now,tracking));}setFrames(n=>n+1);setCount(message.people.length);setMs(message.ms);setRemoteAnalysis(true);if(remoteTimer.current)clearTimeout(remoteTimer.current);remoteTimer.current=setTimeout(()=>setRemoteAnalysis(false),10000);}
   if(message.type==='calibration'){update(s=>applyCalibration(s,message.zones));}
   if(message.type==='analysis-status')setRemoteAnalysis(message.active);
  }else if(roleRef.current==='viewer'&&message.type==='layout'){
   if(message.epoch===sharedEpoch.current&&message.revision<=receivedRevision.current)return;
   const resetting=!!sharedEpoch.current&&message.epoch!==sharedEpoch.current;
   if(resetting){stop();results.current=[];setFrames(0);setCount(0);notify('Владелец сбросил смену. Для продолжения нажмите «Распознавать людей».');}
   sharedEpoch.current=message.epoch;receivedRevision.current=message.revision;setRemoteEpoch(message.epoch);
   update(s=>{if(resetting)return {...resetShift(s),tables:message.tables};let next=s;for(const t of message.tables){if(next.tables.find(x=>x.id===t.id)?.status!==t.status)next=changeStatus(next,t.id,t.status,Date.now(),t.source,t.guests);}return {...next,tables:message.tables};});
  }
 }
 useEffect(()=>{if(previousShift.current===state.startedAt)return;previousShift.current=state.startedAt;stop();results.current=[];setFrames(0);setCount(0);serviceTracker.current.clear();pendingAuto.current=false;receivedFrame.current=0;sentFrame.current=0;setRemoteAnalysis(false);if(remoteRole==='host'){sharedEpoch.current=crypto.randomUUID();layoutRevision.current=0;setRemoteEpoch(sharedEpoch.current);}},[state.startedAt]);
 useEffect(()=>{if(remoteRole==='host'&&syncReady&&sharedEpoch.current)send.current?.(layoutMessage(state,sharedEpoch.current,++layoutRevision.current));},[state.tables,remoteRole,syncReady,remoteEpoch]);
 useEffect(()=>{if(remoteRole==='viewer'&&syncReady&&sharedEpoch.current)send.current?.({type:'analysis-status',epoch:sharedEpoch.current,active});},[active,syncReady,remoteRole,remoteEpoch]);
 function editZone(id:number,roi:Zone|null){tableDiscovery.current.pin(id);seatingTracker.current.clear();const old=latest.current.tables.find(t=>t.id===id)?.roi;if(old&&!roi)tableDiscovery.current.reject(old);const zones=tableCalibration(latest.current).map(z=>z.id===id?{...z,roi}:z);update(s=>applyCalibration(s,zones));if(roleRef.current==='viewer'&&sharedEpoch.current)send.current?.({type:'calibration',epoch:sharedEpoch.current,zones});}
 function resetZones(){update(s=>resetVideoZones(s,Date.now()));}
 function upload(f?:File){if(!f)return;if(!f.type.startsWith('video/')){setError('Выберите видео MP4, WebM или MOV.');return;}clearSource();resetZones();pendingAuto.current=true;const url=URL.createObjectURL(f);objectURL.current=url;setSource(f.name);setError('');if(video.current){video.current.srcObject=null;video.current.src=url;video.current.load();}setCalibrating(false);notify('Видео открыто. Распознавание и поиск столиков запустятся автоматически.');}
 async function webcam(){try{clearSource();const media=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280}},audio:false});if(!alive.current){media.getTracks().forEach(t=>t.stop());return;}pendingAuto.current=true;stream.current=media;if(video.current){video.current.removeAttribute('src');video.current.srcObject=media;await video.current.play();}resetZones();setSource('Камера устройства');setError('');setCalibrating(false);}catch{setError('Не удалось получить доступ к камере. Проверьте разрешение браузера или загрузите видео.');}}
 function remoteStream(media:MediaStream|null,role:''|'host'|'viewer'){
  clearSource();setError('');setCalibrating(false);
  if(!media){sharedEpoch.current='';receivedRevision.current=0;setRemoteEpoch('');setRemoteAnalysis(false);setSource('');if(video.current){video.current.srcObject=null;video.current.removeAttribute('src');video.current.load();}return;}
  if(role==='host'){sharedEpoch.current=crypto.randomUUID();layoutRevision.current=0;receivedFrame.current=0;setRemoteEpoch(sharedEpoch.current);}else if(!sharedEpoch.current)resetZones();pendingAuto.current=role==='viewer';stream.current=media;
  setSource(role==='host'?'Трансляция камеры · передача':'Удалённая камера · просмотр');
  if(video.current){video.current.removeAttribute('src');video.current.srcObject=media;void video.current.play().catch(()=>setError('Нажмите воспроизведение на видео для запуска просмотра.'));}
 }
 function viewportForVideo(v:HTMLVideoElement){const stage=v.parentElement;if(!stage)return {left:0,top:0,width:v.videoWidth||v.clientWidth||1280,height:v.videoHeight||v.clientHeight||720};const stageWidth=Math.max(1,stage.clientWidth),stageHeight=Math.max(1,stage.clientHeight),baseWidth=v.videoWidth||1,baseHeight=v.videoHeight||1,scale=Math.min(stageWidth/baseWidth,stageHeight/baseHeight);const width=baseWidth*scale,height=baseHeight*scale;return {left:(stageWidth-width)/2,top:(stageHeight-height)/2,width,height};}
 function draw(){const c=canvas.current,v=video.current;if(!c||!v)return;const ctx=c.getContext('2d');if(!ctx)return;const stage=v.parentElement;if(!stage)return;const dpr=window.devicePixelRatio||1;const viewport=viewportForVideo(v);c.width=Math.max(1,Math.round(stage.clientWidth*dpr));c.height=Math.max(1,Math.round(stage.clientHeight*dpr));ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,stage.clientWidth,stage.clientHeight);ctx.font='500 12px sans-serif';ctx.lineWidth=1.25;
  function label(text:string,x:number,y:number,color:string){ctx!.save();ctx!.lineWidth=2.5;ctx!.strokeStyle='rgba(15,23,42,.65)';ctx!.strokeText(text,x,y);ctx!.fillStyle=color;ctx!.fillText(text,x,y);ctx!.restore();}
  for(const t of latest.current.tables){
   const z=t.roi;if(!z||frontTables&&t.id===1)continue;
   const x=viewport.left+z.x*viewport.width,y=viewport.top+z.y*viewport.height,w=z.w*viewport.width,h=z.h*viewport.height;
   const color={free:'#70d6a6',occupied:'#e6ae5c',dirty:'#f29b86',cleaning:'#91c9ed'}[t.status];
   ctx.strokeStyle=color;ctx.strokeRect(x,y,w,h);
   const text=`T${String(t.id).padStart(2,'0')} · ${STATUS[t.status]}`,lw=ctx.measureText(text).width;
   const lx=Math.max(viewport.left,Math.min(x,stage.clientWidth-lw-4)),ly=Math.max(viewport.top+13,y-4);
   label(text,lx,ly,color);
  }
  for(const d of results.current){const [bx,by,bw,bh]=d.bbox;const x=viewport.left+bx/(v.videoWidth||1)*viewport.width,y=viewport.top+by/(v.videoHeight||1)*viewport.height,w=bw/(v.videoWidth||1)*viewport.width,h=bh/(v.videoHeight||1)*viewport.height;ctx.strokeStyle='#b2cffc';ctx.strokeRect(x,y,w,h);label(`${Math.round(d.score*100)}%`,x+4,Math.max(viewport.top+13,y-4),'#b2cffc');}

 }
 useEffect(()=>{draw();},[state.tables,source,frontTables]);
 useEffect(()=>{
  const redraw=()=>draw();
  const changed=()=>{setFullscreen(document.fullscreenElement===stage.current);redraw();};
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!document.fullscreenElement)setFullscreen(false);};
  document.addEventListener('fullscreenchange',changed);window.addEventListener('resize',redraw);document.addEventListener('keydown',escape);
  const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(redraw):null;
  if(stage.current)observer?.observe(stage.current);redraw();
  return()=>{observer?.disconnect();document.removeEventListener('fullscreenchange',changed);window.removeEventListener('resize',redraw);document.removeEventListener('keydown',escape);};
 },[frontTables,fullscreen,aspect]);
 useEffect(()=>{
  if(!fullscreen)return;const previous=document.body.style.overflow;document.body.style.overflow='hidden';
  return()=>{document.body.style.overflow=previous;};
 },[fullscreen]);
 async function toggleFullscreen(){
  const target=stage.current;if(!target)return;
  if(fullscreen){
   if(document.fullscreenElement===target){try{await document.exitFullscreen();}catch{setFullscreen(document.fullscreenElement===target);}}else setFullscreen(false);
  }else{
   if(target.requestFullscreen){try{await target.requestFullscreen();}catch{setFullscreen(true);}}
   else setFullscreen(true);
  }
 }
 function trackTables(found:Detection[],v:HTMLVideoElement){
  const tracker=tableDiscovery.current;tracker.limit=frontTables?4:12;tracker.excludedIds=frontTables?new Set([1]):new Set();
  return tracker.update(latest.current,found,v.videoWidth,v.videoHeight);
 }
 async function loop(token:number){if(token!==epoch.current||!running.current||!alive.current)return;const v=video.current;if(!v||!model.current)return;if(v.paused||v.ended){stop();return;}
  const frameStart=performance.now();
  try{const start=frameStart;const scanTables=tableScan.current||(++frameNumber.current%2===0);tableScan.current=false;model.current.frontTables=frontTables;model.current.detail=detailed;model.current.tableDetail=scanTables;const found=await model.current.detect(v,100,Math.min(personThreshold,0.3));if(token!==epoch.current||!running.current||!alive.current)return;results.current=found.filter(d=>d.class==='person'&&d.score>=personThreshold);setCount(results.current.length);setMs(Math.round(performance.now()-start));
    const withZones=trackTables(found,v);if(withZones!==latest.current){if(roleRef.current==='viewer'&&send.current&&sharedEpoch.current)send.current({type:'calibration',epoch:sharedEpoch.current,zones:tableCalibration(withZones)});else update(s=>({...s,tables:s.tables.map(t=>({...t,roi:withZones.tables.find(z=>z.id===t.id)?.roi??null}))}));}
    if(remoteRole==='viewer'&&send.current&&sharedEpoch.current){send.current({type:'observations',epoch:sharedEpoch.current,frame:++sentFrame.current,people:normalizePeople(results.current,v.videoWidth,v.videoHeight),scene:normalizeScene(found,v.videoWidth,v.videoHeight),zones:tableCalibration(withZones),ms:Math.round(performance.now()-start)});}
    else {const now=Date.now(),seating=seatingTracker.current.update(results.current,v.videoWidth,v.videoHeight,withZones.tables,now),tracking=serviceTracker.current.update(withZones,found,v.videoWidth,v.videoHeight,now,seating);if(now-lastObservationAt.current>=1000||tracking.departed?.size||tracking.servicing?.size||tracking.cleaned?.size){lastObservationAt.current=now;update(s=>applyVideoFrame(s,results.current,v.videoWidth,v.videoHeight,now,tracking));}}setFrames(n=>n+1);draw();
  }catch{if(token!==epoch.current||!alive.current)return;model.current?.dispose();model.current=null;setModelReady(false);setError('Ошибка обработки кадра. Попробуйте видео меньшего разрешения.');stop();return;}
  timer.current=setTimeout(()=>loop(token),Math.max(80,400-(performance.now()-frameStart)));
 }
 async function start(){if(starting.current||running.current||latest.current.mode==='demo')return;pendingAuto.current=false;setError('');if(!source&&!video.current?.currentSrc&&!stream.current){setError('Сначала откройте видео или камеру.');return;}setCalibrating(false);starting.current=true;setLoading(true);const startToken=++epoch.current;
  try{if(!model.current){setLoading(true);const {YoloDetector}=await import('../lib/yolo-detector');let expired=false;let deadline:ReturnType<typeof setTimeout>;const pending=YoloDetector.load().then(m=>{if(expired){m.dispose();throw new Error('Model loading timed out');}return m;});const loaded=await Promise.race([pending,new Promise<never>((_,reject)=>{deadline=setTimeout(()=>{expired=true;reject(new Error('Model loading timed out'));},60000);})]).finally(()=>clearTimeout(deadline!));if(!alive.current||startToken!==epoch.current){loaded.dispose();return;}model.current=loaded;setModelReady(true);}if(!alive.current||startToken!==epoch.current)return;await model.current!.idle?.();if(!alive.current||startToken!==epoch.current)return;const v=video.current!;if(!initialized.current&&!latest.current.tables.some(t=>t.roi)){model.current!.frontTables=frontTables;model.current!.detail=detailed;model.current!.tableDetail=true;const found=await model.current!.detect(v,100,0.3);if(!alive.current||startToken!==epoch.current)return;const discovered=trackTables(found,v),zones=discovered.tables.filter(t=>t.roi);if(zones.length){update(s=>applyCalibration(s,tableCalibration(discovered)));notify(`Авторазметка: ${zones.length} столов. Проверьте зоны, при необходимости поправьте.`);}else notify('Столы не найдены автоматически. Разметьте их зоны для обновления карты.');initialized.current=true;}await v.play();if(!alive.current||startToken!==epoch.current)return;running.current=true;setActive(true);loop(++epoch.current);}
  catch{if(alive.current)setError('Не удалось загрузить нейросеть или запустить видео. Проверьте соединение с сайтом и формат видео. Модель загружается с этого же сайта.');}
  finally{starting.current=false;if(alive.current)setLoading(false);}
 }
 function point(e:React.PointerEvent<HTMLDivElement>){const v=video.current;if(!v)return{x:0,y:0};const r=e.currentTarget.getBoundingClientRect();const viewport=viewportForVideo(v);const x=(e.clientX-r.left-viewport.left)/viewport.width;const y=(e.clientY-r.top-viewport.top)/viewport.height;return{x:Math.max(0,Math.min(1,x)),y:Math.max(0,Math.min(1,y))};}
 return <><RemoteCamera onMessage={receive} onTransport={transport} guest={guest} disabled={active||loading||state.mode==='demo'} onStream={remoteStream} onRole={setRemoteRole}/><div className="video-layout"><section className="panel"><div className="panel-head"><div><h2>Видеоаналитика</h2><p>{remoteRole==='host'?'Камера передаётся подключённому устройству':remoteRole==='viewer'?'Прямой эфир · распознавание на этом устройстве':'Локальная обработка · видео остаётся на вашем устройстве'}</p></div><span className={'pill '+(active||remoteAnalysis?'green':'neutral')}><span className="dot"/>{remoteRole==='host'?(remoteAnalysis?'Анализ со второго устройства':'Ожидаем анализ зрителя'):active?'Анализ идёт':'Остановлено'}</span></div>
 {state.mode==='demo'&&<div className="notice"><Info size={18}/><span>Для анализа собственного видео откройте рабочую смену. Демо-данные останутся отдельно.</span><button className="btn small" onClick={goLive}>Рабочая смена</button></div>}
 {!state.tables.some(t=>t.roi)&&source&&<div className="notice calibration-needed"><ScanLine size={18}/><span><strong>Столы пока не привязаны.</strong> Покажите столешницы целиком или нажмите «Выделить область». Без зон состояния столов не определяются.</span></div>}
 {remoteRole==='host'&&<div className="notice"><Info size={18}/><span>{syncReady?'Карта и наблюдения поступают с устройства просмотра. Уборку можно подтвердить здесь.':'Откройте приглашение на втором устройстве. Там начнётся распознавание, затем карта появится и здесь.'}</span></div>}
 <div ref={stage} className={'video-stage'+(fullscreen?' is-fullscreen':'')} onDoubleClick={e=>{if(e.target===video.current){e.preventDefault();void toggleFullscreen();}}} style={{aspectRatio:aspect,maxWidth:aspect<1?340:undefined}}>
 <video ref={video} muted playsInline controlsList="nofullscreen noremoteplayback" disablePictureInPicture controls={!!source&&!calibrating} onLoadedMetadata={()=>{if(video.current){setAspect(video.current.videoWidth/video.current.videoHeight||16/9);draw();}}} onLoadedData={()=>{if(pendingAuto.current&&latest.current.mode==='live')start();}} onEnded={stop} onSeeking={()=>{if(running.current)stop();}} onPause={()=>{if(running.current)stop();}} onError={()=>setError('Браузер не поддерживает кодек этого видео. Попробуйте MP4 с кодеком H.264.')}/>
 {!source&&<div className="video-empty"><span className="camera-orbit"><Video size={38}/></span><h3>Начните с обзора зала</h3><p>Откройте видео или камеру и запустите распознавание.<br/>Зоны столиков можно разметить для оценки занятости.</p><button className="btn light" disabled={guest||!!remoteRole} onClick={()=>file.current?.click()}><Upload size={16}/>Выбрать видео</button></div>}
 <canvas ref={canvas}/>
 {source&&<>
  <div className="video-stage-tools"><button type="button" aria-label={fullscreen?'Выйти из полноэкранного режима':'На весь экран с распознаванием'} aria-pressed={fullscreen} title={fullscreen?'Выйти из полноэкранного режима':'На весь экран с распознаванием'} onClick={()=>void toggleFullscreen()}>{fullscreen?<Minimize size={19}/>:<Maximize size={19}/>}</button></div>
  <div className="fullscreen-toolbar" aria-label="Управление распознаванием в полном экране">
   <span className="fullscreen-status" role="status"><span className={'dot '+(active||remoteAnalysis?'green':'')}/>{loading?'Загрузка модели…':active||remoteAnalysis?'Анализ идёт':'Анализ приостановлен'} · Людей: {count}</span>
   <button type="button" disabled={loading||state.mode==='demo'||remoteRole==='host'} onClick={active?stop:start}>{loading?<LoaderCircle className="spin" size={16}/>:active?<Pause size={16}/>:<Play size={16}/>} {active?'Пауза анализа':'Распознавать людей'}</button>
  </div>
 </>}
 {source&&calibrating&&<div className="calibration-layer" onPointerCancel={()=>{anchor.current=null;setDrag(null);}} onPointerDown={e=>{anchor.current=point(e);e.currentTarget.setPointerCapture(e.pointerId);setDrag({...anchor.current,w:0,h:0});}} onPointerMove={e=>{if(!anchor.current)return;const p=point(e),a=anchor.current;setDrag({x:Math.min(a.x,p.x),y:Math.min(a.y,p.y),w:Math.abs(p.x-a.x),h:Math.abs(p.y-a.y)});}} onPointerUp={()=>{if(drag&&drag.w>0.015&&drag.h>0.015){const z=drag;editZone(tableId,z);notify(`Зона стола ${tableId} сохранена`);}anchor.current=null;setDrag(null);}}>{drag&&<div className="drag-zone" style={{left:drag.x*100+'%',top:drag.y*100+'%',width:drag.w*100+'%',height:drag.h*100+'%'}}/>}</div>}
 </div>
 <input ref={file} type="file" accept="video/*" hidden onChange={e=>{upload(e.target.files?.[0]);e.target.value='';}}/>
 <div className="video-quality"><label>Поиск столов<select value={frontTables?'front':'all'} disabled={active||loading} onChange={e=>{setFrontTables(e.target.value==='front');tableDiscovery.current.clear();resetZones();initialized.current=false;}}><option value="front">Передние столы · T01 отключён</option><option value="all">Все столы · общая модель</option></select></label><label>Качество<select value={detailed?'detail':'fast'} disabled={active||loading} onChange={e=>setDetailed(e.target.value==='detail')}><option value="fast">Сбалансированно · полный кадр</option><option value="detail">Дальние люди · дополнительные участки</option></select></label><label>Порог обнаружения: {Math.round(personThreshold*100)}%<input type="range" min="0.15" max="0.8" step="0.05" value={personThreshold} disabled={active||loading} onChange={e=>setPersonThreshold(+e.target.value)}/></label><p>Меньший порог может находить больше людей и давать больше ложных рамок. Начните со сбалансированного режима. Увеличенные участки нужны для маленьких фигур вдалеке.</p></div><div className="video-toolbar"><button className="btn" onClick={()=>file.current?.click()} disabled={guest||loading||active||!!remoteRole}><Upload size={16}/>Открыть видео</button><button className="btn" onClick={webcam} disabled={guest||loading||active||!!remoteRole}><Camera size={16}/>Камера</button><button className="btn primary" disabled={loading||state.mode==='demo'||!source||remoteRole==='host'} onClick={active?stop:start}>{loading?<LoaderCircle className="spin" size={16}/>:active?<Pause size={16}/>:<Play size={16}/>} {loading?'Загрузка модели…':active?'Пауза':'Распознавать людей'}</button></div>
 {error&&<div className="error" role="alert">{error}</div>}
 <div className="vision-metrics"><div><span>Источник</span><strong>{source||'Не выбран'}</strong></div><div><span>Людей в кадре</span><strong>{active||modelReady||remoteAnalysis?count:'—'}</strong></div><div><span>Обработка кадра</span><strong>{ms?`${ms} мс`:'—'}</strong></div><div><span>Модель</span><strong>YOLOv8 · 640px</strong></div></div></section>
 <aside className="panel calibration"><div className="panel-head"><h2>Зоны столиков</h2><ScanLine size={19}/></div><p className="muted">Выделяйте область посадки вместе со стульями, исключая проходы. Для каждого ракурса нужна своя разметка. Автопоиск периодически ищет дополнительные столы и добавляет устойчивые находки, сохраняя номера существующих зон. Проверьте или скорректируйте зоны; без них карта не получает наблюдения.</p><label>Столик<select value={tableId} onChange={e=>setTableId(+e.target.value)}>{state.tables.map(t=><option key={t.id} value={t.id}>Стол {t.id} · {t.capacity} места · {t.roi?'размечен':'не размечен'}</option>)}</select></label><button className={'btn wide '+(calibrating?'primary':'')} disabled={!source||loading} onClick={()=>{if(active)stop();if(!stream.current)video.current?.pause();setCalibrating(!calibrating);}}><ScanLine size={16}/>{calibrating?'Завершить разметку':'Выделить область'}</button>{calibrating&&<p className="hint">Проведите мышью или пальцем по кадру вокруг столика и стульев. Затем запустите распознавание.</p>}
 <button className="btn wide" disabled={!source||loading||!state.tables.some(t=>!t.roi)} onClick={()=>{const next=latest.current.tables.find(t=>!t.roi);if(!next)return;if(active)stop();if(!stream.current)video.current?.pause();setTableId(next.id);setCalibrating(true);}}><ScanLine size={16}/>Добавить стол вручную</button>
 <button className="btn wide" disabled={!source||loading||remoteRole==='host'} onClick={()=>{tableScan.current=true;if(!active)void start();else notify('Повторный поиск столов запущен. Новые зоны добавятся после подтверждения на двух кадрах.');}}><ScanLine size={16}/>{active?'Найти другие столы':'Найти столы и запустить анализ'}</button><div className="zone-list">{state.tables.filter(t=>t.roi).map(t=><div key={t.id}><span className="table-mini">{t.id}</span><span>Стол {t.id}</span><button className="icon-btn" aria-label={`Удалить зону ${t.id}`} disabled={active} onClick={()=>editZone(t.id,null)}><Trash2 size={15}/></button></div>)}{!state.tables.some(t=>t.roi)&&<p className="empty-note">Пока нет выделенных зон</p>}</div>
 <div className="explain-note"><Info size={17}/><p>После ухода гостей стол переходит в «Нужна уборка». Для этого ролика стоящий человек в чёрном считается официантом: его визит запускает «Уборка», а уход завершает её сразу. Пустая белая столешница без гостей и вещей также переводит стол в «Свободен» после двух согласованных кадров, даже если визит официанта не был виден.</p></div></aside></div><LiveMap state={state} update={update} readOnly={guest&&syncReady}/><section className="panel video-events"><div className="panel-head"><h2>События из видео</h2><span className="pill neutral">Обработано кадров: {frames}</span></div>{state.logs.filter(l=>l.source==='camera').slice(0,8).map(l=><div key={l.id}><strong>Стол {l.tableId}</strong><span>{l.message}</span><small>{new Date(l.at).toLocaleTimeString('ru-RU',{timeZone:'Asia/Qyzylorda'})}</small></div>)}{!state.logs.some(l=>l.source==='camera')&&<p className="empty-note">Посадка и уход гостей автоматически попадут в журнал.</p>}</section></>;
}
