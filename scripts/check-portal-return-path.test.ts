import test from 'node:test';
import assert from 'node:assert/strict';
import {portalReturnPath,safeTicketReturnPath,ticketLoginPath} from '../lib/return-path';
const company='af1aba5f-a6ba-4a09-98f1-fc39ccf1d172';
test('old Daybook and scoped ticket/service links survive the validated login round trip',()=>{
 for(const [workspace,query,expected] of [
  ['daybook',{ticket:'6'},'/?ticket=6'],['alpha',{ticket:'6'},'/w/alpha?ticket=6'],
  ['daybook',{serviceContext:'1',company},`/?serviceContext=1&company=${company}`],['alpha',{serviceContext:'1',company},`/w/alpha?serviceContext=1&company=${company}`],
 ] as const){const target=portalReturnPath(workspace,query);assert.equal(target,expected);const login=new URL(ticketLoginPath(target),'https://qa.example.test');assert.equal(login.pathname,'/login');assert.equal(safeTicketReturnPath(login.searchParams.get('return_to')),expected);}
 assert.equal(safeTicketReturnPath('/w/daybook?ticket=6'),'/?ticket=6');
 assert.equal(portalReturnPath('alpha',{ticket:['6','7']}),'/w/alpha');
 assert.equal(portalReturnPath('alpha',{serviceContext:'1',company:'https://outside.test'}),'/w/alpha');
});
test('only exact known local destinations and one known parameter set can pass through login',()=>{
 for(const value of ['https://outside.test/w/alpha?ticket=6','//outside.test','/w/alpha/../beta?ticket=6','/w/alpha?ticket=6&redirect=https://outside.test',`/w/alpha?serviceContext=1&company=${company}&company=${company}`,'/?ticket=6&serviceContext=1','/operator','/w/alpha/security','/w/alpha?serviceContext=0','/w/alpha?company='+company,'/w/%2f?ticket=6','/w/alpha?ticket=9007199254740992'])assert.equal(safeTicketReturnPath(value),'/',value);
 assert.equal(safeTicketReturnPath('/w/alpha?serviceContext=1'),'/w/alpha?serviceContext=1');
 assert.equal(safeTicketReturnPath('/workspaces'),'/workspaces');
});
