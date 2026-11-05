import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { quoteIsAllowed,safeMentionIds } from '../lib/collaboration-model';
import { parseEvolutionFeatures } from '../lib/evolution-feature-model';
import { messageSchema } from '../lib/server';
import { operationHash } from '../lib/ticket-mutations';
import { TicketChat } from '../app/ticket-chat';
import type { Message } from '../lib/types';

test('public replies and clients cannot cite private or unrelated messages',()=>{
 const note={kind:'note' as const,ticketId:4};
 assert.equal(quoteIsAllowed(note,{kind:'reply',ticketId:4,client:false}),false);
 assert.equal(quoteIsAllowed(note,{kind:'note',ticketId:4,client:true}),false);
 assert.equal(quoteIsAllowed(note,{kind:'note',ticketId:4,client:false}),true);
 assert.equal(quoteIsAllowed({kind:'reply',ticketId:5},{kind:'reply',ticketId:4,client:false}),false);
 assert.equal(quoteIsAllowed({kind:'request',ticketId:4},{kind:'reply',ticketId:4,client:true}),true);
});
test('mentions are explicit, note-only and do not notify the author twice',()=>{
 assert.deepEqual(safeMentionIds(['peer','peer','author'],'author','note'),['peer']);
 assert.throws(()=>safeMentionIds(['peer'],'author','reply'));
});
test('legacy message payloads retain the same idempotency hash',()=>{
 const legacy={operationId:'71526d89-aeb0-42c9-a3da-f2b690108185',attachmentIds:[],body:'Fictitious retry',kind:'reply'};
 const parsed=messageSchema.parse(legacy);
 assert.equal('mentionMemberIds' in parsed,false);
 assert.equal('replyToMessageId' in parsed,false);
 assert.equal(operationHash({ticketId:4,...parsed}),operationHash({ticketId:4,...legacy}));
});
test('features default to paused and ignore invalid or unknown settings',()=>{
 assert.ok(Object.values(parseEvolutionFeatures(null)).every(value=>value===false));
 assert.equal(parseEvolutionFeatures('{"collaboration":"true","unknown":true}').collaboration,false);
 assert.equal(parseEvolutionFeatures('{"collaboration":true}').collaboration,true);
 assert.ok(Object.values(parseEvolutionFeatures('not-json')).every(value=>value===false));
});
test('customer rendering defensively strips private citations and mentions',()=>{
 const message:Message={id:1,ticketId:4,author:'Customer',authorMemberId:'client',authorRole:'client',body:'Public QA',kind:'reply',createdAt:'2026-11-05T12:00:00Z',attachments:[],quote:{id:2,author:'PRIVATE-STAFF-NAME',body:'PRIVATE-QUOTED-BODY',kind:'note',createdAt:'2026-11-05T11:00:00Z'},mentions:[{id:'secret-member',name:'PRIVATE-MENTION-NAME'}]};
 const html=renderToStaticMarkup(createElement(TicketChat,{ticketId:4,collaboration:true,messages:[message],viewerId:'client',staff:false,hasOlder:false,loadingOlder:false,onLoadOlder:()=>undefined}));
 assert.match(html,/Public QA/);assert.ok(!html.includes('PRIVATE-'));assert.ok(!html.includes('secret-member'));
 assert.match(html,/Buscar en toda la conversación/);assert.match(html,/Archivos del ticket/);
 assert.ok(!html.includes('Seguir el ticket'));
});
