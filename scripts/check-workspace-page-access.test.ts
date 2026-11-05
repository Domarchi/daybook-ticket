import assert from 'node:assert/strict';
import test from 'node:test';
import {workspacePageAccessDecision} from '../lib/workspace-page-access';
import {workspaceIdSchema} from '../lib/workspace-model';
test('an expired or absent identity returns to the requested ticket after login',()=>{
 const decision=workspacePageAccessDecision(401,'alpha','/w/alpha?ticket=7');assert.equal(decision?.kind,'redirect');
 if(decision?.kind!=='redirect')assert.fail();assert.equal(new URL(decision.href,'https://qa.example.test').pathname,'/login');assert.equal(new URL(decision.href,'https://qa.example.test').searchParams.get('return_to'),'/w/alpha?ticket=7');
});
test('forbidden membership produces only a generic denial and a safe account-switch destination',()=>{
 assert.deepEqual(workspacePageAccessDecision(403,'alpha','/w/alpha?ticket=7'),{kind:'denied',loginHref:'/login?return_to=%2Fw%2Falpha%3Fticket%3D7'});
 for(const destination of ['https://outside.example.test','//outside.example.test','/w/beta?ticket=9','/w/alpha?untrusted=detail'])assert.deepEqual(workspacePageAccessDecision(403,'alpha',destination),{kind:'denied',loginHref:'/login?return_to=%2Fw%2Falpha'});
});
test('MFA and onboarding retain their separate routes and preserve only the current business return',()=>{
 assert.deepEqual(workspacePageAccessDecision(428,'alpha','/w/alpha?ticket=7'),{kind:'redirect',href:'/w/alpha/security?return_to=%2Fw%2Falpha%3Fticket%3D7'});
 assert.deepEqual(workspacePageAccessDecision(423,'alpha','/w/alpha?ticket=7'),{kind:'redirect',href:'/w/alpha/onboarding'});
 assert.deepEqual(workspacePageAccessDecision(428,'alpha','/w/beta?ticket=9'),{kind:'redirect',href:'/w/alpha/security?return_to=%2Fw%2Falpha'});
});
test('unexpected server errors are not recast as login or membership failures',()=>{
 for(const status of [400,404,409,429,500,503])assert.equal(workspacePageAccessDecision(status,'alpha','/w/alpha'),null);
});
test('malformed route IDs fail safe parsing before the page can query identity or access',()=>{
 for(const id of ['',undefined,'bad.id','%2f','alpha/beta','../beta','a'.repeat(81)])assert.equal(workspaceIdSchema.safeParse(id).success,false);
 assert.equal(workspaceIdSchema.safeParse('alpha').success,true);
});
