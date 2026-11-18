// El redactor del ticket (equipo y portal) en el teléfono: con el dedo, cada
// control llega a 44 px. Las reglas de ticket-chat.css tienen más especificidad
// que el mínimo general de accessibility.css, así que el mínimo se repite acá,
// con la misma especificidad, dentro de (pointer: coarse).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const css = readFileSync(join(import.meta.dirname, '..', 'app', 'ticket-chat.css'), 'utf8');

function coarseBlock(): string {
  const start = css.indexOf('@media (pointer: coarse)');
  assert.ok(start >= 0, 'ticket-chat.css tiene un bloque para el dedo');
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return css.slice(start, i + 1);
  }
  throw new Error('bloque sin cerrar');
}

test('los controles del redactor llegan a 44 px con el dedo', () => {
  const block = coarseBlock();
  for (const selector of [
    '.ticket-chat .composer-tabs button',
    '.ticket-chat .message-editor-toolbar button',
    '.ticket-chat .ticket-chat-composer .attachment-picker',
    '.ticket-chat .composer-footer .primary',
  ]) {
    const at = block.indexOf(`${selector} {`);
    assert.ok(at >= 0, `${selector} dentro de (pointer: coarse)`);
    const rule = block.slice(at, block.indexOf('}', at));
    assert.match(rule, /min-height: var\(--touch-target\)/, selector);
  }
});

test('el selector «Respuesta / Nota interna» ocupa todo el ancho, en dos mitades', () => {
  assert.match(coarseBlock(), /\.ticket-chat \.composer-tabs button \{ flex: 1 1 0;/);
});

test('el bloque para el dedo va después de las reglas que anula', () => {
  const coarse = css.indexOf('@media (pointer: coarse)');
  assert.ok(css.indexOf('.ticket-chat .composer-tabs button { min-height: 32px') < coarse);
  assert.ok(css.lastIndexOf('.ticket-chat .composer-footer .primary { font-size') < coarse);
});
