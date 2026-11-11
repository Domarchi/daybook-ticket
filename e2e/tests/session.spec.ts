import { expect, test } from '@playwright/test';
import { OWNER_EMAIL } from '../support/env';
import { readRunState } from '../support/state';

/** Runs last: signing out revokes the session on the server, so it must not share the session of the other projects. */
test('signing in with the password works and signing out ends the session', async ({ page }) => {
  const { password } = readRunState();
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(OWNER_EMAIL);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Entrar a mi espacio' }).click();
  await expect(page.getByRole('heading', { name: 'Bandeja de entrada' })).toBeVisible();

  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
});
