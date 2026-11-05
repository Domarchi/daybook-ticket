import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac } from 'node:crypto';
import { betterAuth } from 'better-auth/minimal';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { createAuthMiddleware } from 'better-auth/api';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { successfulAuthProofs } from '../lib/auth-security-hooks';
import { safeAuthLogger } from '../lib/auth-logging';

function totp(secret:string){
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits='';
  for(const character of secret.replace(/=+$/,'').toUpperCase()){const digit=alphabet.indexOf(character);assert.ok(digit>=0);bits+=digit.toString(2).padStart(5,'0');}
  const key=Buffer.from((bits.match(/.{8}/g)||[]).map(byte=>parseInt(byte,2))),counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const hash=createHmac('sha1',key).update(counter).digest(),offset=hash.at(-1)!&15;
  return String((hash.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');
}
test('installed Better Auth completes enrollment, challenges sign-in, consumes recovery once and exposes the rotated proof session',async()=>{
  const store:Record<string,Record<string,unknown>[]>={user:[],account:[],session:[],verification:[],twoFactor:[]};
  const proofs:ReturnType<typeof successfulAuthProofs>=[],origin='http://127.0.0.1:7138',password='Only-for-in-memory-MFA-test!';
  const auth=betterAuth({baseURL:origin,secret:'in-memory-only-deterministic-secret-for-mfa-qa-2026',logger:safeAuthLogger,database:memoryAdapter(store),emailAndPassword:{enabled:true},session:{cookieCache:{enabled:false}},plugins:[twoFactor({issuer:'Daybook Ticket',twoFactorCookieMaxAge:300,backupCodeOptions:{amount:10,length:12,storeBackupCodes:'encrypted'}})],hooks:{after:createAuthMiddleware(async ctx=>{proofs.push(...successfulAuthProofs({path:ctx.path,returned:ctx.context.returned,newSession:ctx.context.newSession}));})}});
  const cookies=new Map<string,string>();
  const headers=()=>new Headers({origin,'content-type':'application/json',cookie:[...cookies].map(([key,value])=>`${key}=${value}`).join('; ')});
  async function call(path:string,body:unknown){const response=await auth.handler(new Request(`${origin}/api/auth/${path}`,{method:'POST',headers:headers(),body:JSON.stringify(body)}));for(const line of response.headers.getSetCookie()){const pair=line.split(';')[0],at=pair.indexOf('=');if(pair.slice(at+1))cookies.set(pair.slice(0,at),pair.slice(at+1));else cookies.delete(pair.slice(0,at));}return {ok:response.ok,status:response.status,body:await response.json()};}
  assert.equal((await call('sign-up/email',{email:'security-qa@example.test',name:'Fictitious MFA account',password})).ok,true);
  const before=await auth.api.getSession({headers:headers()});assert.ok(before);
  const setup=await call('two-factor/enable',{password,method:'totp'});assert.equal(setup.ok,true);assert.equal(setup.body.backupCodes.length,10);
  const secret=new URL(setup.body.totpURI).searchParams.get('secret')!;
  assert.ok(!String(store.twoFactor[0].secret).includes(secret));assert.ok(!String(store.twoFactor[0].backupCodes).includes(setup.body.backupCodes[0]));
  assert.equal((await call('two-factor/verify-totp',{code:totp(secret)})).ok,true);
  const enrolled=await auth.api.getSession({headers:headers()});assert.ok(enrolled?.user.twoFactorEnabled);assert.notEqual(enrolled.session.id,before.session.id);
  const enrollmentProof=proofs.findLast(proof=>proof.factor==='mfa');assert.equal(enrollmentProof?.token,enrolled.session.token,'The persisted assurance must belong to the rotated session, not the deleted enrollment session.');
  await call('sign-out',{});
  const login=await call('sign-in/email',{email:'security-qa@example.test',password});assert.equal(login.body.twoFactorRedirect,true);assert.equal(await auth.api.getSession({headers:headers()}),null,'A pending factor is not an authenticated session.');
  const previousProofs=proofs.length;
  assert.equal((await call('two-factor/verify-totp',{code:'wrong-code'})).ok,false);assert.equal(proofs.length,previousProofs);assert.equal(await auth.api.getSession({headers:headers()}),null);
  assert.equal((await call('two-factor/verify-totp',{code:totp(secret)})).ok,true);
  const signed=await auth.api.getSession({headers:headers()});assert.ok(signed);
  assert.deepEqual(proofs.slice(-2).map(proof=>proof.factor),['mfa','password']);assert.ok(proofs.slice(-2).every(proof=>proof.token===signed.session.token));
  await call('sign-out',{});await call('sign-in/email',{email:'security-qa@example.test',password});
  assert.equal((await call('two-factor/verify-backup-code',{code:setup.body.backupCodes[0]})).ok,true);
  await call('sign-out',{});await call('sign-in/email',{email:'security-qa@example.test',password});
  const prior=proofs.length;assert.equal((await call('two-factor/verify-backup-code',{code:setup.body.backupCodes[0]})).ok,false);assert.equal(proofs.length,prior);assert.equal(await auth.api.getSession({headers:headers()}),null);
});
