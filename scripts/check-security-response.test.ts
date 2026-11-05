import assert from 'node:assert/strict';
import test from 'node:test';
import {securityResponseValid} from '../lib/security-response';
import {readDaybookJson,BrowserJsonError} from '../lib/browser-json';
const at='2026-11-05T18:00:00.000Z';
const status={enabled:true,recoveryAcknowledged:true,challengeRequired:false,fresh:true,memberId:'member-a',role:'owner',canManagePolicy:true,policy:{requireStaffMfa:true,version:1,activatedAt:at}};
test('security status requires a complete contract before changing the enrollment form',()=>{
 assert.equal(securityResponseValid('/api/security','GET',status),true);
 for(const payload of [{},{...status,policy:{}},{...status,fresh:null},{...status,role:'operator'},{...status,policy:{...status.policy,activatedAt:'invalid'}}])assert.equal(securityResponseValid('/api/security','POST',payload),false);
});
test('MFA and session responses reject incomplete results and credentials',()=>{
 assert.equal(securityResponseValid('/api/auth/two-factor/enable','POST',{totpURI:'otpauth://totp/Daybook?secret=FICTITIOUS',backupCodes:['fictitious-code']}),true);
 for(const payload of [{totpURI:'https://third-party.invalid',backupCodes:['code']},{totpURI:'otpauth://totp/Daybook',backupCodes:['code']},{totpURI:'otpauth://totp/Daybook?secret=FICTITIOUS',backupCodes:[]}])assert.equal(securityResponseValid('/api/auth/two-factor/enable','POST',payload),false);
 const session={id:'opaque-id',label:'Chrome · Linux',createdAt:at,expiresAt:at,current:true};
 assert.equal(securityResponseValid('/api/security/sessions','GET',{sessions:[session]}),true);
 assert.equal(securityResponseValid('/api/security/sessions','GET',{sessions:[{...session,token:'must-not-be-exposed'}]}),false);
 assert.equal(securityResponseValid('/api/security/sessions','DELETE',{revoked:1}),true);
 assert.equal(securityResponseValid('/api/security/sessions','DELETE',{}),false);
});
test('unconfirmed security mutation and 428 retain the declared reader semantics',async()=>{
 await assert.rejects(()=>readDaybookJson(new Response('{}'),{validate:(value):value is typeof status=>securityResponseValid('/api/security','POST',value),mutation:true}),error=>error instanceof BrowserJsonError&&error.status===200&&/no se pudo confirmar/i.test(error.message));
 const hint={error:'Verifica tu acceso.',redirectTo:'/security'};
 await assert.rejects(()=>readDaybookJson(Response.json(hint,{status:428}),{validate:(value):value is typeof status=>securityResponseValid('/api/security','POST',value)}),error=>error instanceof BrowserJsonError&&error.status===428&&(error.payload as typeof hint).redirectTo==='/security');
});
