import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/**
 * Accessibility gate: no critical violation may reach a screen. Serious ones do not fail the run yet; they are
 * attached to the test as annotations so the report names what to fix next, and the gate can be tightened later.
 */
export async function expectNoCriticalViolations(page: Page, screen: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const describe = (impact: string) =>
    violations
      .filter(violation => violation.impact === impact)
      .map(violation => `${violation.id} (${violation.nodes.length})`);
  const serious = describe('serious');
  if (serious.length)
    test.info().annotations.push({ type: `axe serious · ${screen}`, description: serious.join(', ') });
  expect(describe('critical'), `Violaciones críticas de accesibilidad en «${screen}»`).toEqual([]);
}
