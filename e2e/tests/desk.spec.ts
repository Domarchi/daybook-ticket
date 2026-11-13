import { expect, test, type Page } from '@playwright/test';
import { expectNoSeriousViolations } from '../support/axe';

const SUBJECT = 'No puedo imprimir la factura de octubre';
const REQUESTER = 'Andrea Molina';

async function createTicket(page: Page) {
  await page.getByRole('button', { name: 'Nuevo ticket' }).click();
  await page.getByLabel('Nombre del solicitante').fill(REQUESTER);
  await page.getByLabel('Correo electrónico').fill('andrea@example.test');
  await page.getByLabel('Asunto').fill(SUBJECT);
  await page
    .getByLabel('Descripción')
    .fill('La impresora muestra un error al enviar el documento desde el escritorio.');
  await page.getByRole('button', { name: 'Crear ticket' }).click();
}

test.describe.configure({ mode: 'serial' });

test.describe('the support desk', () => {
  test('an empty inbox is accessible and invites the first ticket', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Bandeja de entrada' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Nuevo ticket' })).toBeEnabled();
    await expectNoSeriousViolations(page, 'Bandeja vacía');
  });

  test('a ticket is created and shows in the inbox', async ({ page }) => {
    await page.goto('/');
    await createTicket(page);
    await expect(page.getByText(SUBJECT).first()).toBeVisible();
    await expectNoSeriousViolations(page, 'Bandeja con un ticket');
  });

  test('opening a ticket puts it in the address; Back, reload and shared links all land on it', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: SUBJECT }).click();
    await expect(page.getByRole('heading', { name: SUBJECT, level: 1 })).toBeVisible();
    await expect(page).toHaveURL(/\/\?ticket=\d+$/);
    const ticketUrl = page.url();

    await page.reload();
    await expect(page.getByRole('heading', { name: SUBJECT, level: 1 })).toBeVisible();

    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Bandeja de entrada' })).toBeVisible();
    await page.goForward();
    await expect(page.getByRole('heading', { name: SUBJECT, level: 1 })).toBeVisible();

    await page.goto('/');
    await page.goto(ticketUrl);
    await expect(page.getByRole('heading', { name: SUBJECT, level: 1 })).toBeVisible();
    await expectNoSeriousViolations(page, 'Ticket abierto');
  });

  test('a reply and an internal note are saved and shown in the conversation', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: SUBJECT }).click();
    const composer = page.getByPlaceholder('Escribe una respuesta clara y cercana…');
    await composer.fill('Hola Andrea, ya revisamos tu impresora y te enviamos los pasos.');
    await page.getByRole('button', { name: 'Enviar respuesta' }).click();
    // The composer empties only once the send has fully finished; reloading before that would restore the draft.
    await expect(composer).toHaveValue('');
    const conversation = page.getByRole('region', { name: 'Conversación del ticket' });
    await expect(conversation.getByText('ya revisamos tu impresora')).toBeVisible();

    await page.getByRole('button', { name: 'Nota interna' }).click();
    const noteBox = page.getByPlaceholder('Añade contexto para el seguimiento del caso…');
    await noteBox.fill('Revisar el controlador antes de visitar.');
    await page.getByRole('button', { name: 'Guardar nota' }).click();
    await expect(noteBox).toHaveValue('');
    await expect(conversation.getByText('Revisar el controlador antes de visitar.')).toBeVisible();

    await page.reload();
    await expect(conversation.getByText('ya revisamos tu impresora')).toBeVisible();
    await expect(conversation.getByText('Revisar el controlador antes de visitar.')).toBeVisible();
  });

  test('a priority change shows at once, can be undone, and the server agrees', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: SUBJECT }).click();
    const priority = page.getByRole('combobox', { name: 'Prioridad', exact: true });
    await expect(priority).toHaveValue('normal');
    await priority.selectOption({ label: 'Alta' });
    await expect(page.getByRole('status').filter({ hasText: 'Prioridad actualizada' })).toBeVisible();
    await expect(priority).toHaveValue('high');
    await page.getByRole('button', { name: 'Deshacer' }).click();
    await expect(priority).toHaveValue('normal');
    await page.reload();
    await expect(page.getByRole('combobox', { name: 'Prioridad', exact: true })).toHaveValue('normal');
  });

  test('on a tablet the inbox shows cards and never pushes the page sideways', async ({ page }) => {
    // The ticket table needs about 800 px; next to the rail it only fits from 1024 px up.
    for (const width of [768, 900, 1023]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      await expect(page.getByText(SUBJECT).first()).toBeVisible();
      await expect(page.locator('.ticket-table')).toHaveCount(0);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${width}px: horizontal overflow`).toBe(0);
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');
    await expect(page.locator('.ticket-table')).toBeVisible();
  });

  test('search finds the ticket by its subject', async ({ page }) => {
    await page.goto('/');
    await page.getByPlaceholder('Buscar en tickets y conversaciones…').fill('factura de octubre');
    await expect(page.getByRole('link', { name: SUBJECT })).toBeVisible();
    await page.getByPlaceholder('Buscar en tickets y conversaciones…').fill('texto-que-no-existe-xyz');
    await expect(page.getByRole('link', { name: SUBJECT })).toHaveCount(0);
  });

  test('the classifier suggests a category, a person corrects it, and the inbox filters by it', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: SUBJECT }).click();
    const panel = page.getByRole('group', { name: 'Clasificación' });
    const fault = panel.getByRole('combobox', { name: 'Elemento fallado' });
    const requirement = panel.getByRole('combobox', { name: 'Requerimiento' });
    // "No puedo imprimir…" / "La impresora muestra un error…" → a printer failure, suggested at creation.
    await expect(fault).toHaveValue('equipment:printer');
    await expect(requirement).toHaveValue('');
    await expect(panel).toContainText('Sugerida automáticamente');

    await requirement.selectOption({ label: 'Aplicaciones' });
    await expect(panel).toContainText('Revisada por el equipo');
    await page.reload();
    await expect(page.getByRole('group', { name: 'Clasificación' })).toContainText('Revisada por el equipo');
    await expect(
      page.getByRole('group', { name: 'Clasificación' }).getByRole('combobox', { name: 'Requerimiento' }),
    ).toHaveValue('applications');
    await expect(
      page.getByRole('group', { name: 'Clasificación' }).getByRole('combobox', { name: 'Elemento fallado' }),
    ).toHaveValue('equipment:printer');

    await page.goto('/');
    await page.getByRole('button', { name: 'Filtros' }).click();
    const filter = page.getByLabel('Filtrar por categoría');
    await filter.selectOption({ label: 'Equipos y periféricos' });
    await expect(page.getByRole('link', { name: SUBJECT })).toBeVisible();
    await filter.selectOption({ label: 'Acceso y contraseñas' });
    await expect(page.getByRole('link', { name: SUBJECT })).toHaveCount(0);
    await filter.selectOption({ value: 'all' });
    await expect(page.getByRole('link', { name: SUBJECT })).toBeVisible();
  });

  test('the four states: unassigned, in progress, solved, closed and reopened', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: SUBJECT }).click();
    const badge = page.locator('.ticket-meta .status');
    await expect(badge).toHaveText('Sin asignar');

    // Closing before solving is refused by the server itself, not only absent from the screen.
    const id = new URL(page.url()).searchParams.get('ticket');
    const refused = await page.request.patch(`/api/tickets/${id}`, {
      data: { status: 'closed' },
      headers: { Origin: new URL(page.url()).origin },
    });
    expect(refused.status()).toBe(409);

    await page.getByRole('button', { name: 'Tomar ticket' }).click();
    await expect(badge).toHaveText('En proceso');
    await page.getByRole('button', { name: 'Marcar solucionado' }).click();
    await expect(badge).toHaveText('Solucionado');
    await page.getByRole('button', { name: 'Cerrar ticket' }).click();
    await expect(badge).toHaveText('Cerrado');
    await page.reload();
    await expect(page.locator('.ticket-meta .status')).toHaveText('Cerrado');

    await page.goto('/');
    await page.getByRole('button', { name: /^Cerrados/ }).click();
    await expect(page.getByRole('link', { name: SUBJECT })).toBeVisible();
    await page.getByRole('button', { name: /^En proceso/ }).click();
    await expect(page.getByRole('link', { name: SUBJECT })).toHaveCount(0);
    await page.getByRole('button', { name: /^Todos/ }).click();
    await page.getByRole('link', { name: SUBJECT }).click();
    await page.getByRole('button', { name: 'Reabrir ticket' }).click();
    await expect(page.locator('.ticket-meta .status')).toHaveText('En proceso');
  });

  test('settings opens by section and the section stays in the address', async ({ page }) => {
    await page.goto('/');
    const settings = page.getByRole('button', { name: 'Configuración', exact: true });
    await settings.click();
    await expect(page).toHaveURL(/view=settings/);
    await expect(settings).toHaveAttribute('class', /active/);
    await expectNoSeriousViolations(page, 'Configuración');
    await page.goto('/?view=settings&section=mail');
    await expect(page).toHaveURL(/section=mail/);
    await expect(settings).toHaveAttribute('class', /active/);
  });

  // Fase 5b: lo que no tiene vuelta atrás se confirma en un diálogo con el botón
  // rojo que nombra la acción y el foco en «Cancelar». («Revocar acceso» con
  // «Deshacer» no se cubre acá: gestionar personas pide verificar la contraseña
  // del propietario, y esta suite no toca esa verificación.)
  test('deleting a saved reply asks in a dialog with a red button that names the action', async ({ page }) => {
    await page.goto('/?view=knowledge');
    await page.getByRole('button', { name: 'Nueva respuesta' }).click();
    await page.getByLabel('Título').fill('Reinicio de impresora');
    await page.getByLabel('Categoría').fill('Soporte');
    await page.getByLabel('Respuesta', { exact: true }).fill('Apaga la impresora 30 segundos y vuelve a intentar.');
    await page.getByRole('button', { name: 'Guardar respuesta' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Respuesta guardada' })).toBeVisible();

    await page.getByRole('button', { name: 'Eliminar respuesta Reinicio de impresora' }).click();
    const dialog = page.getByRole('dialog', { name: 'Eliminar respuesta guardada' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Cancelar' })).toBeFocused();
    const danger = dialog.getByRole('button', { name: 'Eliminar respuesta' });
    await expect(danger).toHaveCSS('background-color', 'rgb(179, 38, 30)');
    await expect(danger).toHaveCSS('color', 'rgb(255, 255, 255)');
    await expectNoSeriousViolations(page, 'Confirmar eliminación');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('Reinicio de impresora')).toBeVisible();

    await page.getByRole('button', { name: 'Eliminar respuesta Reinicio de impresora' }).click();
    await page
      .getByRole('dialog', { name: 'Eliminar respuesta guardada' })
      .getByRole('button', { name: 'Eliminar respuesta' })
      .click();
    await expect(page.getByRole('status').filter({ hasText: 'Respuesta eliminada' })).toBeVisible();
    await expect(page.getByText('Reinicio de impresora')).toHaveCount(0);
  });

  test.describe('dark mode', () => {
    test.use({ colorScheme: 'dark' });
    test('the inbox and an open ticket pass the accessibility gate in dark mode', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Bandeja de entrada' })).toBeVisible();
      await expectNoSeriousViolations(page, 'Bandeja en modo oscuro');
      await page.getByRole('link', { name: SUBJECT }).click();
      await expect(page.getByRole('heading', { name: SUBJECT, level: 1 })).toBeVisible();
      await expectNoSeriousViolations(page, 'Ticket en modo oscuro');
    });

    test('the other desk views pass the accessibility gate in dark mode', async ({ page }) => {
      for (const [view, screen] of [
        ['overview', 'Resumen'],
        ['contacts', 'Contactos'],
        ['knowledge', 'Conocimiento'],
        ['team', 'Equipo'],
        ['settings', 'Configuración'],
      ]) {
        await page.goto(`/?view=${view}`);
        await expect(page.locator('main h1').first()).toBeVisible();
        await expect(page.locator('.loading')).toHaveCount(0);
        await expectNoSeriousViolations(page, `${screen} en modo oscuro`);
      }
    });
  });
});
