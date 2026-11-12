import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';

const app = join(import.meta.dirname, '..', 'app');
const read = (name: string) => readFileSync(join(app, name), 'utf8');

/** Custom properties declared in the first block whose selector contains `selector`. */
function block(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  assert.ok(start >= 0, `selector not found: ${selector}`);
  const open = css.indexOf('{', start),
    close = css.indexOf('}', open);
  return Object.fromEntries(
    [...css.slice(open + 1, close).matchAll(/(--[\w-]+)\s*:\s*([^;]+);?/g)].map(m => [m[1], m[2].trim()]),
  );
}

/** #abc and #aabbcc are the same color. */
const normalize = (value: string) => value.toLowerCase().replace(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/, '#$1$1$2$2$3$3');

function luminance(hex: string): number {
  const channels = [1, 3, 5]
    .map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Shared colors come from @daybook/design as var(--db-*). Resolve them against the
// package for each scheme so the contrast checks compare real colors.
type Scheme = 'light' | 'dark';
// Colors change per scheme; `escala` (type, radius, spacing) is one for both.
const shared: Record<Scheme | 'escala', Record<string, string>> = JSON.parse(
  readFileSync(createRequire(import.meta.url).resolve('@daybook/design/tokens.json'), 'utf8'),
);
const resolve = (values: Record<string, string>, scheme: Scheme) =>
  Object.fromEntries(
    Object.entries(values).map(([name, value]) => [
      name,
      value.replace(/var\(--db-([\w-]+)\)/g, (_, key: string) => {
        const value = shared[scheme][key] ?? shared.escala?.[key];
        assert.ok(value, `@daybook/design does not define --db-${key}`);
        return value;
      }),
    ]),
  );

const tokens = read('tokens.css');
const lightRaw = block(tokens, ':root {');
const darkOverrides = block(tokens, ':root[data-color-scheme="dark"]');
const darkMedia = block(tokens.slice(tokens.indexOf('@media')), ':root:not([data-color-scheme="light"])');
const light = resolve(lightRaw, 'light');
const dark = resolve({ ...lightRaw, ...darkOverrides }, 'dark');

const pairs: Array<[string, string, number, string]> = [
  ['--color-text', '--color-bg', 4.5, 'body text'],
  ['--color-text', '--color-surface', 4.5, 'text on cards'],
  ['--color-text-muted', '--color-bg', 4.5, 'secondary text'],
  ['--color-text-muted', '--color-surface', 4.5, 'secondary text on cards'],
  ['--color-accent', '--color-surface', 4.5, 'accent text'],
  ['--color-accent', '--color-accent-soft', 4.5, 'tags'],
  ['--color-danger-text', '--color-danger-bg', 4.5, 'error banner'],
  ['--color-border-strong', '--color-surface', 3, 'form control border'],
  ['--color-border-strong', '--color-bg', 3, 'form control border on the page'],
  ['--color-focus', '--color-bg', 3, 'focus ring'],
  ['--color-focus', '--color-surface', 3, 'focus ring on cards'],
];

for (const [scheme, palette] of [
  ['light', light],
  ['dark', dark],
] as const) {
  test(`${scheme} tokens meet WCAG AA contrast`, () => {
    for (const [fg, bg, minimum, what] of pairs) {
      const ratio = contrast(palette[fg], palette[bg]);
      assert.ok(ratio >= minimum, `${scheme}: ${what} (${fg} on ${bg}) is ${ratio.toFixed(2)}:1, needs ${minimum}:1`);
    }
  });
}

test('the prefers-color-scheme dark block repeats the explicit dark block exactly', () => {
  assert.deepEqual(darkMedia, darkOverrides);
});

test('semantic tokens match the legacy palette they alias (no silent drift)', () => {
  const legacyRaw = block(read('globals.css'), ':root{');
  const legacyLight = resolve(legacyRaw, 'light');
  const legacyDark = resolve(
    { ...legacyRaw, ...block(read('evolution-theme.css'), ':root[data-color-scheme="dark"]{') },
    'dark',
  );
  const map: Record<string, string> = {
    '--color-bg': '--paper',
    '--color-surface': '--surface',
    '--color-text': '--ink',
    '--color-text-muted': '--muted',
    '--color-border': '--line',
    '--color-accent': '--accent',
    '--color-accent-soft': '--accent-soft',
  };
  for (const [token, legacy] of Object.entries(map)) {
    assert.equal(normalize(light[token]), normalize(legacyLight[legacy]), `light ${token} vs ${legacy}`);
    assert.equal(normalize(dark[token]), normalize(legacyDark[legacy]), `dark ${token} vs ${legacy}`);
  }
});

test('every token used by the token-based sheets is defined', () => {
  for (const sheet of [
    'accessibility.css',
    'mobile-inbox.css',
    'optimistic.css',
    'combobox.css',
    'settings-nav.css',
    'login/login.css',
  ]) {
    const used = [...read(sheet).matchAll(/var\((--[\w-]+)\)/g)].map(m => m[1]);
    assert.ok(used.length > 0, `${sheet} should use tokens`);
    for (const name of used) assert.ok(name in light, `${name} (used by ${sheet}) is not defined in tokens.css`);
  }
});

test('the sign-in page has no fixed white surfaces, so dark mode cannot leave light text on a white card', () => {
  const css = read('login/login.css');
  assert.doesNotMatch(css, /background:\s*#fff(?:fff)?\b/i);
  for (const piece of ['.auth-topbar', '.auth-form-wrap{', '.auth-footer']) {
    const at = css.indexOf(piece);
    assert.ok(at >= 0, `${piece} missing`);
    assert.match(
      css.slice(at, css.indexOf('}', at)),
      /background:var\(--color-surface\)/,
      `${piece} uses the surface token`,
    );
  }
  for (const scope of [
    '@media(prefers-color-scheme:dark){:root:not([data-color-scheme="light"]) .auth-submit{',
    ':root[data-color-scheme="dark"] .auth-submit{',
  ]) {
    assert.ok(css.includes(scope), `dark sign-in button rule: ${scope}`);
  }
});

test('the light-surface brand swaps to the light-ink mark in dark mode', () => {
  const theme = read('evolution-theme.css');
  assert.match(theme, /\.daybook-brand img\.daybook-mark-dark\{display:none\}/);
  assert.match(
    theme,
    /:root\[data-color-scheme="dark"\] \.daybook-brand:not\(\.daybook-brand-dark\) img\.daybook-mark-dark\{display:block\}/,
  );
  assert.match(
    theme,
    /:root:not\(\[data-color-scheme="light"\]\) \.daybook-brand:not\(\.daybook-brand-dark\) img\.daybook-mark-light\{display:none\}/,
  );
});
