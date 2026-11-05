import assert from 'node:assert/strict';
import test from 'node:test';
import {ApiError,auth,enforceExplicitWorkspaceApi} from '../lib/server';
import {workspaceIdFromPath} from '../lib/workspace-model';
const origin='https://daybook-auth-fixture.example.test';
const request=(path:string,referer='/w/alpha',method='GET')=>new Request(`${origin}${path}`,{method,headers:{Referer:new URL(referer,origin).href,Cookie:'daybook.session_token=fictitious-only'}});
test('personal preferences remain global from either pilot tab, without changing the request or identity context',()=>{
 for(const workspace of ['alpha','beta'])for(const method of ['GET','PUT']){
  const value=request('/api/preferences?theme=dark',`/w/${workspace}`,method),url=value.url,cookie=value.headers.get('cookie');
  assert.doesNotThrow(()=>enforceExplicitWorkspaceApi(value));assert.equal(value.url,url);assert.equal(value.headers.get('cookie'),cookie);assert.equal(workspaceIdFromPath(new URL(value.url).pathname),'daybook');
 }
});
test('the global preference exception is exact and does not admit a domain API through similarly named paths',()=>{
 for(const path of ['/api/preferences/extra','/api/preferences-evil','/api/account-evil/security','/api/auth-evil/sign-in','/api/workspaces-evil/tickets'])assert.throws(()=>enforceExplicitWorkspaceApi(request(path)),error=>error instanceof ApiError&&error.status===409,path);
 for(const path of ['/api/preferences','/api/account/security','/api/auth/sign-out','/api/operator/workspaces','/api/workspaces/invitations/accept'])assert.doesNotThrow(()=>enforceExplicitWorkspaceApi(request(path)),path);
});
test('legacy domain requests from a pilot tab fail with 409 before any identity or database lookup',async()=>{
 for(const path of ['/api/workspace','/api/tickets/6/conversation','/api/tickets/search?workspaceId=beta']){
  const value=request(path);await assert.rejects(()=>auth(value),error=>error instanceof ApiError&&error.status===409);assert.equal(workspaceIdFromPath(new URL(value.url).pathname),'daybook');
 }
});
test('only the explicit API URL determines workspace; an absent or malformed referer never supplies one',()=>{
 const scoped=request('/api/workspaces/alpha/tickets/6','/w/beta');assert.doesNotThrow(()=>enforceExplicitWorkspaceApi(scoped));assert.equal(workspaceIdFromPath(new URL(scoped.url).pathname),'alpha');
 for(const referer of [null,'malformed-referer',`${origin}/`]){
  const value=new Request(`${origin}/api/tickets/6`,{headers:referer?{Referer:referer}:{}});assert.doesNotThrow(()=>enforceExplicitWorkspaceApi(value));assert.equal(workspaceIdFromPath(new URL(value.url).pathname),'daybook');
 }
});
test('allowing global preferences still enforces the existing mutation origin check before identity lookup',async()=>{
 const previous=process.env.DAYBOOK_SITE_URL;
 try{process.env.DAYBOOK_SITE_URL=origin;const value=new Request(`${origin}/api/preferences`,{method:'PUT',headers:{Referer:`${origin}/w/alpha`,Origin:'https://outside.example.test'}});await assert.rejects(()=>auth(value),error=>error instanceof ApiError&&error.status===403);}
 finally{if(previous===undefined)delete process.env.DAYBOOK_SITE_URL;else process.env.DAYBOOK_SITE_URL=previous;}
});
