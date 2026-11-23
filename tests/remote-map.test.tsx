import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {useState} from 'react';
import {initialState,resetShift,AppState} from '../src/lib/engine';
import {tableCalibration,CameraMessage} from '../src/lib/camera-sync';
test('camera screen consumes viewer observations, publishes table changes, and rejects pre-reset frames',async()=>{
 const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://tableflow.test/'});
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
 dom.window.HTMLCanvasElement.prototype.getContext=(()=>null) as typeof dom.window.HTMLCanvasElement.prototype.getContext;dom.window.HTMLMediaElement.prototype.play=async()=>{};dom.window.HTMLMediaElement.prototype.load=()=>{};
 const track={stop(){},onended:null};const media={getTracks:()=>[track],getVideoTracks:()=>[track]};Object.defineProperty(dom.window.navigator,'mediaDevices',{value:{getUserMedia:async()=>media},configurable:true});
 class Channel{label='tableflow-tables';readyState='connecting';bufferedAmount=0;onopen:(()=>void)|null=null;onmessage:((e:{data:string})=>void)|null=null;onclose:(()=>void)|null=null;sent:CameraMessage[]=[];send(value:string){this.sent.push(JSON.parse(value));}close(){this.readyState='closed';}}
 class Peer{static instances:Peer[]=[];channel=new Channel();connectionState='new';constructor(){Peer.instances.push(this);}createDataChannel(){return this.channel;}addTrack(){}close(){this.channel.close();}}
 const originalPeer=(globalThis as any).RTCPeerConnection;Object.assign(globalThis,{RTCPeerConnection:Peer});Object.assign(dom.window,{RTCPeerConnection:Peer});
 const originalNow=Date.now;let clock=originalNow();Date.now=()=>clock;const originalFetch=globalThis.fetch;globalThis.fetch=async(_input,init)=>{const body=init?.body?JSON.parse(String(init.body)):null;return Response.json(body?.action==='create'?{code:'ABCDEF123456',token:crypto.randomUUID(),invite:'a'.repeat(64),expires:Date.now()+7200000}:body?{ok:true}:{viewer:null,offer:null,answer:null});};
 const {render,screen,fireEvent,waitFor,act,cleanup}=await import('@testing-library/react');const {default:VideoPanel}=await import('../src/components/VideoPanel');let latest:AppState=initialState('live',1000);
 function Harness(){const [s,set]=useState(()=>initialState('live',1000));latest=s;return <><button onClick={()=>set(x=>resetShift(x,50000))}>Test reset</button><VideoPanel state={s} update={set} notify={()=>{}} goLive={()=>{}} onSession={()=>{}}/></>;}
 try{
  render(<Harness/>);fireEvent.click(screen.getByRole('button',{name:'Передавать камеру'}));await screen.findByText('Камера включена. Ожидаем второе устройство');const channel=Peer.instances[0].channel;await act(async()=>{channel.readyState='open';channel.onopen?.();});await waitFor(()=>assert.ok(channel.sent.some(m=>m.type==='layout')));
  const layout=channel.sent.find(m=>m.type==='layout')!;const zones=tableCalibration(latest);zones[0].roi={x:0,y:0,w:.8,h:.8};let frame=0;
  const deliver=async(people:unknown[],epoch=layout.epoch)=>act(async()=>{clock+=1000;channel.onmessage?.({data:JSON.stringify({type:'observations',epoch,frame:++frame,people,zones,ms:150})});});
  const person={class:'person',score:.95,bbox:[.2,.2,.2,.4]};for(let i=0;i<8;i++)await deliver([person]);assert.equal(latest.tables[0].status,'occupied');assert.ok(screen.getByText('Анализ со второго устройства'));assert.ok(channel.sent.some(m=>m.type==='layout'&&m.tables[0].status==='occupied'));
  for(let i=0;i<10;i++)await deliver([]);assert.equal(latest.tables[0].status,'dirty');assert.equal(latest.visits.length,1);fireEvent.click(screen.getByRole('button',{name:'Начать уборку'}));assert.equal(latest.tables[0].status,'cleaning');fireEvent.click(screen.getByRole('button',{name:'Уборка завершена'}));assert.equal(latest.tables[0].status,'free');
  fireEvent.click(screen.getByRole('button',{name:'Test reset'}));await waitFor(()=>{const last=channel.sent.filter(m=>m.type==='layout').at(-1)!;assert.notEqual(last.epoch,layout.epoch);});assert.equal(latest.visits.length,0);assert.equal(latest.logs.length,0);assert.ok(latest.tables[0].roi);
  for(let i=0;i<8;i++)await deliver([person]);assert.equal(latest.tables[0].status,'free','old generation frames cannot reoccupy a reset shift');
 }finally{Date.now=originalNow;cleanup();globalThis.fetch=originalFetch;(globalThis as any).RTCPeerConnection=originalPeer;dom.window.close();}
});
