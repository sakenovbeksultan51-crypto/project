import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {useState} from 'react';
import {initialState,AppState} from '../src/lib/engine';

test('fullscreen targets the analysis container, preserves video and canvas, and redraws after resizing or Escape',async()=>{
 const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost:3000'});
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
 const originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL,originalObserver=globalThis.ResizeObserver;
 URL.createObjectURL=()=> 'blob:fullscreen-test';URL.revokeObjectURL=()=>{};
 const ctx={clearRect(){},setTransform(){},save(){},restore(){},strokeRect(){},strokeText(){},fillText(){},measureText(){return {width:80};},font:'',lineWidth:1,strokeStyle:'',fillStyle:''};
 dom.window.HTMLCanvasElement.prototype.getContext=(()=>ctx) as unknown as typeof dom.window.HTMLCanvasElement.prototype.getContext;
 dom.window.HTMLMediaElement.prototype.load=()=>{};
 const callbacks:ResizeObserverCallback[]=[];
 class Observer{constructor(callback:ResizeObserverCallback){callbacks.push(callback);}observe(){}disconnect(){}unobserve(){}}
 globalThis.ResizeObserver=Observer as unknown as typeof ResizeObserver;
 let fullscreenElement:Element|null=null,requested:Element|null=null;
 Object.defineProperty(document,'fullscreenElement',{configurable:true,get:()=>fullscreenElement});
 dom.window.HTMLElement.prototype.requestFullscreen=async function(){requested=this;fullscreenElement=this;document.dispatchEvent(new dom.window.Event('fullscreenchange'));};
 document.exitFullscreen=async()=>{fullscreenElement=null;document.dispatchEvent(new dom.window.Event('fullscreenchange'));};
 const {render,screen,fireEvent,act,cleanup}=await import('@testing-library/react');
 const {default:VideoPanel}=await import('../src/components/VideoPanel');
 function Harness(){const [state,update]=useState<AppState>(()=>initialState('live'));return <VideoPanel state={state} update={update} notify={()=>{}} goLive={()=>{}} onSession={()=>{}}/>;}
 try{
  const {container}=render(<Harness/>);
  const video=container.querySelector('video')!,canvas=container.querySelector('canvas')!,stage=video.parentElement!;
  Object.defineProperty(video,'videoWidth',{configurable:true,value:1920});Object.defineProperty(video,'videoHeight',{configurable:true,value:1080});
  Object.defineProperty(stage,'clientWidth',{configurable:true,value:720});Object.defineProperty(stage,'clientHeight',{configurable:true,value:405});
  const input=container.querySelector('input[type="file"]')!;
  fireEvent.change(input,{target:{files:[new dom.window.File(['video'],'hall.mp4',{type:'video/mp4'})]}});
  assert.match(video.getAttribute('controlslist')!,/nofullscreen/);assert.ok(video.hasAttribute('disablepictureinpicture'));
  await act(async()=>fireEvent.click(screen.getByRole('button',{name:'На весь экран с распознаванием'})));
  assert.equal(requested,stage);assert.ok(stage.contains(canvas));assert.ok(stage.classList.contains('is-fullscreen'));
  assert.ok(stage.contains(screen.getByLabelText('Управление распознаванием в полном экране')));
  assert.ok(stage.querySelector('.fullscreen-toolbar button'));assert.equal(document.body.style.overflow,'hidden');
  Object.defineProperty(stage,'clientWidth',{configurable:true,value:1280});Object.defineProperty(stage,'clientHeight',{configurable:true,value:720});
  await act(async()=>callbacks.at(-1)!([],{} as ResizeObserver));
  assert.equal(canvas.width,1280);assert.equal(canvas.height,720);
  await act(async()=>{fullscreenElement=null;document.dispatchEvent(new dom.window.Event('fullscreenchange'));});
  assert.ok(!stage.classList.contains('is-fullscreen'));assert.equal(document.body.style.overflow,'');
  assert.equal(container.querySelector('video'),video);assert.equal(container.querySelector('canvas'),canvas);
  // A host without the native Fullscreen API still expands the complete player.
  Object.defineProperty(stage,'requestFullscreen',{configurable:true,value:undefined});
  fireEvent.click(screen.getByRole('button',{name:'На весь экран с распознаванием'}));assert.ok(stage.classList.contains('is-fullscreen'));
  fireEvent.keyDown(document,{key:'Escape'});assert.ok(!stage.classList.contains('is-fullscreen'));
  // Native permission rejection also uses the container fallback, not video-only fullscreen.
  Object.defineProperty(stage,'requestFullscreen',{configurable:true,value:async()=>{throw new Error('Not available in this host');}});
  await act(async()=>fireEvent.click(screen.getByRole('button',{name:'На весь экран с распознаванием'})));
  assert.ok(stage.classList.contains('is-fullscreen'));
  fireEvent.click(screen.getByRole('button',{name:'Выйти из полноэкранного режима'}));assert.ok(!stage.classList.contains('is-fullscreen'));
 }finally{cleanup();URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;globalThis.ResizeObserver=originalObserver;dom.window.close();}
});
