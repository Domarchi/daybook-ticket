import assert from 'node:assert/strict';
import test from 'node:test';
import { safeSecurityRedirect } from '../lib/security-navigation';
import { daybookFetch,UNCERTAIN_SEND_MESSAGE } from '../lib/browser-request';
test('verification redirects accept only known local paths and safe ticket returns',()=>{
 assert.equal(safeSecurityRedirect('/security'),'/security');assert.equal(safeSecurityRedirect('/account/security'),'/account/security');
 assert.equal(safeSecurityRedirect('/security?return_to=%2F%3Fticket%3D3'),'/security?return_to=%2F%3Fticket%3D3');
 for(const path of ['https://outside.test/security','//outside.test/security','/security\\outside','/security#code','/api/security','/security?foo=1','/security?return_to=https%3A%2F%2Foutside.test','/security?return_to=%2F&return_to=%2F'])assert.equal(safeSecurityRedirect(path),null,path);
});
test('a 428 follows one safe hint and preserves the response body without retrying the send',async()=>{
 const oldFetch=globalThis.fetch,descriptor=Object.getOwnPropertyDescriptor(globalThis,'window'),destinations:string[]=[];let attempts=0;
 try{
  Object.defineProperty(globalThis,'window',{configurable:true,value:{location:{href:'https://daybook.test/?ticket=7',origin:'https://daybook.test',pathname:'/',search:'?ticket=7',replace:(value:string)=>destinations.push(value)}}});
  globalThis.fetch=async()=>{attempts++;return Response.json({error:'Verifica tu identidad.',redirectTo:'/security'},{status:428});};
  const response=await daybookFetch('/api/tickets/7/messages',{method:'POST'},UNCERTAIN_SEND_MESSAGE);
  assert.equal(attempts,1);assert.equal((await response.json()).error,'Verifica tu identidad.');assert.deepEqual(destinations,['https://daybook.test/security?return_to=%2F%3Fticket%3D7']);
  globalThis.fetch=async()=>Response.json({redirectTo:'https://outside.test/security'},{status:428});await daybookFetch('/api/settings',{method:'PATCH'});assert.equal(destinations.length,1);
 }finally{globalThis.fetch=oldFetch;if(descriptor)Object.defineProperty(globalThis,'window',descriptor);else Reflect.deleteProperty(globalThis,'window');}
});
test('transport failures retain the uncertain-send message, HTTP failures remain HTTP, and aborts remain aborts',async()=>{
 const old=globalThis.fetch;try{
  let attempts=0;globalThis.fetch=async()=>{attempts++;throw Error('native network detail');};await assert.rejects(()=>daybookFetch('/api/tickets',{method:'POST'},UNCERTAIN_SEND_MESSAGE),error=>(error as Error).message===UNCERTAIN_SEND_MESSAGE);assert.equal(attempts,1);
  const controller=new AbortController();controller.abort();const aborted=new DOMException('Aborted','AbortError');globalThis.fetch=async()=>{throw aborted;};await assert.rejects(()=>daybookFetch('/api/tickets',{signal:controller.signal}),error=>error===aborted);
  globalThis.fetch=async()=>Response.json({error:'Conflict'},{status:409});assert.equal((await daybookFetch('/api/tickets',{method:'POST'},UNCERTAIN_SEND_MESSAGE)).status,409);
 }finally{globalThis.fetch=old;}
});
