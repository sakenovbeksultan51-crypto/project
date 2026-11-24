import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {useState} from 'react';
import {initialState,changeStatus,type AppState} from '../src/lib/engine';

test('opening and seeking a recording starts a separate clean map without changing the live shift',async()=>{
 const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost:3000'});
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
 const originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL;URL.createObjectURL=()=> 'blob:test';URL.revokeObjectURL=()=>{};
 dom.window.HTMLMediaElement.prototype.load=()=>{};dom.window.HTMLCanvasElement.prototype.getContext=(()=>null) as typeof dom.window.HTMLCanvasElement.prototype.getContext;
 const {render,screen,fireEvent,cleanup}=await import('@testing-library/react');const {default:VideoPanel}=await import('../src/components/VideoPanel');
 let workspace:AppState=initialState('live');workspace=changeStatus(workspace,2,'occupied',100,'manual',2);workspace=changeStatus(workspace,3,'dirty',200,'manual');
 function Harness(){const [state,setState]=useState(workspace);workspace=state;return <VideoPanel state={state} update={setState} notify={()=>{}} goLive={()=>{}} onSession={()=>{}}/>;}
 try{
  const {container}=render(<Harness/>);const input=container.querySelector('input[type=file]')!;
  fireEvent.change(input,{target:{files:[new dom.window.File(['clip'],'scene.mp4',{type:'video/mp4'})]}});
  assert.ok(screen.getByText(/Просмотр записи · отдельная карта/));assert.equal(workspace.tables[1].status,'occupied');assert.equal(workspace.tables[2].status,'dirty');
  fireEvent.seeking(container.querySelector('video')!);assert.equal(workspace.tables[1].status,'occupied');assert.equal(workspace.tables[2].status,'dirty');
  assert.ok(screen.getByText('Столы ещё не привязаны'));
 }finally{cleanup();URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;dom.window.close();}
});
