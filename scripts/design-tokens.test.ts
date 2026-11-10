import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const app = join(import.meta.dirname, '..', 'app');
const read = (name: string) => readFileSync(join(app, name), 'utf8');

/** Custom properties declared in the first block whose selector contains `selector`. */
function block(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  assert.ok(start >= 0, `selector not found: ${selector}`);
  const open = css.indexOf('{', start), close = css.indexOf('}', open);
  return Object.fromEntries([...css.slice(open + 1, close).matchAll(/(--[\w-]+)\s*:\s*([^;]+);?/g)].map(m => [m[1], m[2].trim()]));
}

/** #abc and #aabbcc are the same color. */
const normalize = (value: string) => value.toLowerCase().replace(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/, '#$1$1$2$2$3$3');

function luminance(hex: string): number {
  const channels = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const tokens = read('tokens.css');
const light = block(tokens, ':root {');
const dark = block(tokens, ':root[data-color-scheme="dark"]');
const darkMedia = block(tokens.slice(tokens.indexOf('@media')), ':root:not([data-color-scheme="light"])');

const pairs: Array<[string, string, number, string]> = [
  ['--color-text', '--color-bg', 4.5, 'body text'], ['--color-text', '--color-surface', 4.5, 'text on cards'],
  ['--color-text-muted', '--color-bg', 4.5, 'secondary text'], ['--color-text-muted', '--color-surface', 4.5, 'secondary text on cards'],
  ['--color-accent', '--color-surface', 4.5, 'accent text'], ['--color-accent', '--color-accent-soft', 4.5, 'tags'],
  ['--color-danger-text', '--color-danger-bg', 4.5, 'error banner'],
  ['--color-border-strong', '--color-surface', 3, 'form control border'], ['--color-border-strong', '--color-bg', 3, 'form control border on the page'],
  ['--color-focus', '--color-bg', 3, 'focus ring'], ['--color-focus', '--color-surface', 3, 'focus ring on cards'],
];

for (const [scheme, palette] of [['light', light], ['dark', dark]] as const) {
  test(`${scheme} tokens meet WCAG AA contrast`, () => {
    for (const [fg, bg, minimum, what] of pairs) {
      const ratio = contrast(palette[fg], palette[bg]);
      assert.ok(ratio >= minimum, `${scheme}: ${what} (${fg} on ${bg}) is ${ratio.toFixed(2)}:1, needs ${minimum}:1`);
    }
  });
}

test('the prefers-color-scheme dark block repeats the explicit dark block exactly', () => {
  assert.deepEqual(darkMedia, dark);
});

test('semantic tokens match the legacy palette they alias (no silent drift)', () => {
  const legacyLight = block(read('globals.css'), ':root{');
  const legacyDark = block(read('evolution-theme.css'), ':root[data-color-scheme="dark"]{');
  const map: Record<string, string> = { '--color-bg': '--paper', '--color-surface': '--surface', '--color-text': '--ink', '--color-text-muted': '--muted', '--color-border': '--line', '--color-accent': '--accent', '--color-accent-soft': '--accent-soft' };
  for (const [token, legacy] of Object.entries(map)) {
    assert.equal(normalize(light[token]), normalize(legacyLight[legacy]), `light ${token} vs ${legacy}`);
    assert.equal(normalize(dark[token]), normalize(legacyDark[legacy]), `dark ${token} vs ${legacy}`);
  }
});

test('every token used by the token-based sheets is defined', () => {
  for (const sheet of ['accessibility.css', 'mobile-inbox.css', 'optimistic.css', 'combobox.css', 'settings-nav.css']) {
    const used = [...read(sheet).matchAll(/var\((--[\w-]+)\)/g)].map(m => m[1]);
    assert.ok(used.length > 0, `${sheet} should use tokens`);
    for (const name of used) assert.ok(name in light, `${name} (used by ${sheet}) is not defined in tokens.css`);
  }
});
