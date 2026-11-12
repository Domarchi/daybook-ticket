import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const BLOCKING = new Set(['critical', 'serious']);

/**
 * Accessibility gate: no critical or serious violation may reach a screen. Each failure names the rule, the
 * element and, for contrast, the colours found, so the report says what to fix without rerunning anything.
 */
export async function expectNoSeriousViolations(page: Page, screen: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const failures = violations
    .filter(violation => BLOCKING.has(violation.impact ?? ''))
    .flatMap(violation =>
      violation.nodes.map(node => {
        const data = node.any[0]?.data as { fgColor?: string; bgColor?: string; contrastRatio?: number } | undefined;
        const colours = data?.contrastRatio ? ` (${data.fgColor} sobre ${data.bgColor}, ${data.contrastRatio}:1)` : '';
        return `${violation.impact} ${violation.id} · ${node.target.join(' ')}${colours}`;
      }),
    );
  expect(failures, `Violaciones de accesibilidad en «${screen}»`).toEqual([]);
}
