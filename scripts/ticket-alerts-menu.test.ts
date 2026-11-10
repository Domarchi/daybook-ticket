import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PushMenu } from '../app/push-menu';
import type { WebPushControls } from '../hooks/use-web-push';

const noop = () => undefined;
const push = (over: Partial<WebPushControls> = {}): WebPushControls => ({ status: 'active', busy: false, error: '', notice: '', enable: noop, disable: noop, test: noop, testLocal: noop, refresh: noop, ...over });

test('with desktop notifications active the bar shows one collapsed button, not four controls', () => {
  const html = renderToStaticMarkup(createElement(PushMenu, { push: push() }));
  assert.match(html, /Avisos en este equipo/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-controls="[^"]+"/);
  assert.doesNotMatch(html, /Probar aviso|Probar en este equipo|Desactivar/);
  assert.equal((html.match(/<button/g) || []).length, 1);
});

test('the alert bar keeps the sound toggle marker and the bell, and uses the menu only when active', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../app/ticket-alerts.tsx', import.meta.url), 'utf8');
  assert.match(source, /data-sound-toggle/, 'hooks/use-ticket-alerts.ts relies on this marker to unlock audio');
  assert.match(source, /alerts\.push\.status === 'active' \? <PushMenu push=\{alerts\.push\} \/>/);
  assert.doesNotMatch(source, /Probar aviso/, 'the test buttons now live in the panel');
  assert.match(source, /alerts\.push\.notice && <p>/, 'a test result stays visible with the panel closed');
});
