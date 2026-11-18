// Portal del cliente: el aviso tras una acción es el mismo del escritorio del
// equipo (abajo al centro, Fase 5 del estándar Daybook), y el nuevo ticket dice
// qué le falta bajo el campo al pulsar «Crear ticket» en vez de apagar el botón.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('los avisos del portal usan la .toast-region del escritorio, con alerta para el error', async () => {
  const [portal, css] = await Promise.all([read('app/client-portal.tsx'), read('app/client-portal.css')]);
  assert.doesNotMatch(portal, /client-feedback (error|success)/, 'sin la banda arriba del contenido');
  assert.doesNotMatch(portal, /CircleHelp/, 'el error ya no lleva el ícono de ayuda');
  assert.match(portal, /<div className="toast-region" role="alert" aria-atomic="true">/);
  assert.match(portal, /<div className="toast error">\s*<AlertTriangle size=\{18\} aria-hidden="true" \/>/);
  assert.match(portal, /className="toast-close" onClick=\{\(\) => setError\(''\)\} aria-label="Cerrar aviso"/);
  assert.match(portal, /<div className="toast-region" role="status" aria-live="polite" aria-atomic="true">/);
  assert.match(portal, /\{notice && !error && \(/, 'mientras hay un error, es el único aviso');
  // Sin riel, el aviso va al centro de la página y no corrido por el ancho del riel.
  assert.match(css, /\.client-shell \.toast-region \{ left: 50%;/);
  assert.doesNotMatch(css, /\.client-feedback\.(error|success)/, 'sin los colores de la banda que ya no existe');
});

test('el nuevo ticket del portal valida al enviar y dice bajo el campo qué falta', async () => {
  const [portal, editor, css, globals] = await Promise.all([
    read('app/client-portal.tsx'),
    read('app/message-content.tsx'),
    read('app/client-portal.css'),
    read('app/globals.css'),
  ]);
  assert.match(portal, /<form className="client-new-ticket" onSubmit=\{createTicket\} noValidate>/);
  assert.match(
    portal,
    /<button className="primary" disabled=\{busy \|\| !createAttachments\.canSubmit\}>/,
    '«Crear ticket» ya no se apaga por un campo vacío',
  );
  assert.match(portal, /subject: draft\.subject\.trim\(\) \? undefined : 'Escribe el asunto'/);
  assert.match(portal, /body: draft\.body\.trim\(\) \? undefined : 'Escribe la descripción'/);
  assert.match(
    portal,
    /getElementById\(lacking\.subject \? 'new-ticket-subject' : 'new-ticket-description'\)\?\.focus\(\)/,
  );
  assert.match(portal, /aria-invalid=\{Boolean\(missing\.subject\)\}/);
  assert.match(portal, /<small id="new-ticket-subject-error" className="client-field-error" role="alert">/);
  assert.match(portal, /<small id="new-ticket-description-error" className="client-field-error" role="alert">/);
  assert.match(portal, /errorId=\{missing\.body \? 'new-ticket-description-error' : undefined\}/);
  assert.match(editor, /aria-describedby=\{errorId \? `\$\{helpId\} \$\{errorId\}` : helpId\}/);
  assert.match(editor, /aria-invalid=\{errorId \? true : undefined\}/);
  // Departamento se sigue pidiendo; la prioridad la pone el equipo (decisión de producto).
  assert.match(portal, />\s*Departamento\s*<select/);
  assert.match(css, /\.client-field-error \{ color: var\(--db-danger\);/);
  // Un botón apagado no está «cargando»: el cursor de espera lo hacía parecer.
  assert.match(globals, /button:disabled\{opacity:\.55;cursor:not-allowed\}/);
  assert.doesNotMatch(globals, /button:disabled\{[^}]*cursor:wait/);
});

test('un aviso largo se parte en líneas dentro de la pantalla en vez de salirse', async () => {
  const globals = await read('app/globals.css');
  assert.match(globals, /\.toast-region\{[^}]*display:grid;grid-template-columns:minmax\(0,1fr\);/);
});
