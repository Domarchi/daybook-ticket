// El riel y el menú del teléfono de Ticket, iguales a los de Parte Diario (2026-11-19, @daybook/design 0.10):
// el pie común (persona + botón del tema), «Cerrar sesión» en Configuración, la lista que se desplaza sola y el
// cajón con su velo. Las medidas y el comportamiento en el navegador están en e2e/tests/desk.spec.ts y mobile.spec.ts.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('the rail footer is the shared one: avatar, name, role and the 44 px theme button in one row', async () => {
  const sidebar = await read('app/desk-parts/sidebar.tsx');
  assert.match(
    sidebar,
    /<div className="db-rail-footer">[\s\S]*<div className="db-rail-account">\s*<span className="db-rail-avatar" aria-hidden="true">\s*\{initials\(viewerName\) \|\| '\?'\}/,
  );
  assert.match(sidebar, /<strong className="db-rail-account__name">\{viewerName\}<\/strong>/);
  assert.match(sidebar, /<small className="db-rail-account__role">/);
  assert.match(sidebar, /<ThemeCycleButton theme=\{theme\} onChoose=\{onChooseTheme\} \/>/);
  // No theme <select>, no logout and no security shortcut in the rail any more.
  assert.doesNotMatch(sidebar, /ThemeControl|<select|profile|sidebar-bottom|signOut/);
  assert.match(sidebar, /<div className="db-rail-scroll">/);
});

test('the last group is Configuración, Ajustes del espacio (admins) and Centro de ayuda', async () => {
  const sidebar = await read('app/desk-parts/sidebar.tsx');
  const group = sidebar.slice(sidebar.indexOf('aria-label="Cuenta y ayuda"'));
  const order = [
    '<hr className="db-rail-divider" />',
    'label="Configuración"',
    'label="Ajustes del espacio"',
    'label="Centro de ayuda"',
  ];
  const positions = order.map(text => group.indexOf(text));
  assert.ok(
    positions.every(position => position >= 0),
    'every row is there',
  );
  assert.deepEqual(
    [...positions].sort((a, b) => a - b),
    positions,
    'in this order',
  );
  assert.match(
    group,
    /<RailLink view="account" current=\{view\} go=\{go\} icon=\{<Settings \/>\} label="Configuración" \/>/,
  );
  assert.match(group, /\{isAdmin && \(\s*<RailLink\s+view="settings"/);
  assert.doesNotMatch(sidebar, /label="Seguridad"/);
  // Only an overdue SLA asks for attention; the other counts are plain.
  assert.equal(sidebar.match(/db-rail-count--alert/g)?.length, 1);
  assert.match(sidebar, /queue === 'overdue' && overdue > 0 \?/);
});

test('the theme button cycles Sistema → Claro → Oscuro and says what it is and what comes next', async () => {
  const controls = await read('app/evolution-controls.tsx');
  assert.match(controls, /return theme === 'system' \? 'light' : theme === 'light' \? 'dark' : 'system';/);
  assert.match(controls, /aria-label=\{`Tema: \$\{THEME_LABELS\[theme\]\}`\}/);
  assert.match(controls, /title=\{`Cambiar a \$\{THEME_LABELS\[next\]\}`\}/);
  assert.match(controls, /className="db-rail-icon-button"/);
  // The icon is keyed by the choice, so it fades in (riel.css @starting-style) every time it changes.
  assert.match(controls, /<Icon key=\{theme\} aria-hidden="true" \/>/);
  // While the theme changes nothing animates; the class leaves on the next frame.
  assert.match(controls, /root\.classList\.add\('db-theme-switching'\);/);
  assert.match(controls, /requestAnimationFrame\(\(\) => root\.classList\.remove\('db-theme-switching'\)\)/);
  // The preference is still saved to the account, as before.
  assert.match(controls, /daybookFetch\('\/api\/preferences', \{\s*method: 'PUT'/);
});

test('the phone drawer uses the shared drawer and scrim, and the view fades in by view', async () => {
  const [sidebar, desk, css] = await Promise.all([
    read('app/desk-parts/sidebar.tsx'),
    read('app/desk.tsx'),
    read('app/globals.css'),
  ]);
  assert.match(sidebar, /className=\{`sidebar\$\{narrow \? ' db-rail-drawer' : ''\}`\}/);
  assert.match(sidebar, /data-open=\{narrow \? String\(open\) : undefined\}/);
  assert.match(sidebar, /className="db-rail-icon-button sidebar-close" aria-label="Cerrar menú"/);
  assert.match(
    desk,
    /<div className="db-rail-scrim" data-open=\{String\(drawerOpen\)\} aria-hidden="true" onClick=\{closeMenu\} \/>/,
  );
  assert.match(desk, /<div className="db-view-enter" key=\{ticketId \? `ticket:\$\{ticketId\}` : view\}>/);
  // Ticket's own slide, scrim colour and visibility switch are gone: the shared drawer slides out instead of vanishing.
  assert.doesNotMatch(css, /\.sidebar\.is-open|sidebar-scrim|transition:transform \.2s/);
  assert.doesNotMatch(css, /\.sidebar\{visibility:hidden\}/);
  // The rail takes its colours from the --db-rail-* tokens.
  assert.doesNotMatch(css, /#ffffff1c|#aaa9a1|#c4c5c0/);
});

test('Configuración has Apariencia, Cuenta with the account security, Sesión and Ayuda', async () => {
  const account = await read('app/desk-parts/account-view.tsx');
  const sections = ['Apariencia', 'Cuenta', 'Sesión', 'Ayuda'].map(name =>
    account.indexOf(`<span className="settings-kicker">${name}</span>`),
  );
  assert.ok(sections.every(position => position >= 0));
  assert.deepEqual(
    [...sections].sort((a, b) => a - b),
    sections,
  );
  assert.match(account, /<ThemeChoice theme=\{theme\} onChoose=\{onChooseTheme\} \/>/);
  assert.match(account, /<SecurityCenter\s/);
  assert.match(account, /<SecurityHealthPanel /);
  const section = await read('app/desk-parts/section-view.tsx');
  assert.doesNotMatch(section, /SecurityCenter|view === 'security'/, 'the old Seguridad view is gone');
});
