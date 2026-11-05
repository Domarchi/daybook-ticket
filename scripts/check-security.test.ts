import assert from 'node:assert/strict';
import test from 'node:test';
import { createDecipheriv,scryptSync } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { hasFreshProof,publicAuthResponse,publicSessionLabel,recentProof,requiresMfaChallenge,securityActionNeedsReauthentication,safeOperationalCode,SECURITY_FRESH_MS } from '../lib/security-model';
import { assertPlatformBackupAccess } from '../lib/security';
import { BUSINESS_EXPORT_MAGIC,BUSINESS_EXPORT_TABLES,businessExportColumns,encryptBusinessExport,type BusinessExport } from '../lib/business-export';
const now=Date.parse('2026-11-05T18:00:00.000Z'),at=new Date(now).toISOString(),before=new Date(now-1).toISOString();
test('activation challenges existing staff sessions but does not add a client obligation',()=>{
  const policy={requireStaffMfa:true,activatedAt:at,version:1};
  for(const role of ['owner','admin','agent']){
    assert.equal(requiresMfaChallenge(role,policy,false,{passwordVerifiedAt:at,mfaVerifiedAt:at},now),true);
    assert.equal(requiresMfaChallenge(role,policy,true,{passwordVerifiedAt:at,mfaVerifiedAt:before},now),true);
    assert.equal(requiresMfaChallenge(role,policy,true,{passwordVerifiedAt:at,mfaVerifiedAt:at},now),false);
  }
  assert.equal(requiresMfaChallenge('client',policy,false,null,now),false);
  assert.equal(requiresMfaChallenge('agent',{...policy,requireStaffMfa:false},false,null,now),false);
});
test('mandatory MFA fails closed on absent, malformed and future proof or activation',()=>{
  for(const proof of [null,{passwordVerifiedAt:at,mfaVerifiedAt:null},{passwordVerifiedAt:at,mfaVerifiedAt:'bad'},{passwordVerifiedAt:at,mfaVerifiedAt:new Date(now+1).toISOString()}]) assert.equal(requiresMfaChallenge('owner',{requireStaffMfa:true,activatedAt:at,version:1},true,proof,now),true);
  assert.equal(requiresMfaChallenge('owner',{requireStaffMfa:true,activatedAt:null,version:1},true,{passwordVerifiedAt:at,mfaVerifiedAt:at},now),true);
});
test('sensitive operations require a recent password and the enabled second factor',()=>{
  assert.equal(hasFreshProof({passwordVerifiedAt:at,mfaVerifiedAt:null},false,now),true);
  assert.equal(hasFreshProof({passwordVerifiedAt:at,mfaVerifiedAt:null},true,now),false);
  assert.equal(hasFreshProof({passwordVerifiedAt:null,mfaVerifiedAt:at},true,now),false);
  assert.equal(hasFreshProof({passwordVerifiedAt:at,mfaVerifiedAt:at},true,now),true);
  assert.equal(recentProof(new Date(now-SECURITY_FRESH_MS).toISOString(),now),true);
  assert.equal(recentProof(new Date(now-SECURITY_FRESH_MS-1).toISOString(),now),false);
  assert.equal(recentProof(new Date(now+1).toISOString(),now),false);
});
test('fresh verification protects scoped and legacy permission/configuration/export mutations',()=>{
  for(const path of ['/api/members/a','/api/settings','/api/service-policies/default','/api/assignment-rules/a','/api/notifications/settings','/api/organization/catalog','/api/workspaces/business-a/members/a'])assert.equal(securityActionNeedsReauthentication(path,'PATCH'),true,path);
  assert.equal(securityActionNeedsReauthentication('/api/backups/schedule/a/download','GET'),true);
  assert.equal(securityActionNeedsReauthentication('/api/tickets/123/messages','POST'),false);
  assert.equal(securityActionNeedsReauthentication('/api/members','GET'),false);
});
test('session DTO labels and auth JSON do not expose bearer tokens or arbitrary user agents',()=>{
  assert.equal(publicSessionLabel('UNTRUSTED\nsecret-token\n<script>'), 'Navegador · otro dispositivo');
  assert.equal(publicSessionLabel('Mozilla Linux Chrome/130.0'),'Chrome · Linux');
  const dto=publicAuthResponse({token:'sentinel-a',user:{id:'user-a'},session:{id:'session-a',token:'sentinel-b',accessToken:'sentinel-c',createdAt:at}});
  assert.deepEqual(dto,{user:{id:'user-a'},session:{id:'session-a',createdAt:at}});
  assert.ok(!JSON.stringify(dto).includes('sentinel'));
});
test('business export reads only domain allowlist and excludes credential-shaped columns',()=>{
  for(const table of ['authUser','authAccount','authSession','authVerification','authRateLimit','twoFactor','securityAssurances','securityProfiles','mailOutbox','pushSubscriptions','invitations'])assert.ok(!(BUSINESS_EXPORT_TABLES as readonly string[]).includes(table));
  assert.deepEqual(businessExportColumns(['id','ownerId','email','userId','actorUserId','pathname','password','passwordHash','MFASecret','replyTokenHash','apiKey','backupCodes','endpoint','auth','createdAt','invalid"name']),['id','ownerId','email','createdAt']);
});
test('platform identity backup does not become a tenant owner/admin privilege',()=>{
  assert.throws(()=>assertPlatformBackupAccess({role:'owner',organizationId:'daybook'}));
  for(const scope of [{role:'owner' as const,organizationId:'another-business'},{role:'admin' as const,organizationId:'daybook'},{role:'agent' as const,organizationId:'daybook'}])assert.throws(()=>assertPlatformBackupAccess(scope),/concesión/);
});
test('operational health exposes only classified errors',()=>{
  assert.equal(safeOperationalCode('lease_lost'),'lease_lost');
  assert.equal(safeOperationalCode('SQL failure $1 password=secret'),'operation_failed');
  assert.equal(safeOperationalCode(null),null);
});
test('business archive has authenticated encryption and a distinct non-restorable platform magic',()=>{
  const payload:BusinessExport={format:'daybook.business-export.v1',createdAt:at,organizationId:'company-a',tables:[],files:[],omissions:['No credentials.']};
  const password='Fictitious-only export password';
  const bytes=encryptBusinessExport(payload,password),start=BUSINESS_EXPORT_MAGIC.length;
  assert.ok(bytes.subarray(0,start).equals(BUSINESS_EXPORT_MAGIC));
  assert.ok(!bytes.includes(Buffer.from('company-a')));
  const key=scryptSync(password,bytes.subarray(start,start+16),32,{N:32768,maxmem:128*1024*1024});
  try{const decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(start+16,start+28));decipher.setAAD(BUSINESS_EXPORT_MAGIC);decipher.setAuthTag(bytes.subarray(start+28,start+44));assert.deepEqual(JSON.parse(gunzipSync(Buffer.concat([decipher.update(bytes.subarray(start+44)),decipher.final()])).toString()),payload);}finally{key.fill(0);bytes.fill(0);}
  assert.throws(()=>encryptBusinessExport(payload,'short'));
});
