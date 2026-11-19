import { expect, test } from '@playwright/test';
import { OWNER_EMAIL } from '../support/env';
import { readRunState } from '../support/state';

/** Runs last: signing out revokes the session on the server, so it must not share the session of the other projects. */
test('signing in with the password works and signing out, once confirmed, ends the session', async ({ page }) => {
  const { password } = readRunState();
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(OWNER_EMAIL);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Entrar a mi espacio' }).click();
  await expect(page.getByRole('heading', { name: 'Bandeja de entrada' })).toBeVisible();

  // «Cerrar sesión» is in Configuración, as in Parte Diario. It asks first, with the same words; Escape keeps you in.
  await page.locator('#daybook-navigation').getByRole('button', { name: 'Configuración', exact: true }).click();
  const rail = page
    .getByRole('region', { name: 'Salir de este dispositivo' })
    .getByRole('button', { name: 'Cerrar sesión' });
  await rail.click();
  const dialog = page.getByRole('dialog', { name: 'Cerrar sesión' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(rail).toBeFocused();
  await expect(page).not.toHaveURL(/\/login/);

  await rail.click();
  await dialog.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
});
