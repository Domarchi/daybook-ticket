import assert from 'node:assert/strict';

/** QA readers follow every authorized page instead of mistaking page one for all. */
export async function readAllTicketPages(read, parameters = {}) {
  const tickets = [], seen = new Set(), cursors = new Set();
  let cursor = null, total;
  do {
    const params = new URLSearchParams({ ...parameters, limit: '100' });
    if (cursor) params.set('cursor', cursor);
    const page = await read(`/api/tickets/search?${params}`);
    assert.ok(Array.isArray(page.items) && page.items.length <= 100);
    total ??= page.total;
    assert.equal(page.total, total, 'QA fixtures must remain stable during the paginated read.');
    for (const ticket of page.items) { assert.ok(!seen.has(ticket.id), 'No ticket may repeat across stable pages.'); seen.add(ticket.id); tickets.push(ticket); }
    cursor = page.nextCursor;
    if (cursor) { assert.ok(!cursors.has(cursor), 'Pagination must advance.'); cursors.add(cursor); }
    assert.ok(cursors.size < 1000, 'QA pagination exceeded its safety bound.');
  } while (cursor);
  assert.equal(tickets.length, total);
  return tickets;
}

export async function readAllConversationPages(read, ticketId) {
  const messages = [], seen = new Set(), cursors = new Set();
  let cursor = null;
  do {
    const params = new URLSearchParams({ limit: '100' });
    if (cursor) params.set('cursor', cursor);
    const page = await read(`/api/tickets/${ticketId}/conversation?${params}`);
    assert.equal(page.ticket.id, ticketId);
    assert.ok(Array.isArray(page.messages) && page.messages.length <= 100);
    for (const message of page.messages) { assert.ok(!seen.has(message.id), 'No message may repeat across stable pages.'); seen.add(message.id); messages.push(message); }
    cursor = page.nextCursor;
    if (cursor) { assert.ok(!cursors.has(cursor), 'Conversation pagination must advance.'); cursors.add(cursor); }
    assert.ok(cursors.size < 1000, 'QA conversation exceeded its safety bound.');
  } while (cursor);
  return messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id);
}
