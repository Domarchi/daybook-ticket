import { expect, test, type Page } from '@playwright/test';
import { expectNoSeriousViolations } from '../support/axe';

const SUBJECT = 'No puedo imprimir la factura de octubre';

async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'La página no debe desplazarse hacia los lados').toBeLessThanOrEqual(1);
}

test.describe('the desk on a 375 px phone', () => {
  test('the inbox is a list of cards that fits the screen', async ({ page }) => {
    await page.goto('/');
    const cards = page.getByRole('list', { name: 'Tickets' });
    await expect(cards.getByRole('link', { name: SUBJECT })).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
    await expectNoSidewaysScroll(page);
    await expectNoSeriousViolations(page, 'Bandeja en móvil');
  });

  test('the menu opens as a dialog, closes with Escape and gives focus back', async ({ page }) => {
    await page.goto('/');
    const open = page.getByRole('button', { name: 'Abrir menú' });
    await open.click();
    const menu = page.getByRole('dialog', { name: 'Menú de navegación' });
    await expect(menu).toBeVisible();
    await expectNoSeriousViolations(page, 'Menú móvil abierto');
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(open).toBeFocused();
  });

  test('a ticket opens, fits the screen and keeps the reply box within reach', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('list', { name: 'Tickets' }).getByRole('link', { name: SUBJECT }).click();
    await expect(page.getByRole('heading', { name: SUBJECT, level: 1 })).toBeVisible();
    await expect(page.getByPlaceholder('Escribe una respuesta clara y cercana…')).toBeVisible();
    await expectNoSidewaysScroll(page);
    await expectNoSeriousViolations(page, 'Ticket en móvil');
  });
});
