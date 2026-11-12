import { expect, test } from '@playwright/test';
import { expectNoSeriousViolations } from '../support/axe';

test.describe('without a session', () => {
  test('the sign-in page is usable and accessible', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Inicia sesión' })).toBeVisible();
    await expect(page.getByLabel('Correo electrónico')).toBeEditable();
    await expect(page.getByRole('button', { name: 'Entrar a mi espacio' })).toBeEnabled();
    await expectNoSeriousViolations(page, 'Inicio de sesión');
  });

  test('the sign-in page is readable in dark mode', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Inicia sesión' })).toBeVisible();
    await expectNoSeriousViolations(page, 'Inicio de sesión en modo oscuro');
  });

  test('a wrong password is refused without saying which part was wrong', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Correo electrónico').fill('nadie@example.test');
    await page.getByLabel('Contraseña').fill('una-contrasena-incorrecta');
    await page.getByRole('button', { name: 'Entrar a mi espacio' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Revisa tu correo y contraseña' })).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('an unknown invitation link is explained instead of failing silently', async ({ page }) => {
    await page.goto(`/login?invite=${'0'.repeat(64)}`);
    await expect(page.getByRole('alert').filter({ hasText: 'La invitación venció o ya fue utilizada' })).toBeVisible();
  });

  test('the desk sends visitors to sign in and keeps its data private', async ({ page, request }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
    const feed = await request.get('/api/tickets/updates');
    expect(feed.status()).toBe(401);
    const security = await request.get('/api/security/health');
    expect([401, 403]).toContain(security.status());
  });

  test('the public health probe answers without exposing data', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(['status', 'version']);
  });
});
