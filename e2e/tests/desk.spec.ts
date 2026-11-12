import { expect, test, type Page } from '@playwright/test';
import { expectNoSeriousViolations } from '../support/axe';
import { readRunState } from '../support/state';

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

  test('a new client is invited with their company and equipment, and the same equipment is not given twice', async ({
    page,
  }) => {
    // Inviting people is a sensitive action: the owner confirms the password first (it lasts five minutes).
    await page.goto('/security');
    await page.getByLabel('Contraseña actual').fill(readRunState().password);
    await page.getByRole('button', { name: 'Verificar contraseña' }).click();
    await expect(page.getByText('Contraseña verificada para esta sesión.')).toBeVisible();

    await page.goto('/?view=team');
    await expect(page.getByRole('heading', { name: 'Equipo y clientes', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'Nueva empresa' }).click();
    await page.getByLabel('Nombre de la empresa').fill('Constructora Andes');
    await page.getByRole('button', { name: 'Guardar empresa' }).click();
    await expect(page.locator('.company-list strong', { hasText: 'Constructora Andes' })).toBeVisible();

    const invite = async (name: string, email: string) => {
      await page.getByRole('button', { name: 'Invitar persona' }).click();
      const form = page.locator('.access-invite form');
      await form.getByLabel('Nombre', { exact: true }).fill(name);
      await form.getByLabel('Correo de acceso').fill(email);
      await expect(form.getByRole('group', { name: 'Empresa y equipo del cliente' })).toBeVisible();
      await form.getByRole('combobox', { name: /^Empresa/ }).selectOption({ label: 'Constructora Andes' });
      await form.getByLabel('ID del equipo').fill('  nb-0042 ');
      await form.getByLabel('Tipo de equipo').selectOption({ label: 'Computador' });
      return form;
    };

    const form = await invite('Rosa Pérez', 'rosa@example.test');
    await expectNoSeriousViolations(page, 'Invitar cliente con equipo');
    await form.getByRole('button', { name: 'Crear invitación' }).click();
    await expect(page.getByRole('heading', { name: 'Invitación para rosa@example.test' })).toBeVisible();

    // Staff invitations do not ask for equipment.
    await page.getByRole('button', { name: 'Invitar persona' }).click();
    await page.locator('.access-invite form').getByLabel('Rol').selectOption({ label: 'Agente' });
    await expect(page.getByRole('group', { name: 'Empresa y equipo del cliente' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Cerrar formulario' }).click();

    // The same inventory ID, typed differently, is already Rosa's: refused, and nobody is invited.
    const second = await invite('Tomás Soto', 'tomas@example.test');
    await second.getByRole('button', { name: 'Crear invitación' }).click();
    await expect(page.getByText('El equipo NB-0042 ya está asignado a Rosa Pérez.')).toBeVisible();
    await expect(page.getByText('tomas@example.test')).toHaveCount(0);
  });

  test('the Equipos view lists equipment, registers more, and assigns and frees it', async ({ page }) => {
    await page.goto('/?view=equipment');
    await expect(page.getByRole('heading', { name: 'Equipos', level: 1 })).toBeVisible();
    const rows = page.locator('.equipment-row');
    // Rosa's equipment from the invitation, already assigned to her.
    const rosa = rows.filter({ hasText: 'NB-0042' });
    await expect(rosa).toBeVisible();
    await expect(rosa.getByRole('combobox', { name: 'Asignado a NB-0042' })).toHaveValue(/.+/);
    await expect(rosa.getByRole('combobox', { name: 'Asignado a NB-0042' }).locator('option:checked')).toHaveText(
      'Rosa Pérez',
    );
    await expect(page.getByText('Todos los clientes con acceso tienen al menos un equipo registrado.')).toBeVisible();
    await expectNoSeriousViolations(page, 'Equipos');

    // Register a monitor without an owner yet.
    await page.getByRole('button', { name: 'Registrar equipo' }).click();
    const form = page.locator('.equipment-form');
    await form.getByRole('combobox', { name: /^Empresa/ }).selectOption({ label: 'Constructora Andes' });
    await form.getByLabel('ID del equipo').fill('mon-7');
    await form.getByLabel('Tipo de equipo').selectOption({ label: 'Monitor' });
    await form.getByRole('button', { name: 'Registrar equipo' }).click();
    await expect(page.getByText('Equipo MON-7 registrado')).toBeVisible();
    const monitor = rows.filter({ hasText: 'MON-7' });
    await expect(monitor).toContainText('Monitor');

    // Only the free one under "Sin asignar".
    await page.getByRole('button', { name: 'Sin asignar', exact: true }).click();
    await expect(monitor).toBeVisible();
    await expect(rosa).toHaveCount(0);

    // Give it to Rosa: it leaves the free list.
    await monitor.getByRole('combobox', { name: 'Asignado a MON-7' }).selectOption({ label: 'Rosa Pérez' });
    await monitor.getByRole('button', { name: 'Guardar asignación de MON-7' }).click();
    await expect(page.getByText('Equipo asignado')).toBeVisible();
    await expect(page.getByText('Ningún equipo coincide con la búsqueda.')).toBeVisible();

    // Free it again from the full list, then find Rosa's notebook by its ID typed in lower case.
    await page.getByRole('button', { name: 'Todos', exact: true }).click();
    await monitor.getByRole('combobox', { name: 'Asignado a MON-7' }).selectOption({ label: 'Sin asignar' });
    await monitor.getByRole('button', { name: 'Guardar asignación de MON-7' }).click();
    await expect(page.getByText('Equipo liberado')).toBeVisible();
    await page.getByRole('searchbox', { name: 'Buscar equipo' }).fill('nb-0042');
    await expect(rosa).toBeVisible();
    await expect(monitor).toHaveCount(0);
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

    test('the invite form and the access list are readable in dark mode', async ({ page }) => {
      await page.goto('/?view=team');
      await expect(page.getByRole('heading', { name: 'Equipo y clientes', level: 1 })).toBeVisible();
      await page.getByRole('button', { name: 'Invitar persona' }).click();
      const form = page.locator('.access-invite form');
      await expect(form.getByRole('group', { name: 'Empresa y equipo del cliente' })).toBeVisible();
      await form.getByLabel('ID del equipo').fill('NB-0099');
      // The fields follow the dark theme instead of staying white with light text.
      await expect(form.getByLabel('ID del equipo')).toHaveCSS('background-color', 'rgb(16, 16, 16)');
      await expectNoSeriousViolations(page, 'Invitar cliente en modo oscuro');
      await page.getByRole('button', { name: 'Cerrar formulario' }).click();
    });

    test('the other desk views pass the accessibility gate in dark mode', async ({ page }) => {
      for (const [view, screen] of [
        ['overview', 'Resumen'],
        ['contacts', 'Contactos'],
        ['equipment', 'Equipos'],
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
