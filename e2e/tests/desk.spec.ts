import { expect, test, type Page } from '@playwright/test';
import { expectNoSeriousViolations } from '../support/axe';
import { readRunState } from '../support/state';
import { todayIn } from '../../lib/fulfillment-model';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { DATABASE_URL } from '../support/env';

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
  // Rosa's invitation link, kept for the portal test further down (the tests in this file run in order).
  let rosaInvitation = '';
  let rosaPassword = '';
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

  test('old tickets without a category are reviewed and classified in one step', async ({ page }) => {
    // Two tickets as they were before the classifier existed: no category at all.
    const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 1 });
    const ids: number[] = [];
    try {
      const owner = (await pool.query<{ ownerId: string }>(`SELECT "ownerId" FROM organizations WHERE id='daybook'`))
        .rows[0].ownerId;
      const created = new Date(Date.now() - 40 * 86_400_000).toISOString();
      for (const [subject, body] of [
        ['Antiguo: no hay wifi en la sala', 'Desde ayer la red wifi del segundo piso no conecta.'],
        ['Antiguo: consulta', 'Necesito ayuda con algo.'],
      ]) {
        const ticket = await pool.query<{ id: number }>(
          `INSERT INTO tickets ("ownerId","creationKey",subject,"requesterName","requesterEmail",department,status,priority,"createdAt","updatedAt","dueAt")
           VALUES ($1,$4,$2,'Cliente Antiguo','antiguo@example.test','Soporte técnico','open','normal',$3,$3,$3) RETURNING id`,
          [owner, subject, created, randomUUID()],
        );
        ids.push(ticket.rows[0].id);
        await pool.query(
          `INSERT INTO messages ("ownerId","ticketId",author,"authorRole",body,kind,"createdAt") VALUES ($1,$2,'Cliente Antiguo','client',$3,'request',$4)`,
          [owner, ticket.rows[0].id, body, created],
        );
      }
    } finally {
      await pool.end();
    }
    const [wifi, vague] = ids;
    const row = (id: number) =>
      page.locator('.backfill-list li').filter({ hasText: `#${String(id).padStart(4, '0')}` });

    await page.goto('/');
    const notice = page.getByRole('region', { name: /tickets? sin clasificar/ });
    await expect(notice).toBeVisible();
    await notice.getByRole('button', { name: 'Revisar sugerencias' }).click();
    // A clear suggestion starts ticked; one with little to go on waits for a person.
    await expect(row(wifi)).toContainText('Conectividad · Red WiFi');
    await expect(row(wifi).getByRole('checkbox')).toBeChecked();
    await expect(row(vague)).toContainText('Sugerencia poco segura');
    await expect(row(vague).getByRole('checkbox')).not.toBeChecked();
    await expectNoSeriousViolations(page, 'old tickets classification review');

    await notice.getByRole('button', { name: 'Desmarcar todo' }).click();
    await row(wifi).getByRole('checkbox').check();
    await notice.getByRole('button', { name: 'Clasificar 1 ticket' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Se clasificó 1 ticket' })).toBeVisible();
    await expect(row(wifi)).toHaveCount(0);
    await expect(row(vague)).toHaveCount(1);

    // The ticket now carries the suggestion, marked as such, and a person can still correct it.
    await page.goto(`/?ticket=${wifi}`);
    const panel = page.getByRole('group', { name: 'Clasificación' });
    await expect(panel.getByRole('combobox', { name: 'Elemento fallado' })).toHaveValue('connectivity:wifi');
    await expect(panel).toContainText('Sugerida automáticamente');
    await page.goto(`/?ticket=${vague}`);
    await expect(
      page.getByRole('group', { name: 'Clasificación' }).getByRole('combobox', { name: 'Elemento fallado' }),
    ).toHaveValue('');
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
    rosaInvitation = await page.getByRole('textbox', { name: 'Enlace de invitación' }).inputValue();

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

  test('a client sees their equipment in the portal and names it in a ticket that the team then sees', async ({
    page,
    browser,
  }) => {
    expect(rosaInvitation).toMatch(/^http/);
    // Rosa, in her own browser, activates her account from the real invitation link.
    const rosaContext = await browser.newContext();
    const rosa = await rosaContext.newPage();
    try {
      await rosa.goto(rosaInvitation);
      const password = `Rosa-e2e-${crypto.randomUUID()}`;
      rosaPassword = password;
      await rosa.getByLabel('Contraseña', { exact: true }).fill(password);
      await rosa.getByLabel('Repite tu contraseña').fill(password);
      await rosa.getByRole('button', { name: 'Activar mi cuenta' }).click();
      await rosa.waitForURL(url => url.pathname === '/', { timeout: 30_000 });

      const mine = rosa.getByRole('region', { name: 'Mis equipos' });
      await expect(mine).toContainText('NB-0042');
      await expect(mine).not.toContainText('MON-7');
      await expectNoSeriousViolations(rosa, 'Portal con mis equipos');

      await rosa.getByRole('button', { name: 'Nuevo ticket' }).first().click();
      const form = rosa.locator('form.client-new-ticket');
      const equipment = form.getByRole('combobox', { name: /Sobre qué equipo/ });
      // Her only equipment is already chosen.
      await expect(equipment.locator('option:checked')).toHaveText('NB-0042 · Computador');
      await form.getByLabel('Asunto').fill('El notebook no enciende');
      await form
        .getByRole('textbox', { name: 'Descripción' })
        .fill('Desde esta mañana no prende, ni conectado al cargador.');
      await form.getByRole('button', { name: 'Crear ticket' }).click();
      const created = rosa.getByText(/Tu ticket #\d{4} fue creado/);
      await expect(created).toBeVisible();
      const ticket = Number(/#(\d{4})/.exec((await created.textContent()) ?? '')?.[1]);
      expect(ticket).toBeGreaterThan(0);

      // The team sees which equipment the ticket is about.
      await page.goto(`/?ticket=${ticket}`);
      await expect(page.getByRole('heading', { name: 'El notebook no enciende', level: 1 })).toBeVisible();
      await expect(page.locator('.ticket-equipment')).toContainText('NB-0042 · Computador');
    } finally {
      await rosaContext.close();
    }
  });

  test('the team creates a ticket for a client naming their equipment and asking for a requirement', async ({
    page,
  }) => {
    const subject = 'Cambio de batería del notebook';
    await page.goto('/');
    await page.getByRole('button', { name: 'Nuevo ticket' }).click();
    const form = page.locator('form.form');
    // Without a linked client there is no equipment to choose.
    await expect(form.getByRole('combobox', { name: /Sobre qué equipo/ })).toHaveCount(0);
    await form
      .getByRole('combobox', { name: 'Cuenta del cliente' })
      .selectOption({ label: 'Rosa Pérez · rosa@example.test' });
    const equipment = form.getByRole('combobox', { name: /Sobre qué equipo/ });
    // Rosa's only active equipment is chosen; the monitor freed earlier is not offered.
    await expect(equipment.locator('option:checked')).toHaveText('NB-0042 · Computador');
    await expect(equipment.locator('option')).not.toContainText(['MON-7 · Monitor']);
    await form.getByRole('combobox', { name: 'Tipo de solicitud' }).selectOption({ label: 'Un pedido: Equipos' });
    await form.getByLabel('Asunto').fill(subject);
    await form.getByLabel('Descripción').fill('La batería dura menos de una hora; necesita una nueva.');
    await expectNoSeriousViolations(page, 'Nuevo ticket con equipo y pedido');
    await form.getByRole('button', { name: 'Crear ticket' }).click();

    await expect(page.getByRole('heading', { name: subject, level: 1 })).toBeVisible();
    await expect(page.locator('.ticket-equipment')).toContainText('NB-0042 · Computador');
    // Asked as a requirement, it is followed from «Solicitado» without a further click.
    const panel = page.getByRole('region', { name: 'Seguimiento del requerimiento' });
    await expect(panel.locator('[aria-current="step"]')).toContainText('Solicitado');
    await expect(panel.getByRole('button', { name: 'Seguir como requerimiento' })).toHaveCount(0);
  });

  test('equipment shows its history and tickets, and is given up and reactivated', async ({ page }) => {
    await page.goto('/?view=equipment');
    await expect(page.getByRole('heading', { name: 'Equipos', level: 1 })).toBeVisible();
    const rows = page.locator('.equipment-row');
    const notebook = rows.filter({ hasText: 'NB-0042' });
    const monitor = rows.filter({ hasText: 'MON-7' });

    // Rosa's notebook: registered with her invitation and named by two tickets.
    await notebook.getByRole('button', { name: 'Ver historial de NB-0042' }).click();
    const notebookHistory = page.getByRole('region', { name: 'Historial de NB-0042' });
    await expect(notebookHistory).toContainText('Registrado y asignado a Rosa Pérez');
    await expect(notebookHistory.getByRole('link', { name: /El notebook no enciende/ })).toBeVisible();
    await expect(notebookHistory.getByRole('link', { name: /Cambio de batería del notebook/ })).toBeVisible();

    // The monitor went to Rosa and back; the history says so, newest first.
    await monitor.getByRole('button', { name: 'Ver historial de MON-7' }).click();
    const monitorHistory = page.getByRole('region', { name: 'Historial de MON-7' });
    await expect(monitorHistory.locator('ol li')).toHaveText([
      /Liberado \(estaba con Rosa Pérez\)/,
      /Asignado a Rosa Pérez/,
      /Registrado sin asignar/,
    ]);
    await expect(monitorHistory).toContainText('Ningún ticket lo menciona todavía.');

    await monitor.getByRole('button', { name: 'Dar de baja MON-7' }).click();
    await expect(monitor.getByRole('group', { name: 'Confirmar baja de MON-7' })).toBeVisible();
    await expectNoSeriousViolations(page, 'Equipos con historial y baja');
    await monitor.getByRole('button', { name: 'Confirmar baja de MON-7' }).click();
    await expect(page.getByText('Equipo MON-7 dado de baja')).toBeVisible();
    await expect(monitor).toHaveCount(0);

    // Given-up equipment has its own list, from where it comes back unassigned.
    await page.getByRole('button', { name: 'Dados de baja', exact: true }).click();
    await expect(monitor).toContainText('Dado de baja');
    await expect(notebook).toHaveCount(0);
    await monitor.getByRole('button', { name: 'Ver historial de MON-7' }).click();
    await expect(page.getByRole('region', { name: 'Historial de MON-7' }).locator('ol li').first()).toContainText(
      'Dado de baja',
    );
    await monitor.getByRole('button', { name: 'Reactivar MON-7' }).click();
    await expect(page.getByText('Equipo MON-7 reactivado')).toBeVisible();
    await expect(page.getByText('No hay equipos dados de baja.')).toBeVisible();
    await page.getByRole('button', { name: 'Sin asignar', exact: true }).click();
    await expect(monitor).toBeVisible();
  });

  test('a requirement is followed stage by stage, with a committed date and a reported delay', async ({ page }) => {
    const day = (offset: number) => {
      const [year, month, date] = todayIn('America/Santiago', new Date()).split('-').map(Number);
      return new Date(Date.UTC(year, month - 1, date + offset)).toISOString().slice(0, 10);
    };
    const subject = 'Necesito un monitor adicional';
    await page.goto('/');
    await page.getByRole('button', { name: 'Nuevo ticket' }).click();
    await page.getByLabel('Nombre del solicitante').fill('Rosa Pérez');
    await page.getByLabel('Correo electrónico').fill('rosa@example.test');
    await page.getByLabel('Asunto').fill(subject);
    await page.getByLabel('Descripción').fill('Solicito un monitor adicional para mi puesto de trabajo.');
    await page.getByRole('button', { name: 'Crear ticket' }).click();
    // The desk opens the new ticket right away.
    await expect(page.getByRole('heading', { name: subject, level: 1 })).toBeVisible();

    const panel = page.getByRole('region', { name: 'Seguimiento del requerimiento' });
    await panel.getByRole('button', { name: 'Seguir como requerimiento' }).click();
    await expect(panel.getByRole('list', { name: 'Avance del requerimiento' })).toBeVisible();
    await expect(panel.locator('[aria-current="step"]')).toContainText('Solicitado');

    await panel.getByLabel('Fecha comprometida').fill(day(5));
    await panel.getByRole('button', { name: 'Guardar fecha' }).click();
    await expect(page.getByText('Fecha comprometida guardada')).toBeVisible();

    await panel.getByRole('combobox', { name: 'Mover a' }).selectOption({ label: 'En gestión' });
    await panel.getByRole('button', { name: 'Cambiar etapa' }).click();
    await expect(panel.locator('[aria-current="step"]')).toContainText('En gestión');

    await panel.getByRole('button', { name: 'Informar retraso' }).click();
    await panel.getByRole('combobox', { name: 'Motivo del retraso' }).selectOption({ label: 'Proveedor' });
    await panel.getByLabel('Nueva fecha comprometida').fill(day(10));
    await panel.getByLabel(/Nota para el cliente/).fill('El proveedor despacha el lunes');
    await panel.getByRole('button', { name: 'Informar retraso' }).click();
    await expect(panel).toContainText('Proveedor · El proveedor despacha el lunes');

    await panel.getByRole('combobox', { name: 'Mover a' }).selectOption({ label: 'Listo para entregar' });
    await panel.getByRole('button', { name: 'Cambiar etapa' }).click();
    await expect(panel.locator('[aria-current="step"]')).toContainText('Listo para entregar');
    // Going back needs a reason; "Entregado" is not offered here (it records the equipment, F6-B4).
    await expect(panel.getByRole('combobox', { name: 'Mover a' }).locator('option')).not.toContainText(['Entregado']);
    await panel.getByRole('combobox', { name: 'Mover a' }).selectOption({ label: 'En gestión' });
    await panel.getByLabel('Motivo').fill('El monitor llegó con un píxel muerto');
    await panel.getByRole('button', { name: 'Cambiar etapa' }).click();
    await expect(panel.locator('[aria-current="step"]')).toContainText('En gestión');

    await panel.getByText(/Historial del seguimiento/).click();
    await expect(panel.getByRole('listitem').filter({ hasText: 'Retraso: Proveedor' })).toBeVisible();
    await expect(
      panel.getByRole('listitem').filter({ hasText: 'En gestión · El monitor llegó con un píxel muerto' }),
    ).toBeVisible();
    await expectNoSeriousViolations(page, 'Ticket con seguimiento de requerimiento');

    await page.goto('/?view=requirements');
    await expect(page.getByRole('heading', { name: 'Requerimientos', level: 1 })).toBeVisible();
    const row = page.locator('.requirements-rows li').filter({ hasText: subject });
    await expect(row).toContainText('En gestión');
    await expect(row).toContainText('Retraso: Proveedor');
    await expectNoSeriousViolations(page, 'Requerimientos');
  });

  test('a client asks for a requirement in the portal and follows it, delay included', async ({ page, browser }) => {
    expect(rosaPassword).not.toBe('');
    const subject = 'Necesito acceso al sistema de remuneraciones';
    const rosaContext = await browser.newContext();
    const rosa = await rosaContext.newPage();
    try {
      await rosa.goto(new URL('/login', rosaInvitation).toString());
      await rosa.getByLabel('Correo electrónico').fill('rosa@example.test');
      await rosa.getByLabel('Contraseña').fill(rosaPassword);
      await rosa.getByRole('button', { name: 'Entrar a mi espacio' }).click();
      await rosa.waitForURL(url => url.pathname === '/', { timeout: 30_000 });

      await rosa.getByRole('button', { name: 'Nuevo ticket' }).first().click();
      const form = rosa.locator('form.client-new-ticket');
      await form
        .getByRole('combobox', { name: 'Tipo de solicitud' })
        .selectOption({ label: 'Un pedido: Cuentas de usuarios' });
      await form.getByRole('combobox', { name: /Sobre qué equipo/ }).selectOption({ label: 'No es sobre un equipo' });
      await form.getByLabel('Asunto').fill(subject);
      await form.getByRole('textbox', { name: 'Descripción' }).fill('Para revisar mis liquidaciones de sueldo.');
      await form.getByRole('button', { name: 'Crear ticket' }).click();
      const created = rosa.getByText(/Tu ticket #\d{4} fue creado/);
      await expect(created).toBeVisible();
      const ticket = Number(/#(\d{4})/.exec((await created.textContent()) ?? '')?.[1]);

      // The follow-up starts on its own: the tracking line is there from the first moment.
      const tracking = rosa.getByRole('region', { name: 'Seguimiento de tu requerimiento' });
      await expect(tracking.locator('[aria-current="step"]')).toContainText('Solicitado');
      await expect(tracking).toContainText('Te avisaremos cuando la tengamos');

      // The team moves it and reports a delay; Rosa sees why.
      await page.goto(`/?ticket=${ticket}`);
      const panel = page.getByRole('region', { name: 'Seguimiento del requerimiento' });
      await panel.getByRole('combobox', { name: 'Mover a' }).selectOption({ label: 'En gestión' });
      await panel.getByRole('button', { name: 'Cambiar etapa' }).click();
      await expect(panel.locator('[aria-current="step"]')).toContainText('En gestión');
      await panel.getByRole('button', { name: 'Informar retraso' }).click();
      await panel.getByRole('combobox', { name: 'Motivo del retraso' }).selectOption({ label: 'Aprobación pendiente' });
      const [year, month, date] = todayIn('America/Santiago', new Date()).split('-').map(Number);
      await panel
        .getByLabel('Nueva fecha comprometida')
        .fill(new Date(Date.UTC(year, month - 1, date + 7)).toISOString().slice(0, 10));
      await panel.getByLabel(/Nota para el cliente/).fill('Falta la firma de tu jefatura');
      await panel.getByRole('button', { name: 'Informar retraso' }).click();
      await expect(panel).toContainText('Aprobación pendiente · Falta la firma de tu jefatura');

      // From the portal home, "Mis requerimientos" lists it and opens it.
      await rosa.goto(new URL('/', rosaInvitation).toString());
      const list = rosa.getByRole('region', { name: 'Mis requerimientos' });
      await expect(list).toContainText('Cuentas de usuarios · En gestión');
      await list.getByRole('button', { name: new RegExp(subject) }).click();
      const followed = rosa.getByRole('region', { name: 'Seguimiento de tu requerimiento' });
      await expect(followed.locator('[aria-current="step"]')).toContainText('En gestión');
      await expect(followed).toContainText('Aprobación pendiente · Falta la firma de tu jefatura');
      await expect(followed.getByRole('list', { name: 'Historial del requerimiento' })).toContainText(
        'Retraso: Aprobación pendiente',
      );
      await expectNoSeriousViolations(rosa, 'Requerimiento en el portal');
    } finally {
      await rosaContext.close();
    }
  });

  test('delivering a requested monitor assigns it to the client, solves the ticket, and the client confirms', async ({
    page,
    browser,
  }) => {
    expect(rosaPassword).not.toBe('');
    const subject = 'Necesito un segundo monitor';
    const rosaContext = await browser.newContext();
    const rosa = await rosaContext.newPage();
    try {
      await rosa.goto(new URL('/login', rosaInvitation).toString());
      await rosa.getByLabel('Correo electrónico').fill('rosa@example.test');
      await rosa.getByLabel('Contraseña').fill(rosaPassword);
      await rosa.getByRole('button', { name: 'Entrar a mi espacio' }).click();
      await rosa.waitForURL(url => url.pathname === '/', { timeout: 30_000 });
      await rosa.getByRole('button', { name: 'Nuevo ticket' }).first().click();
      const form = rosa.locator('form.client-new-ticket');
      await form.getByRole('combobox', { name: 'Tipo de solicitud' }).selectOption({ label: 'Un pedido: Equipos' });
      await form.getByRole('combobox', { name: /Sobre qué equipo/ }).selectOption({ label: 'No es sobre un equipo' });
      await form.getByLabel('Asunto').fill(subject);
      await form.getByRole('textbox', { name: 'Descripción' }).fill('Para trabajar con dos pantallas.');
      await form.getByRole('button', { name: 'Crear ticket' }).click();
      const created = rosa.getByText(/Tu ticket #\d{4} fue creado/);
      await expect(created).toBeVisible();
      const ticket = Number(/#(\d{4})/.exec((await created.textContent()) ?? '')?.[1]);

      // The team delivers it with the monitor's inventory ID: assigned to Rosa, and the ticket is solved.
      await page.goto(`/?ticket=${ticket}`);
      const panel = page.getByRole('region', { name: 'Seguimiento del requerimiento' });
      await panel.getByLabel('ID del equipo entregado').fill('mon-9');
      await panel.getByLabel('Tipo de equipo').selectOption({ label: 'Monitor' });
      await panel.getByRole('button', { name: 'Marcar entregado' }).click();
      await expect(page.getByText('Requerimiento entregado y ticket solucionado')).toBeVisible();
      await expect(panel.locator('[aria-current="step"]')).toHaveCount(0);
      await expect(panel).toContainText('equipo MON-9');
      await expect(panel).toContainText('Sin confirmar (es opcional)');
      await expect(page.getByRole('button', { name: 'Marcar solucionado' })).toHaveCount(0);
      await expect(page.locator('.ticket-equipment')).toContainText('MON-9 · Monitor');

      // Rosa sees the delivery, confirms it (once), and the monitor is now hers.
      await rosa.goto(new URL('/', rosaInvitation).toString());
      await expect(rosa.getByRole('region', { name: 'Mis equipos' })).toContainText('MON-9');
      await rosa
        .getByRole('region', { name: 'Mis requerimientos' })
        .getByRole('button', { name: new RegExp(subject) })
        .click();
      const tracking = rosa.getByRole('region', { name: 'Seguimiento de tu requerimiento' });
      await expect(tracking).toContainText('Fue entregado.');
      await expect(tracking).toContainText('MON-9');
      await tracking.getByRole('button', { name: 'Confirmar recepción' }).click();
      await expect(tracking).toContainText('Confirmaste que lo recibiste.');
      await expect(tracking.getByRole('button', { name: 'Confirmar recepción' })).toHaveCount(0);
      await expectNoSeriousViolations(rosa, 'Requerimiento entregado en el portal');
    } finally {
      await rosaContext.close();
    }

    // The section counts it and exports the list.
    await page.goto('/?view=requirements');
    const summary = page.getByRole('region', { name: 'Resumen de requerimientos' });
    await expect(summary).toContainText('entregados');
    await expect(summary).toContainText('Proveedor');
    const download = page.waitForEvent('download');
    await summary.getByRole('button', { name: 'Exportar CSV' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^requerimientos-\d{4}-\d{2}-\d{2}\.csv$/);
    await expectNoSeriousViolations(page, 'Requerimientos con resumen');
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
        ['requirements', 'Requerimientos'],
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
