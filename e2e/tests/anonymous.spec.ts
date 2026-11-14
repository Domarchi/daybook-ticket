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

  test('the sign-in page wears the Daybook family logo, sized by @daybook/design', async ({ page }) => {
    await page.goto('/login');
    const logo = page.locator('.auth-topbar').getByRole('img', { name: 'Daybook Ticket', exact: true });
    await expect(logo).toHaveClass(/\bdb-lockup\b/);
    await expect(logo.locator('.db-lockup__product')).toHaveText('Ticket');
    await expect(logo.locator('.db-mark')).toHaveCSS('width', '48px');
    await expect(logo.locator('.db-mark')).toHaveCSS('height', '48px');
    const mark = page.locator('.auth-icon').getByRole('img', { name: 'Daybook', exact: true });
    await expect(mark).toHaveCSS('width', '56px');
    await expect(page.locator('.auth-eyebrow')).toHaveText(/acceso seguro/i);
    // No full-logo picture: the symbol comes from CSS and DAYBOOK / TICKET are text.
    await expect(page.locator('.auth-shell img')).toHaveCount(0);
    // The symbol follows the theme.
    const lightMark = await logo.locator('.db-mark').evaluate(el => getComputedStyle(el).backgroundImage);
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const darkMark = await page.locator('.auth-topbar .db-mark').evaluate(el => getComputedStyle(el).backgroundImage);
    expect(darkMark).not.toBe(lightMark);
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
