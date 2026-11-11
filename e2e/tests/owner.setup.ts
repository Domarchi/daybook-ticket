import { expect, test as setup } from '@playwright/test';
import { OWNER_EMAIL, OWNER_SESSION } from '../support/env';
import { readRunState } from '../support/state';

/** Activates the owner account through the real invitation link, then keeps the session for the other projects. */
setup('the owner activates the workspace from the invitation link', async ({ page }) => {
  const { invitationUrl, password } = readRunState();
  await page.goto(invitationUrl);
  await expect(page.getByRole('heading', { name: 'Tu espacio está listo.' })).toBeVisible();
  await expect(page.getByLabel('Correo electrónico')).toHaveValue(OWNER_EMAIL);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByLabel('Repite tu contraseña').fill(password);
  await page.getByRole('button', { name: 'Activar mi cuenta' }).click();
  await page.waitForURL(url => url.pathname === '/', { timeout: 30_000 });
  await expect(page.getByRole('navigation', { name: 'Navegación principal' })).toBeVisible();
  await page.context().storageState({ path: OWNER_SESSION });
});
