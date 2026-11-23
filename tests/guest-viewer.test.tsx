import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {cameraInviteURL,parseCameraInvite} from '../src/lib/camera-invite';
test('guest invitation keeps its secret in the fragment and validates complete invitations',()=>{const link=cameraInviteURL('https://tableflow.test','ABCDEF123456','a'.repeat(64));const url=new URL(link);assert.equal(url.pathname,'/watch');assert.equal(url.search,'');assert.deepEqual(parseCameraInvite(link),{code:'ABCDEF123456',invite:'a'.repeat(64)});assert.deepEqual(parseCameraInvite(url.hash),parseCameraInvite(link));assert.equal(parseCameraInvite('ABCDEF123456'),null);assert.equal(parseCameraInvite('https://tableflow.test/watch#room=ABCDEF123456&invite=short'),null);});
test('guest page accepts a link without reading or writing an authenticated workspace',async()=>{
 const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:cameraInviteURL('https://tableflow.test','ABCDEF123456','b'.repeat(64))});
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});dom.window.HTMLCanvasElement.prototype.getContext=(()=>null) as typeof dom.window.HTMLCanvasElement.prototype.getContext;
 const original=globalThis.fetch;let requests=0;globalThis.fetch=async()=>{requests++;throw new Error('guest must not fetch a workspace');};
 const {render,screen,cleanup}=await import('@testing-library/react');const {default:GuestViewer}=await import('../src/components/GuestViewer');
 try{render(<GuestViewer/>);const button=await screen.findByRole('button',{name:'Открыть трансляцию'});assert.equal(button.hasAttribute('disabled'),false);assert.equal(screen.queryByRole('button',{name:'Передавать камеру'}),null);assert.equal(requests,0);assert.ok(screen.getByText(/карта синхронизируется между устройствами/));}finally{cleanup();globalThis.fetch=original;dom.window.close();}
});
