import assert from 'node:assert/strict';
import test from 'node:test';
import type { Message } from '../lib/types';
import {
  appendedChatMessages,
  chatAuthorRole,
  chatDayKey,
  chatTimeLabel,
  findChatMatches,
  groupChatMessages,
  visibleChatMessages,
} from '../lib/ticket-chat';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TicketChat } from '../app/ticket-chat';

function message(id: number, change: Partial<Message> = {}): Message {
  return {
    id,
    ticketId: 9,
    author: 'Cliente ficticio',
    authorMemberId: 'qa-client',
    authorRole: 'client',
    body: `Mensaje ${id}`,
    kind: 'reply',
    createdAt: `2026-11-05T12:${String(id).padStart(2, '0')}:00.000Z`,
    attachments: [],
    ...change,
  };
}

test('customer display, search and incoming counts exclude private notes', () => {
  const publicMessage = message(1),
    internal = message(2, { kind: 'note', body: 'Clave interna', authorRole: 'agent' });
  assert.deepEqual(visibleChatMessages([publicMessage, internal], false), [publicMessage]);
  assert.deepEqual(findChatMatches([publicMessage, internal], 'interna', false), []);
  assert.deepEqual(findChatMatches([publicMessage, internal], 'interna', true), [2]);
  assert.deepEqual(
    appendedChatMessages(
      visibleChatMessages([publicMessage], false),
      visibleChatMessages([publicMessage, internal], false),
    ),
    [],
  );
});

test('roles come from the account rather than treating every reply as staff', () => {
  assert.equal(chatAuthorRole(message(1)), 'Cliente');
  assert.equal(chatAuthorRole(message(2, { authorRole: 'agent' })), 'Equipo Daybook');
  assert.equal(chatAuthorRole(message(3, { authorRole: null })), 'Mensaje');
  assert.equal(chatAuthorRole(message(4, { kind: 'note', authorRole: 'admin' })), 'Nota interna');
});

test('date groups and times follow Santiago rather than the browser timezone', () => {
  const earlier = message(1, { createdAt: '2026-11-06T02:59:00Z' });
  const later = message(2, { createdAt: '2026-11-06T03:00:00Z' });
  assert.equal(chatDayKey(earlier.createdAt), '2026-11-05');
  assert.equal(chatDayKey(later.createdAt), '2026-11-06');
  assert.equal(chatTimeLabel(earlier.createdAt), '23:59');
  assert.equal(chatTimeLabel(later.createdAt), '00:00');
  assert.deepEqual(
    groupChatMessages([earlier, later]).map(group => group.messages.map(item => item.id)),
    [[1], [2]],
  );
  assert.equal(chatDayKey('bad-date'), 'unknown');
});

test('local search handles accents, file names and literal potentially malicious input', () => {
  const messages = [
    message(1, {
      author: 'Joaquín',
      body: 'La configuración está lista',
      attachments: [{ id: 'file', name: 'Guía.pdf', size: 12, contentType: 'application/pdf' }],
    }),
    message(2, { body: '<script>alert(1)</script>' }),
  ];
  assert.deepEqual(findChatMatches(messages, 'configuracion', false), [1]);
  assert.deepEqual(findChatMatches(messages, 'joaquin', false), [1]);
  assert.deepEqual(findChatMatches(messages, 'GUIA.PDF', false), [1]);
  assert.deepEqual(findChatMatches(messages, '<script>', false), [2]);
  assert.deepEqual(findChatMatches(messages, '  ', false), []);
});

test('append classification ignores repeats, edited bodies and paginated history', () => {
  const previous = [message(5), message(6)];
  assert.deepEqual(appendedChatMessages(previous, [message(1), ...previous]), []);
  assert.deepEqual(appendedChatMessages(previous, [message(5, { body: 'Refresh' }), message(6)]), []);
  assert.deepEqual(
    appendedChatMessages(previous, [message(1), ...previous, message(7), message(8)]).map(item => item.id),
    [7, 8],
  );
  assert.deepEqual(appendedChatMessages([], previous), []);
  const sameTime = message(7, { createdAt: previous[1].createdAt });
  assert.deepEqual(
    appendedChatMessages(previous, [...previous, sameTime]).map(item => item.id),
    [7],
  );
});

test('sorting does not mutate incoming snapshots and uses numeric ids for equal timestamps', () => {
  const input = [message(3, { createdAt: '2026-11-05T12:00:00Z' }), message(2, { createdAt: '2026-11-05T12:00:00Z' })];
  assert.deepEqual(
    visibleChatMessages(input, true).map(item => item.id),
    [2, 3],
  );
  assert.deepEqual(
    input.map(item => item.id),
    [3, 2],
  );
});

test('the rendered customer chat excludes note content, note filenames and private authors', () => {
  const messages = [
    message(1, { body: '<script>public text</script>' }),
    message(2, {
      kind: 'note',
      body: 'Secret fixture note',
      author: 'Private staff fixture',
      attachments: [
        {
          id: 'private-file',
          name: 'Private attachment.xlsx',
          size: 20,
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
      ],
    }),
  ];
  const html = renderToStaticMarkup(
    createElement(TicketChat, {
      messages,
      viewerId: 'qa-client',
      staff: false,
      hasOlder: false,
      loadingOlder: false,
      onLoadOlder: () => undefined,
    }),
  );
  assert.equal(html.includes('Secret fixture note'), false);
  assert.equal(html.includes('Private attachment'), false);
  assert.equal(html.includes('Private staff fixture'), false);
  assert.equal(html.includes('private-file'), false);
  assert.equal(html.includes('<script>'), false);
  assert.match(html, /&lt;script&gt;public text&lt;\/script&gt;/);
  assert.match(html, /1 mensaje cargado/);
});
