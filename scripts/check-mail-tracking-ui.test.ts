import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { MailDeliveryItem } from '../lib/mail-delivery';
import { MailTrackingList } from '../app/mail-delivery-list';

test('delivery history identifies survey and escalation while preserving separate acceptance and delivery states', () => {
  const row = (event: string): MailDeliveryItem => ({ id: event, event, recipientEmail: 'qa@example.test', status: 'accepted', attempts: 1,
    createdAt: '2026-11-05T16:00:00.000Z', nextAttemptAt: null, error: null, deliveryStatus: 'delivered',
    deliveryEventAt: '2026-11-05T16:00:01.000Z', deliveredAt: '2026-11-05T16:00:01.000Z', bouncedAt: null, complainedAt: null,
    history: [{ eventType: 'email.delivered', occurredAt: '2026-11-05T16:00:01.000Z' }] });
  const messages = [row('satisfaction_requested'), row('escalation')];
  const html = renderToStaticMarkup(createElement(MailTrackingList, { messages }));
  assert.ok(html.includes('<strong>Encuesta de atención</strong>'));
  assert.ok(html.includes('<strong>Escalamiento</strong>'));
  assert.ok(!html.includes('Aviso de soporte'));
  assert.ok(html.includes('Aceptado por proveedor'));
  assert.ok(html.includes('Entregado al servidor de correo'));
  assert.ok(html.includes('Ver historial de entrega (1)'));
});
test('delivery rows escape recipient/error text and ignore private payload properties', () => {
  const message: MailDeliveryItem & { payloadJson: string } = { id: 'safe', event: 'escalation', recipientEmail: '<script>bad</script>@example.test', status: 'queued', attempts: 0,
    createdAt: '2026-11-05T16:00:00.000Z', nextAttemptAt: null, error: '<img src=x onerror=bad>', deliveryStatus: 'untracked', deliveryEventAt: null,
    deliveredAt: null, bouncedAt: null, complainedAt: null, history: [], payloadJson: 'PRIVATE_FROZEN_BODY_SENTINEL' };
  const html = renderToStaticMarkup(createElement(MailTrackingList, { messages: [message] }));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('PRIVATE_FROZEN_BODY_SENTINEL'));
  assert.ok(html.includes('&lt;script&gt;'));
});
