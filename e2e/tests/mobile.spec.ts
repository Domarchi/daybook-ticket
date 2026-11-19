import { expect, test, type Locator, type Page } from '@playwright/test';
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
    // The shared drawer (@daybook/design riel.css): open, over a scrim, focus on the first row.
    await expect(page.locator('#daybook-navigation')).toHaveAttribute('data-open', 'true');
    await expect(page.locator('.db-rail-scrim')).toHaveAttribute('data-open', 'true');
    await expect(menu.getByRole('button', { name: 'Resumen' })).toBeFocused();
    await expectNoSeriousViolations(page, 'Menú móvil abierto');
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(open).toBeFocused();
  });

  test('the ✕ and the scrim close the menu too; it slides out instead of vanishing', async ({ page }) => {
    await page.goto('/');
    const open = page.getByRole('button', { name: 'Abrir menú' });
    const rail = page.locator('#daybook-navigation');
    await open.click();
    const close = page.getByRole('dialog', { name: 'Menú de navegación' }).getByRole('button', { name: 'Cerrar menú' });
    const box = (await close.boundingBox())!;
    expect(box.width).toBe(44);
    expect(box.height).toBe(44);
    await close.click();
    await expect(rail).toHaveAttribute('data-open', 'false');
    // It stays visible while it slides out: visibility waits for the exit (200 ms) instead of switching at once.
    expect(await rail.evaluate(element => getComputedStyle(element).transitionDelay)).toMatch(/0\.2s/);
    await expect(rail).toBeHidden();
    await expect(open).toBeFocused();
    await expect(page.locator('.db-rail-scrim')).toHaveCSS('pointer-events', 'none');

    await open.click();
    await expect(rail).toHaveAttribute('data-open', 'true');
    // The scrim is to the right of the 232 px drawer.
    await page.mouse.click(340, 400);
    await expect(rail).toHaveAttribute('data-open', 'false');
    await expect(open).toBeFocused();
  });

  test('a ticket opens, fits the screen and keeps the reply box within reach', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('list', { name: 'Tickets' }).getByRole('link', { name: SUBJECT }).click();
    await expect(page.getByRole('heading', { name: SUBJECT, level: 1 })).toBeVisible();
    await expect(page.getByPlaceholder('Escribe la respuesta al cliente…')).toBeVisible();
    await expectNoSidewaysScroll(page);
    await expectNoSeriousViolations(page, 'Ticket en móvil');
  });
});

/** Every control of the reply box reaches 44 px for a finger, even inside the denser chat styles. */
async function expectFingerSized(control: Locator, name: string) {
  await expect(control, name).toBeVisible();
  const box = await control.boundingBox();
  expect(box, name).not.toBeNull();
  expect(box!.height, `${name}: alto con el dedo`).toBeGreaterThanOrEqual(44);
}

test.describe('the reply box on a 390 px phone, used with a finger', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('every control of the reply box is at least 44 px and «Respuesta / Nota interna» splits the width', async ({
    page,
  }) => {
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    await page.goto('/');
    await page.getByRole('list', { name: 'Tickets' }).getByRole('link', { name: SUBJECT }).click();
    const composer = page.locator('form.ticket-chat-composer');
    await expect(composer.getByPlaceholder('Escribe la respuesta al cliente…')).toBeVisible();

    const reply = composer.getByRole('button', { name: 'Respuesta', exact: true });
    const note = composer.getByRole('button', { name: 'Nota interna', exact: true });
    await expectFingerSized(reply, 'Respuesta');
    await expectFingerSized(note, 'Nota interna');
    const tabs = (await composer.locator('.composer-tabs').boundingBox())!;
    const [left, right] = [(await reply.boundingBox())!, (await note.boundingBox())!];
    expect(Math.abs(left.width - right.width), 'las dos mitades miden lo mismo').toBeLessThanOrEqual(2);
    expect(left.width + right.width, 'entre las dos ocupan el ancho').toBeGreaterThan(tabs.width * 0.85);

    const toolbar = composer.getByRole('toolbar');
    await toolbar.getByRole('button', { name: 'Formato' }).click();
    const formatting = toolbar.getByRole('button');
    const count = await formatting.count();
    expect(count).toBeGreaterThan(3);
    for (let index = 0; index < count; index++) {
      const button = formatting.nth(index);
      await expectFingerSized(button, (await button.getAttribute('aria-label')) || (await button.innerText()));
    }
    await expectFingerSized(composer.locator('label.attachment-picker'), 'Adjuntar archivos');
    await expectFingerSized(composer.getByRole('button', { name: 'Enviar respuesta' }), 'Enviar respuesta');
    await expectNoSidewaysScroll(page);
  });

  test('signing out lives in Configuración: it asks first, and «Seguir trabajando» keeps the session', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Abrir menú' }).click();
    const menu = page.getByRole('dialog', { name: 'Menú de navegación' });
    // As in Parte Diario, the menu has no «Cerrar sesión»: the account row is the person and the theme.
    await expect(menu.getByRole('button', { name: 'Cerrar sesión' })).toHaveCount(0);
    await expectFingerSized(menu.getByRole('button', { name: /^Tema: / }), 'Tema');
    if (process.env.DAYBOOK_E2E_CAPTURES)
      await page.screenshot({ path: `${process.env.DAYBOOK_E2E_CAPTURES}/menu-telefono-390x844.png` });
    await menu.getByRole('button', { name: 'Configuración', exact: true }).click();
    await expect(menu).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Configuración', level: 1 })).toBeVisible();
    const signOut = page
      .getByRole('region', { name: 'Salir de este dispositivo' })
      .getByRole('button', { name: 'Cerrar sesión' });
    await expectFingerSized(signOut, 'Cerrar sesión');
    await expectNoSidewaysScroll(page);
    await signOut.click();
    const dialog = page.getByRole('dialog', { name: 'Cerrar sesión' });
    await expect(dialog).toContainText('Vas a salir de Daybook Ticket en este dispositivo');
    const stay = dialog.getByRole('button', { name: 'Seguir trabajando' });
    await expect(stay).toBeFocused();
    await expectNoSeriousViolations(page, 'Confirmar cierre de sesión en móvil');
    await stay.click();
    await expect(dialog).toBeHidden();
    // The button that led there takes the focus back.
    await expect(signOut).toBeFocused();
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: 'Configuración', level: 1 })).toBeVisible();
  });
});
