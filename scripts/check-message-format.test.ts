import assert from 'node:assert/strict';
import test from 'node:test';
import { formatSelection, messageBlocks, messageInlineParts, safeMessageLink } from '../lib/message-format';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MessageContent } from '../app/message-content';
import { messageSchema } from '../lib/server';
import { operationHash } from '../lib/ticket-mutations';
test('message links reject executable, encoded control and credential URLs', () => {
  for (const value of [
    'javascript:alert(1)',
    'data:text/html,test',
    '//evil.test',
    'https://user:secret@example.test',
    'https://example.test/\npath',
    'mailto:support@example.test?subject=%0aInjected',
  ])
    assert.equal(safeMessageLink(value), null);
  assert.equal(safeMessageLink('https://example.test/help?a=1&b=2'), 'https://example.test/help?a=1&b=2');
  assert.equal(safeMessageLink('mailto:support@example.test'), 'mailto:support@example.test');
});
test('pathological markup stays bounded without losing the original text', () => {
  const brackets = '['.repeat(20000);
  assert.deepEqual(messageInlineParts(brackets), [{ type: 'text', text: brackets }]);
  const repeated = '**x** '.repeat(3000);
  assert.deepEqual(messageInlineParts(repeated), [{ type: 'text', text: repeated }]);
  const newlines = '\n'.repeat(10000);
  assert.deepEqual(messageBlocks(newlines), [{ type: 'paragraph', lines: [newlines] }]);
});
test('rendering versions preserve legacy text and escape HTML even inside formatting', () => {
  assert.equal(
    renderToStaticMarkup(createElement(MessageContent, { body: '**Texto antiguo**', format: 'plain' })).includes(
      '<strong>',
    ),
    false,
  );
  const html = renderToStaticMarkup(
    createElement(MessageContent, {
      body: '**<img src=x onerror=alert(1)>** [no](javascript:alert)',
      format: 'markdown',
    }),
  );
  assert.match(html, /<strong>&lt;img/);
  assert.equal(html.includes('<img'), false);
  assert.equal(html.includes('href="javascript:'), false);
});
test('omitting the new format preserves the original operation payload hash', () => {
  const old = {
    operationId: '875a0fc0-93ea-4b9b-9b2d-ddb536bcfe7a',
    body: 'Texto',
    kind: 'reply' as const,
    attachmentIds: [],
  };
  const current = messageSchema.parse(old);
  assert.equal(Object.hasOwn(current, 'bodyFormat'), false);
  assert.equal(operationHash({ ticketId: 6, ...current }), operationHash({ ticketId: 6, ...old }));
  assert.notEqual(operationHash({ ...current, bodyFormat: 'markdown' }), operationHash(current));
});
test('formatting treats HTML and malicious markdown as literal text', () => {
  const parts = messageInlineParts('<img src=x onerror=alert(1)> **bien** [no](javascript:alert)');
  assert.equal(parts[0].type, 'text');
  assert.match(parts[0].text, /onerror/);
  assert.equal(parts[1].type, 'bold');
  assert.equal(parts[1].text, 'bien');
  assert.equal(parts.at(-1)?.type, 'text');
  assert.match(parts.at(-1)!.text, /javascript/);
});
test('list blocks and toolbar selections preserve text around the selection', () => {
  assert.deepEqual(
    messageBlocks('Hola\n- Uno\n- Dos\n1. Tres').map(block => block.type),
    ['paragraph', 'unordered', 'ordered'],
  );
  assert.deepEqual(formatSelection('Hola mundo', 5, 10, 'bold'), { body: 'Hola **mundo**', start: 7, end: 12 });
  assert.equal(formatSelection('Uno\nDos', 0, 7, 'ordered').body, '1. Uno\n2. Dos');
});
