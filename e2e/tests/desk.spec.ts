import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { expectNoSeriousViolations } from '../support/axe';
import { readRunState } from '../support/state';
import { todayIn } from '../../lib/fulfillment-model';
import { calculateTicketDueAt, readServicePolicySnapshot } from '../../lib/sla-policy';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { BASE_URL, DATABASE_URL, OWNER_EMAIL } from '../support/env';

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
  // Lucía, imported from a spreadsheet, activates her account in the import test and confirms her equipment later.
  // Her session is reused: one more password sign-in would hit the sign-in rate limit of the last test.
  let luciaSession: Awaited<ReturnType<BrowserContext['storageState']>> | undefined;
  // Rosa signed in on a phone, shared by the two portal tests on a phone that follow each other.
  let rosaPhoneSession: Awaited<ReturnType<BrowserContext['storageState']>> | undefined;
  test('an empty inbox is accessible and invites the first ticket', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Bandeja de entrada' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Nuevo ticket' })).toBeEnabled();
    await expectNoSeriousViolations(page, 'Bandeja vacía');
  });

  test('the rail opens with the shared Daybook brand block, the same size as Parte Diario and Travel', async ({
    page,
  }) => {
    await page.goto('/');
    const block = page.locator('#daybook-navigation > .db-brand-block.db-on-dark');
    await expect(block).toHaveCSS('min-height', '92px');
    const logo = block.getByRole('img', { name: 'Daybook Ticket', exact: true });
    await expect(logo).toHaveClass(/\bdb-lockup\b/);
    await expect(logo.locator('.db-mark')).toHaveCSS('width', '40px');
    await expect(logo.locator('.db-lockup__product')).toHaveText('Ticket');
    await expect(block.locator('img')).toHaveCount(0);
    await block.getByRole('button', { name: 'Daybook Ticket' }).click();
    await expect(page.getByRole('heading', { name: 'Bandeja de entrada' })).toBeVisible();
  });

  test('the rail list is the shared Daybook one, aligned with the brand, and the person stays in view', async ({
    page,
  }) => {
    // A laptop that is not tall: before, the whole rail scrolled and the person and the theme were below the fold.
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/');
    const rail = page.locator('#daybook-navigation');
    const main = rail.getByRole('navigation', { name: 'Navegación principal' });
    await expect(main).toHaveClass(/\bdb-rail-nav\b/);
    const inbox = main.getByRole('button', { name: /^Bandeja de entrada/ });
    await expect(inbox).toHaveAttribute('aria-current', 'page');
    const measured = await rail.evaluate(element => {
      const left = (el: Element | null) => Math.round(el!.getBoundingClientRect().left);
      const rows = [...element.querySelectorAll('.db-rail-nav .db-rail-link')];
      const section = element.querySelector('.db-rail-section')!;
      const mark = element.querySelector('.db-brand-block .db-mark')!.getBoundingClientRect();
      const style = (el: Element) => {
        const c = getComputedStyle(el);
        return { size: c.fontSize, weight: c.fontWeight };
      };
      const current = element.querySelector('.db-rail-link[aria-current="page"]')!;
      return {
        heights: [...new Set(rows.map(row => Math.round(row.getBoundingClientRect().height)))],
        gap: Math.round(rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().bottom),
        icon: left(rows[0].querySelector('svg')),
        section: Math.round(section.getBoundingClientRect().left + parseFloat(getComputedStyle(section).paddingLeft)),
        mark: Math.round(mark.left + (mark.width * 10) / 96),
        row: style(rows.find(row => row !== current)!),
        current: style(current),
        sectionStyle: { ...style(section), transform: getComputedStyle(section).textTransform },
        footer: Math.round(element.querySelector('.db-rail-footer')!.getBoundingClientRect().bottom),
        height: innerHeight,
      };
    });
    expect(measured.heights).toEqual([44]);
    expect(measured.gap).toBe(2);
    // Icons, group titles and the edge of the brand mark start on the same line, as in Parte Diario.
    expect(measured.icon).toBe(22);
    expect(measured.section).toBe(22);
    expect(Math.abs(measured.mark - 22)).toBeLessThanOrEqual(1);
    expect(measured.row).toEqual({ size: '13px', weight: '500' });
    expect(measured.current).toEqual({ size: '13px', weight: '600' });
    expect(measured.sectionStyle).toEqual({ size: '11px', weight: '600', transform: 'uppercase' });
    expect(measured.footer).toBeLessThanOrEqual(measured.height);
    // The footer is the shared one, as in Parte Diario: the person and the theme in one row, no «Cerrar sesión».
    const account = rail.locator('.db-rail-footer > .db-rail-account');
    await expect(account.locator('.db-rail-avatar')).toHaveText('PD');
    await expect(account.locator('.db-rail-avatar')).toHaveCSS('width', '34px');
    await expect(account.locator('.db-rail-account__name')).toHaveText('Propietaria de Prueba');
    const theme = account.getByRole('button', { name: /^Tema: / });
    await expect(theme).toBeInViewport();
    expect((await theme.boundingBox())!.width).toBe(44);
    await expect(rail.getByRole('button', { name: 'Cerrar sesión' })).toHaveCount(0);
    if (process.env.DAYBOOK_E2E_CAPTURES)
      await page.screenshot({ path: `${process.env.DAYBOOK_E2E_CAPTURES}/riel-ticket-1366x768.png` });

    // A real click moves the mark; the account rows now say where the person is too.
    await rail.getByRole('button', { name: 'Configuración', exact: true }).click();
    await expect(rail.getByRole('button', { name: 'Configuración', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(inbox).not.toHaveAttribute('aria-current', 'page');
    await main.getByRole('button', { name: /^Bandeja de entrada/ }).click();
    await expect(inbox).toHaveAttribute('aria-current', 'page');
    await expectNoSeriousViolations(page, 'Riel común');
    // The list scrolls on its own, down to the account rows, while the person stays put.
    await rail.locator('.db-rail-scroll').evaluate(element => element.scrollTo({ top: element.scrollHeight }));
    await expect(rail.getByRole('button', { name: 'Centro de ayuda' })).toBeInViewport();
    await expect(theme).toBeInViewport();
    if (process.env.DAYBOOK_E2E_CAPTURES)
      await page.screenshot({ path: `${process.env.DAYBOOK_E2E_CAPTURES}/riel-ticket-1366x768-abajo.png` });
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
    const composer = page.getByPlaceholder('Escribe la respuesta al cliente…');
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

    // Closing is only allowed after solving, so the Resumen counts a closed ticket as solved.
    await page.goto('/');
    const queueCount = async (name: RegExp) =>
      Number((await page.getByRole('button', { name }).innerText()).match(/\d+/)?.[0]);
    const all = await queueCount(/^Todos/);
    const solved = (await queueCount(/^Solucionados/)) + (await queueCount(/^Cerrados/));
    expect(solved).toBeGreaterThan(0);
    await page.goto('/?view=overview');
    await expect(page.locator('.resolution p')).toHaveText(`${solved} de ${all} tickets.`);
    await expect(page.locator('.resolution .donut strong')).toHaveText(`${Math.round((solved / all) * 100)}%`);

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

  test('exporting only reads: the desk stays usable and does not announce saving', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: SUBJECT })).toBeVisible();
    // The export pages through the search with 100 per page; hold it to look at the desk meanwhile.
    let release!: () => void;
    const held = new Promise<void>(resolve => (release = resolve));
    await page.route(
      url => url.pathname === '/api/tickets/search' && url.searchParams.get('limit') === '100',
      async route => {
        await held;
        await route.continue();
      },
    );
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Exportar' }).click();
    await expect(page.getByRole('button', { name: 'Exportando…' })).toBeDisabled();
    await expect(page.locator('.saving')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Nuevo ticket' })).toBeEnabled();
    await page.getByRole('link', { name: SUBJECT }).click();
    await expect(page.locator('.ticket-meta .status')).toBeVisible();
    release();
    expect((await download).suggestedFilename()).toBe('tickets.csv');
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Exportar' })).toBeEnabled();
  });

  test('the inbox gives the table the whole width, and the overdue card, in the danger colour, filters the queue', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Bandeja de entrada', level: 1 })).toBeVisible();
    // No «En foco» panel repeating the overdue count beside the table: the table takes that width.
    await expect(page.getByRole('heading', { name: 'En foco' })).toHaveCount(0);
    const table = (await page.locator('.ticket-panel').boundingBox())!;
    const stats = (await page.locator('.stats').boundingBox())!;
    expect(Math.abs(table.width - stats.width)).toBeLessThanOrEqual(1);
    // Counts read as plain numbers, not «03».
    const values = await page.locator('.stat-card > strong').allTextContents();
    expect(values).toHaveLength(4);
    for (const value of values) expect(value).toMatch(/^(0|[1-9]\d*)$/);

    const overdue = page.locator('.stat-card', { hasText: 'SLA vencido' });
    const danger = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--db-danger)';
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    });
    await expect(overdue.locator('.stat-icon')).toHaveCSS('color', danger);
    await expectNoSeriousViolations(page, 'Bandeja sin el panel En foco');

    // A real click anywhere on the card (here, on its number) opens the overdue queue.
    const number = (await overdue.locator('strong').boundingBox())!;
    await page.mouse.click(number.x + number.width / 2, number.y + number.height / 2);
    await expect(page.locator('.queue-tabs').getByRole('button', { name: /SLA vencido/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // And it is a button for the keyboard too.
    await page.locator('.queue-tabs').getByRole('button', { name: /Todos/ }).click();
    await overdue.getByRole('button', { name: 'SLA vencido' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.queue-tabs').getByRole('button', { name: /SLA vencido/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('settings opens by section and the section stays in the address', async ({ page }) => {
    await page.goto('/');
    const settings = page.getByRole('button', { name: 'Ajustes del espacio', exact: true });
    await settings.click();
    await expect(page).toHaveURL(/view=settings/);
    await expect(settings).toHaveAttribute('class', /active/);
    await expect(page.getByRole('heading', { name: 'Ajustes del espacio', level: 1 })).toBeVisible();
    await expectNoSeriousViolations(page, 'Ajustes del espacio');
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

  test('choosing a theme by hand marks data-theme like the other Daybook apps and survives a reload', async ({
    page,
  }) => {
    await page.goto('/');
    const html = page.locator('html');
    const rail = page.locator('#daybook-navigation');
    // The button at the foot of the rail cycles Sistema → Claro → Oscuro, like Parte Diario's.
    const theme = rail.getByRole('button', { name: /^Tema: / });
    await expect(theme).toHaveAccessibleName('Tema: Sistema');
    await expect(theme).toHaveAttribute('title', 'Cambiar a Claro');
    // The choice is saved with PUT /api/preferences; reload only after the server answered.
    const savedPreference = () =>
      page.waitForResponse(r => r.url().endsWith('/api/preferences') && r.request().method() === 'PUT' && r.ok());
    await Promise.all([savedPreference(), theme.click()]);
    await expect(theme).toHaveAccessibleName('Tema: Claro');
    await expect(html).toHaveAttribute('data-theme', 'light');
    await Promise.all([savedPreference(), theme.click()]);
    await expect(theme).toHaveAccessibleName('Tema: Oscuro');
    await expect(theme).toHaveAttribute('title', 'Cambiar a Sistema');
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect(html).toHaveAttribute('data-theme-preference', 'dark');
    await expect(html).not.toHaveAttribute('data-color-scheme', /./);
    // The class that freezes transitions while the theme changes is gone again.
    await expect(html).not.toHaveClass(/db-theme-switching/);
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
    await page.reload();
    await expect(theme).toHaveAccessibleName('Tema: Oscuro');
    await expect(html).toHaveAttribute('data-theme', 'dark');
    // Configuración › Apariencia shows the same choice and changes it too.
    await rail.getByRole('button', { name: 'Configuración', exact: true }).click();
    await expect(page).toHaveURL(/view=account/);
    const choice = page.getByRole('group', { name: 'Tema' });
    await expect(choice.getByRole('radio', { name: 'Oscuro' })).toBeChecked();
    await Promise.all([savedPreference(), choice.getByText('Según el sistema').click()]);
    await expect(choice.getByRole('radio', { name: 'Según el sistema' })).toBeChecked();
    await expect(theme).toHaveAccessibleName('Tema: Sistema');
    await expect(html).toHaveAttribute('data-theme', 'light');
    await expect(html).toHaveAttribute('data-theme-preference', 'system');
  });

  test('Configuración holds the appearance, the account and its security, the session and help', async ({ page }) => {
    // The old address of «Seguridad» lands in Configuración.
    await page.goto('/?view=security');
    await expect(page).toHaveURL(/view=account/);
    await expect(page.getByRole('heading', { name: 'Configuración', level: 1 })).toBeVisible();
    const rail = page.locator('#daybook-navigation');
    await expect(rail.getByRole('button', { name: 'Configuración', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(rail.getByRole('button', { name: 'Seguridad', exact: true })).toHaveCount(0);
    const main = page.locator('main');
    await expect(main.getByRole('heading', { name: 'Cómo se ve la aplicación' })).toBeVisible();
    await expect(main.getByRole('heading', { name: 'Propietaria de Prueba', level: 2 })).toBeVisible();
    await expect(main.locator('.settings-facts').getByText(OWNER_EMAIL)).toBeVisible();
    await expect(main.getByRole('heading', { name: 'Seguridad de tu cuenta' })).toBeVisible();
    await expect(main.getByRole('heading', { name: 'Salir de este dispositivo' })).toBeVisible();
    await expect(main.getByText('Tendrás que ingresar de nuevo para seguir.')).toBeVisible();
    const session = main.getByRole('region', { name: 'Salir de este dispositivo' });
    const signOut = session.getByRole('button', { name: 'Cerrar sesión' });
    await expect(signOut).toHaveCSS('background-color', 'rgb(179, 38, 30)');
    expect((await signOut.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(main.getByRole('button', { name: 'Abrir el centro de ayuda' })).toBeVisible();
    await expect(page.locator('.loading')).toHaveCount(0);
    await expectNoSeriousViolations(page, 'Configuración');
    if (process.env.DAYBOOK_E2E_CAPTURES)
      await page.screenshot({ path: `${process.env.DAYBOOK_E2E_CAPTURES}/configuracion-1280.png`, fullPage: true });
    // «Cerrar sesión» asks first; «Seguir trabajando» keeps the session.
    await signOut.click();
    const dialog = page.getByRole('dialog', { name: 'Cerrar sesión' });
    await expect(dialog.getByRole('button', { name: 'Seguir trabajando' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Seguir trabajando' }).click();
    await expect(dialog).toBeHidden();
    await expect(page).not.toHaveURL(/\/login/);
    await main.getByRole('button', { name: 'Abrir el centro de ayuda' }).click();
    await expect(page.getByRole('heading', { name: 'Centro de ayuda', level: 1 })).toBeVisible();
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

    const invite = async (name: string, email: string, serial = '5cg  1234x') => {
      await page.getByRole('button', { name: 'Invitar persona' }).click();
      const form = page.locator('.access-invite form');
      await form.getByLabel('Nombre', { exact: true }).fill(name);
      await form.getByLabel('Correo de acceso').fill(email);
      await expect(form.getByRole('group', { name: 'Empresa y equipo del cliente' })).toBeVisible();
      await form.getByRole('combobox', { name: /^Empresa/ }).selectOption({ label: 'Constructora Andes' });
      await form.getByLabel('ID del equipo').fill('  nb-0042 ');
      await form.getByLabel('Tipo de equipo').selectOption({ label: 'Computador' });
      await form.getByLabel('N° de serie').fill(serial);
      await form.getByLabel('Marca y modelo (opcional)').fill('Dell Latitude 5440');
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
    const second = await invite('Tomás Soto', 'tomas@example.test', 'CN-0001');
    await second.getByRole('button', { name: 'Crear invitación' }).click();
    await expect(page.getByText('El equipo NB-0042 ya está asignado a Rosa Pérez.')).toBeVisible();
    // A new inventory ID with Rosa's serial number (typed differently) is refused too: the serial is unique.
    await second.getByLabel('ID del equipo').fill('NB-0043');
    await second.getByLabel('N° de serie').fill('5CG 1234X ');
    await second.getByRole('button', { name: 'Crear invitación' }).click();
    await expect(page.getByText(/La serie 5CG 1234X ya está registrada en el equipo NB-0042/)).toBeVisible();
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
    // The serial number is required: the browser stops the form until it is filled.
    await form.getByRole('button', { name: 'Registrar equipo' }).click();
    await expect(page.getByText('Equipo MON-7 registrado')).toHaveCount(0);
    await form.getByLabel('N° de serie').fill('cn-0007');
    await form.getByRole('button', { name: 'Registrar equipo' }).click();
    await expect(page.getByText('Equipo MON-7 registrado')).toBeVisible();
    const monitor = rows.filter({ hasText: 'MON-7' });
    await expect(monitor).toContainText('Monitor');
    await expect(monitor).toContainText('Serie CN-0007');
    await expect(rosa).toContainText('Dell Latitude 5440 · Serie 5CG 1234X');

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
      const created = rosa.getByText(/Ticket #\d{4} creado/);
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
    // «Cuenta del cliente» is the same searchable list as in the ticket: typing part of the email finds her.
    const account = form.getByRole('combobox', { name: 'Cuenta del cliente' });
    const dialog = page.getByRole('dialog', { name: 'Nuevo ticket' });
    const accounts = page.getByRole('listbox', { name: 'Cuenta del cliente' });
    // The list opens right under the field, inside the modal (not hidden behind its top layer), and Escape closes
    // only the list: the half-written ticket stays open.
    await account.click();
    await expect(accounts).toBeVisible();
    const field = (await account.boundingBox())!;
    const list = (await accounts.boundingBox())!;
    expect(list.y - (field.y + field.height)).toBeGreaterThanOrEqual(0);
    expect(list.y - (field.y + field.height)).toBeLessThan(12);
    await page.keyboard.press('Escape');
    await expect(accounts).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await account.pressSequentially('rosa@example');
    await expect(accounts.getByRole('option')).toHaveCount(1);
    await expect(accounts.getByRole('option', { name: /Rosa Pérez/ })).toContainText('rosa@example.test');
    await accounts.getByRole('option', { name: /Rosa Pérez/ }).click();
    await expect(accounts).toHaveCount(0);
    await expect(account).toHaveValue('Rosa Pérez');
    await expect(form.locator('.staff-account-preview')).toContainText('rosa@example.test');
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
      const created = rosa.getByText(/Ticket #\d{4} creado/);
      await expect(created).toBeVisible();
      const ticket = Number(/#(\d{4})/.exec((await created.textContent()) ?? '')?.[1]);

      // The follow-up starts on its own: the tracking line is there from the first moment.
      const tracking = rosa.getByRole('region', { name: 'Seguimiento de tu requerimiento' });
      await expect(tracking.locator('[aria-current="step"]')).toContainText('Solicitado');
      await expect(tracking).toContainText('Por confirmar');

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
      const created = rosa.getByText(/Ticket #\d{4} creado/);
      await expect(created).toBeVisible();
      const ticket = Number(/#(\d{4})/.exec((await created.textContent()) ?? '')?.[1]);

      // The team delivers it with the monitor's inventory ID: assigned to Rosa, and the ticket is solved.
      await page.goto(`/?ticket=${ticket}`);
      const panel = page.getByRole('region', { name: 'Seguimiento del requerimiento' });
      await panel.getByLabel('ID del equipo entregado').fill('mon-9');
      await panel.getByLabel('Tipo de equipo').selectOption({ label: 'Monitor' });
      await panel.getByLabel('N° de serie').fill('cn-0009');
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

  test('solving several tickets at once asks first, and «Cancelar» leaves them as they were', async ({ page }) => {
    const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 1 });
    const ids: number[] = [];
    const statuses = async () =>
      (
        await pool.query<{ status: string }>(`SELECT status FROM tickets WHERE id = ANY($1::int[]) ORDER BY id`, [ids])
      ).rows.map(row => row.status);
    try {
      const owner = (await pool.query<{ ownerId: string }>(`SELECT "ownerId" FROM organizations WHERE id='daybook'`))
        .rows[0].ownerId;
      const now = new Date().toISOString();
      const due = new Date(Date.now() + 86_400_000).toISOString();
      for (const subject of ['Lote: mouse sin batería', 'Lote: teclado sin la letra ñ']) {
        const ticket = await pool.query<{ id: number }>(
          `INSERT INTO tickets ("ownerId","creationKey",subject,"requesterName","requesterEmail",department,status,priority,"createdAt","updatedAt","dueAt")
           VALUES ($1,$4,$2,'Cliente Lote','lote@example.test','Soporte técnico','open','normal',$3,$3,$5) RETURNING id`,
          [owner, subject, now, randomUUID(), due],
        );
        ids.push(ticket.rows[0].id);
        await pool.query(
          `INSERT INTO messages ("ownerId","ticketId",author,"authorRole",body,kind,"createdAt") VALUES ($1,$2,'Cliente Lote','client','Se cayó al piso.','request',$3)`,
          [owner, ticket.rows[0].id, now],
        );
      }

      await page.goto('/');
      const bar = page.locator('.bulk-bar');
      const dialog = page.getByRole('dialog', { name: 'Marcar como solucionados' });
      // With one ticket the question is in singular.
      await page.getByRole('checkbox', { name: `Seleccionar ticket ${ids[0]}` }).check();
      await bar.getByRole('button', { name: 'Marcar como solucionados' }).click();
      await expect(dialog).toContainText(
        'Vas a marcar 1 ticket como solucionado. Al cliente se le pedirá que evalúe la atención',
      );
      await expect(dialog.getByRole('button', { name: 'Solucionar 1 ticket' })).toBeVisible();
      await dialog.getByRole('button', { name: 'Cancelar' }).click();
      await expect(dialog).toBeHidden();
      await page.getByRole('checkbox', { name: `Seleccionar ticket ${ids[1]}` }).check();
      await expect(bar).toContainText('2 seleccionados');
      await bar.getByRole('button', { name: 'Marcar como solucionados' }).click();
      await expect(dialog).toContainText('Vas a marcar 2 tickets como solucionados. A cada cliente');
      await expect(dialog).toContainText('no se puede deshacer');
      // Focus starts on the safe choice; the red button names the action.
      await expect(dialog.getByRole('button', { name: 'Cancelar' })).toBeFocused();
      await expect(dialog.getByRole('button', { name: 'Solucionar 2 tickets' })).toBeVisible();
      await expectNoSeriousViolations(page, 'Confirmar solucionar varios');
      await dialog.getByRole('button', { name: 'Cancelar' }).click();
      await expect(dialog).toBeHidden();
      await expect(bar).toContainText('2 seleccionados');
      expect(await statuses()).toEqual(['open', 'open']);

      await bar.getByRole('button', { name: 'Marcar como solucionados' }).click();
      await dialog.getByRole('button', { name: 'Solucionar 2 tickets' }).click();
      await expect(page.getByRole('status').filter({ hasText: '2 tickets solucionados' })).toBeVisible();
      await expect(dialog).toBeHidden();
      await expect(bar).toHaveCount(0);
      await expect.poll(statuses).toEqual(['resolved', 'resolved']);
    } finally {
      await pool.end();
    }
  });

  test('after solving several tickets, focus lands on the head of the list and the result is announced', async ({
    page,
  }, testInfo) => {
    const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 1 });
    try {
      const owner = (await pool.query<{ ownerId: string }>(`SELECT "ownerId" FROM organizations WHERE id='daybook'`))
        .rows[0].ownerId;
      const seed = async (subjects: string[]) => {
        const now = new Date().toISOString();
        const due = new Date(Date.now() + 86_400_000).toISOString();
        const ids: number[] = [];
        for (const subject of subjects) {
          const ticket = await pool.query<{ id: number }>(
            `INSERT INTO tickets ("ownerId","creationKey",subject,"requesterName","requesterEmail",department,status,priority,"createdAt","updatedAt","dueAt")
             VALUES ($1,$4,$2,'Cliente Foco','foco@example.test','Soporte técnico','open','normal',$3,$3,$5) RETURNING id`,
            [owner, subject, now, randomUUID(), due],
          );
          ids.push(ticket.rows[0].id);
          await pool.query(
            `INSERT INTO messages ("ownerId","ticketId",author,"authorRole",body,kind,"createdAt") VALUES ($1,$2,'Cliente Foco','client','No funciona.','request',$3)`,
            [owner, ticket.rows[0].id, now],
          );
        }
        return ids;
      };
      const bar = page.locator('.bulk-bar');
      const dialog = page.getByRole('dialog', { name: 'Marcar como solucionados' });
      const status = page.locator('.toast-region[role="status"]');
      const activeQueue = page.locator('.queue-tabs').getByRole('button', { pressed: true });
      const solveSelected = async (count: number) => {
        await bar.getByRole('button', { name: 'Marcar como solucionados' }).click();
        await dialog.getByRole('button', { name: `Solucionar ${count} ticket${count === 1 ? '' : 's'}` }).click();
        await expect(dialog).toBeHidden();
      };

      // The desk on a wide screen (table) and on a phone (cards): the same bar, the same landing place.
      for (const [width, height] of [
        [1440, 900],
        [390, 844],
      ] as const) {
        await page.setViewportSize({ width, height });
        const ids = await seed([`Foco ${width}: cargador que calienta`, `Foco ${width}: monitor con rayas`]);
        await page.goto('/');
        for (const id of ids) await page.getByRole('checkbox', { name: `Seleccionar ticket ${id}` }).click();
        await expect(bar).toContainText('2 seleccionados');
        await solveSelected(2);
        await expect(bar).toHaveCount(0);
        // The status region, polite and present before the notice, says what happened.
        await expect(status).toHaveAttribute('aria-live', 'polite');
        await expect(status).toContainText('2 tickets solucionados');
        // Focus is not lost on <body>: it sits on the active queue tab, the head of the list, in view.
        await expect(activeQueue).toBeFocused();
        await expect(activeQueue).toBeInViewport();
        expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
        await page.screenshot({ path: testInfo.outputPath(`foco-tras-solucionar-${width}.png`) });
        // And it stays there once the list has refreshed.
        await page.waitForTimeout(1500);
        await expect(activeQueue).toBeFocused();
        // From there the keyboard goes on through the list.
        await page.keyboard.press('Tab');
        expect(await page.evaluate(() => document.activeElement?.closest('.ticket-panel') !== null)).toBe(true);
      }

      // If one of them fails, the bar stays with the one left, the error is said, and focus goes back to its button.
      await page.setViewportSize({ width: 1440, height: 900 });
      const [kept, refused] = await seed(['Foco: parlante sin sonido', 'Foco: cámara que no enciende']);
      await page.goto('/');
      await page.route(`**/api/tickets/${refused}`, route =>
        route.request().method() === 'PATCH'
          ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"No se pudo guardar."}' })
          : route.fallback(),
      );
      for (const id of [kept, refused]) await page.getByRole('checkbox', { name: `Seleccionar ticket ${id}` }).click();
      await solveSelected(2);
      await expect(page.getByRole('alert').filter({ hasText: 'Se solucionaron 1 de 2' })).toContainText(
        `No se pudieron solucionar: #${String(refused).padStart(4, '0')}.`,
      );
      // One left, said in singular.
      await expect(bar.locator('strong')).toHaveText('1 seleccionado');
      await expect(bar.getByRole('button', { name: 'Marcar como solucionados' })).toBeFocused();
      await page.unroute(`**/api/tickets/${refused}`);

      // The bar's own «Cancelar» also takes the bar away: focus goes to the head of the list, not to <body>.
      await bar.getByRole('button', { name: 'Cancelar' }).click();
      await expect(bar).toHaveCount(0);
      await expect(activeQueue).toBeFocused();

      // Solved on a second try, so the ticket does not stay open for the tests that follow.
      await page.getByRole('checkbox', { name: `Seleccionar ticket ${refused}` }).click();
      await solveSelected(1);
      await expect(status).toContainText('Ticket solucionado');
      await expect(activeQueue).toBeFocused();
      await expect
        .poll(async () =>
          (
            await pool.query<{ status: string }>(`SELECT status FROM tickets WHERE id = ANY($1::int[]) ORDER BY id`, [
              [kept, refused],
            ])
          ).rows.map(row => row.status),
        )
        .toEqual(['resolved', 'resolved']);
    } finally {
      await page.setViewportSize({ width: 1280, height: 720 });
      await pool.end();
    }
  });

  test('the portal says under each field what a new ticket lacks, and its notices sit bottom centre, in view', async ({
    browser,
  }) => {
    expect(rosaPassword).not.toBe('');
    const rosaContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const rosa = await rosaContext.newPage();
    // The notice is fixed at the bottom centre of the screen, whatever was scrolled.
    const expectBottomCentre = async (notice: Locator, name: string) => {
      await expect(notice, name).toBeVisible();
      const box = (await notice.boundingBox())!;
      expect(Math.abs(box.x + box.width / 2 - 195), `${name}: centrado`).toBeLessThanOrEqual(2);
      expect(box.y, `${name}: dentro de la pantalla`).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height, `${name}: abajo`).toBeLessThanOrEqual(844);
      expect(box.y + box.height, `${name}: abajo`).toBeGreaterThan(844 - 120);
    };
    try {
      await rosa.goto(new URL('/login', rosaInvitation).toString());
      await rosa.getByLabel('Correo electrónico').fill('rosa@example.test');
      await rosa.getByLabel('Contraseña').fill(rosaPassword);
      await rosa.getByRole('button', { name: 'Entrar a mi espacio' }).click();
      await rosa.waitForURL(url => url.pathname === '/', { timeout: 30_000 });

      // «Crear ticket» is not a dead button: pressed with nothing written, it says what is missing.
      await rosa.getByRole('button', { name: 'Nuevo ticket' }).first().click();
      const form = rosa.locator('form.client-new-ticket');
      const create = form.getByRole('button', { name: 'Crear ticket' });
      const subject = form.getByRole('textbox', { name: 'Asunto' });
      const description = form.getByRole('textbox', { name: 'Descripción' });
      await expect(create).toBeEnabled();
      await create.click();
      const subjectError = form.getByText('Escribe el asunto', { exact: true });
      const descriptionError = form.getByText('Escribe la descripción', { exact: true });
      await expect(subjectError).toBeVisible();
      await expect(descriptionError).toBeVisible();
      await expect(subject).toBeFocused();
      await expect(subject).toHaveAttribute('aria-invalid', 'true');
      await expect(subject).toHaveAccessibleDescription('Escribe el asunto');
      await expect(description).toHaveAttribute('aria-invalid', 'true');
      // The message sits right under its field.
      const field = (await subject.boundingBox())!;
      const message = (await subjectError.boundingBox())!;
      expect(message.y).toBeGreaterThanOrEqual(field.y + field.height);
      expect(message.y - (field.y + field.height)).toBeLessThan(20);
      // Department is still asked; priority is the team's to set.
      await expect(form.getByRole('combobox', { name: 'Departamento' })).toBeVisible();
      await expect(form.getByRole('combobox', { name: 'Prioridad' })).toHaveCount(0);
      await expectNoSeriousViolations(rosa, 'Nuevo ticket del portal con campos por llenar');

      await subject.fill('La pantalla parpadea al abrir el correo');
      await expect(subjectError).toHaveCount(0);
      await expect(subject).toHaveAttribute('aria-invalid', 'false');
      await create.click();
      await expect(description).toBeFocused();
      await description.fill('Parpadea cada vez que abro un correo con imágenes.');
      await expect(descriptionError).toHaveCount(0);
      await create.click();
      const created = rosa.getByRole('status').filter({ hasText: /Ticket #\d{4} creado/ });
      await expectBottomCentre(created.locator('.toast'), 'Aviso de ticket creado');

      // A reply at the end of the chat: the confirmation is in view, not at the top of the page.
      await rosa
        .getByRole('navigation', { name: 'Portal de clientes' })
        .getByRole('button', { name: 'Mis tickets' })
        .click();
      await rosa.getByRole('button', { name: /El notebook no enciende/ }).click();
      const composer = rosa.locator('form.client-composer');
      const reply = composer.getByRole('textbox', { name: 'Añadir una respuesta' });
      await reply.fill('Lo probé con otro cargador y sigue igual.');
      await composer.getByRole('button', { name: 'Enviar respuesta' }).click();
      const sent = rosa.getByRole('status').filter({ hasText: 'Respuesta enviada.' });
      await expectBottomCentre(sent.locator('.toast'), 'Aviso de respuesta enviada');

      // A failed send: the error is the red notice with a warning icon, and it stays until it is closed.
      await rosa.route('**/api/tickets/*/messages', route =>
        route.request().method() === 'POST' ? route.abort() : route.fallback(),
      );
      await reply.fill('Este envío no llega.');
      await composer.getByRole('button', { name: 'Enviar respuesta' }).click();
      const failed = rosa.getByRole('alert').filter({ hasText: 'Se interrumpió la conexión' });
      const errorNotice = failed.locator('.toast.error');
      await expectBottomCentre(errorNotice, 'Aviso de error');
      await expect(errorNotice.locator('svg').first()).toHaveClass(/lucide-(triangle-alert|alert-triangle)/);
      await expect(sent).toHaveCount(0);
      await expectNoSeriousViolations(rosa, 'Aviso de error en el portal');
      await failed.getByRole('button', { name: 'Cerrar aviso' }).click();
      await expect(failed).toHaveCount(0);
      await rosa.unroute('**/api/tickets/*/messages');
      await reply.fill('');
      // Sign-in allows 5 tries a minute; the next phone test reuses this session instead of signing in again.
      rosaPhoneSession = await rosaContext.storageState();
    } finally {
      await rosaContext.close();
    }
  });

  test('the portal does not ask the client for a priority, and the server ignores one sent by hand', async ({
    browser,
    page,
  }, testInfo) => {
    expect(rosaPhoneSession).toBeDefined();
    // The session from the test above: signing in again would spend the sign-in limit.
    const rosaContext = await browser.newContext({
      storageState: rosaPhoneSession,
      viewport: { width: 1440, height: 900 },
    });
    const rosa = await rosaContext.newPage();
    const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 1 });
    const saved = async (id: number) =>
      (
        await pool.query<{ priority: string; dueAt: string; slaStartedAt: string; slaPolicySnapshot: unknown }>(
          `SELECT priority,"dueAt","slaStartedAt","slaPolicySnapshot" FROM tickets WHERE id=$1`,
          [id],
        )
      ).rows[0];
    // The SLA deadline is the one of the priority actually saved.
    const expectNormalDeadline = async (id: number) => {
      const row = await saved(id);
      expect(row.priority).toBe('normal');
      const policy = readServicePolicySnapshot(row.slaPolicySnapshot);
      expect(policy).not.toBeNull();
      expect(new Date(row.dueAt).toISOString()).toBe(
        calculateTicketDueAt(new Date(row.slaStartedAt).toISOString(), 'normal', policy!),
      );
    };
    try {
      await rosa.goto(new URL('/', rosaInvitation).toString());
      await rosa.getByRole('button', { name: 'Nuevo ticket' }).first().click();
      const form = rosa.locator('form.client-new-ticket');
      await expect(form.getByRole('combobox', { name: 'Departamento' })).toBeVisible();
      await expect(form.getByRole('combobox', { name: 'Tipo de solicitud' })).toBeVisible();
      await expect(form.getByRole('combobox', { name: 'Prioridad' })).toHaveCount(0);
      await expect(form).not.toContainText('Urgente');
      await expectNoSeriousViolations(rosa, 'Nuevo ticket del portal sin prioridad');
      // On a wide screen Departamento and Tipo de solicitud share the row (no half row left empty); on a phone they stack.
      const department = form.getByRole('combobox', { name: 'Departamento' });
      const kind = form.getByRole('combobox', { name: 'Tipo de solicitud' });
      let [a, b] = [(await department.boundingBox())!, (await kind.boundingBox())!];
      expect(Math.abs(a.y - b.y)).toBeLessThan(2);
      expect(b.x).toBeGreaterThan(a.x + a.width);
      await form.screenshot({ path: testInfo.outputPath('portal-sin-prioridad-1440.png') });
      await rosa.setViewportSize({ width: 390, height: 844 });
      [a, b] = [(await department.boundingBox())!, (await kind.boundingBox())!];
      expect(b.y).toBeGreaterThan(a.y + a.height);
      expect(
        await rosa.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
      ).toBeLessThanOrEqual(1);
      await expectNoSeriousViolations(rosa, 'Nuevo ticket del portal sin prioridad en un teléfono');
      await rosa.screenshot({ path: testInfo.outputPath('portal-sin-prioridad-390.png'), fullPage: true });

      await form.getByRole('textbox', { name: 'Asunto' }).fill('El escáner no lee los códigos de barra');
      await form
        .getByRole('textbox', { name: 'Descripción' })
        .fill('Lee la etiqueta pero no aparece nada en pantalla.');
      const sending = rosa.waitForRequest(
        request => request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/api/tickets'),
      );
      await form.getByRole('button', { name: 'Crear ticket' }).click();
      const request = await sending;
      expect(request.postDataJSON()).not.toHaveProperty('priority');
      await expect(rosa.getByRole('status').filter({ hasText: /Ticket #\d{4} creado/ })).toBeVisible();
      // The ticket shows the priority the team starts from.
      await expect(rosa.locator('dt', { hasText: 'Prioridad' }).locator('xpath=following-sibling::dd[1]')).toHaveText(
        'Normal',
      );
      const created = (
        await pool.query<{ id: number }>(`SELECT id FROM tickets WHERE subject=$1`, [
          'El escáner no lee los códigos de barra',
        ])
      ).rows[0].id;
      await expectNormalDeadline(created);

      // A request made by hand with «urgent» is saved as «normal», with the normal deadline.
      const forged = await rosa.evaluate(
        async ({ url, body }) => {
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          return {
            status: response.status,
            json: (await response.json()) as { ticket: { id: number; priority: string } },
          };
        },
        {
          url: request.url(),
          body: {
            subject: 'Pedido hecho a mano con prioridad urgente',
            body: 'Esta petición no pasa por el formulario.',
            department: (request.postDataJSON() as { department: string }).department,
            bodyFormat: 'markdown',
            operationId: randomUUID(),
            priority: 'urgent',
          },
        },
      );
      expect(forged.status).toBe(201);
      expect(forged.json.ticket.priority).toBe('normal');
      await expectNormalDeadline(forged.json.ticket.id);
      await rosa.goto(new URL('/', rosaInvitation).toString());
      await rosa.screenshot({ path: testInfo.outputPath('portal-detalle-normal-390.png') });

      // The team still sets it: the same request from the desk keeps «urgent», with the urgent deadline.
      await page.goto('/');
      const staff = await page.evaluate(
        async body => {
          const response = await fetch('/api/tickets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          return {
            status: response.status,
            json: (await response.json()) as { ticket: { id: number; priority: string } },
          };
        },
        {
          subject: 'El equipo marca este ticket como urgente',
          body: 'Creado desde la mesa de ayuda.',
          requesterName: 'Cliente Urgente',
          requesterEmail: 'urgente@example.test',
          department: (request.postDataJSON() as { department: string }).department,
          operationId: randomUUID(),
          priority: 'urgent',
        },
      );
      expect(staff.status).toBe(201);
      expect(staff.json.ticket.priority).toBe('urgent');
      const row = await saved(staff.json.ticket.id);
      expect(row.priority).toBe('urgent');
      expect(new Date(row.dueAt).toISOString()).toBe(
        calculateTicketDueAt(
          new Date(row.slaStartedAt).toISOString(),
          'urgent',
          readServicePolicySnapshot(row.slaPolicySnapshot)!,
        ),
      );
      // The two deadlines differ, so the forged ticket really got the normal one.
      const hours = readServicePolicySnapshot(row.slaPolicySnapshot)!.slaHours;
      expect(hours.urgent).not.toBe(hours.normal);
    } finally {
      await pool.end();
      await rosaContext.close();
    }
  });

  test('on a phone the client reply box fits a finger, and signing out of the portal asks first', async ({
    browser,
  }) => {
    expect(rosaPhoneSession).toBeDefined();
    const rosaContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      storageState: rosaPhoneSession,
    });
    const rosa = await rosaContext.newPage();
    try {
      await rosa.goto(new URL('/', rosaInvitation).toString());
      expect(await rosa.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);

      await rosa.getByRole('button', { name: /El notebook no enciende/ }).click();
      const composer = rosa.locator('form.client-composer');
      await expect(composer.getByPlaceholder('Escribe tu respuesta o añade información…')).toBeVisible();
      await composer.getByRole('toolbar').getByRole('button', { name: 'Formato' }).click();
      const controls = [
        ...(await composer.getByRole('toolbar').getByRole('button').all()),
        composer.locator('label.attachment-picker'),
        composer.getByRole('button', { name: 'Enviar respuesta' }),
      ];
      expect(controls.length).toBeGreaterThan(5);
      for (const control of controls) {
        await expect(control).toBeVisible();
        expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }

      const signOut = rosa.getByRole('button', { name: 'Cerrar sesión' });
      const door = (await signOut.boundingBox())!;
      expect(door.width, 'Cerrar sesión: ancho con el dedo').toBeGreaterThanOrEqual(44);
      expect(door.height, 'Cerrar sesión: alto con el dedo').toBeGreaterThanOrEqual(44);
      await signOut.click();
      const dialog = rosa.getByRole('dialog', { name: 'Cerrar sesión' });
      await expect(dialog).toContainText('Vas a salir de Daybook Ticket en este dispositivo');
      await expect(dialog.getByRole('button', { name: 'Seguir trabajando' })).toBeFocused();
      await expectNoSeriousViolations(rosa, 'Confirmar cierre de sesión en el portal');
      await dialog.getByRole('button', { name: 'Seguir trabajando' }).click();
      await expect(dialog).toBeHidden();
      await expect(rosa).not.toHaveURL(/\/login/);

      await signOut.click();
      await dialog.getByRole('button', { name: 'Cerrar sesión' }).click();
      await expect(rosa).toHaveURL(/\/login/);
    } finally {
      await rosaContext.close();
    }
  });

  test('clients are imported in bulk from a spreadsheet: checked first, created all at once, links downloaded', async ({
    page,
    browser,
  }) => {
    await page.goto('/security');
    await page.getByLabel('Contraseña actual').fill(readRunState().password);
    await page.getByRole('button', { name: 'Verificar contraseña' }).click();
    await expect(page.getByText('Contraseña verificada para esta sesión.')).toBeVisible();
    await page.goto('/?view=team');
    await page.getByRole('button', { name: 'Importar clientes' }).click();
    const panel = page.getByRole('region', { name: 'Importar clientes desde una planilla' });
    await expect(panel).toBeVisible();

    // The template opens in Excel in Spanish: «;», a BOM and the column names.
    const templateDownload = page.waitForEvent('download');
    await panel.getByRole('button', { name: 'Descargar plantilla' }).click();
    const template = await (await templateDownload).createReadStream();
    let templateText = '';
    for await (const chunk of template) templateText += chunk.toString('utf8');
    expect(templateText).toContain('"Nombre";"Correo";"Empresa";"ID del equipo";"Tipo de equipo";"N° de serie"');

    const upload = (lines: string[]) =>
      panel.getByLabel('Archivo CSV').setInputFiles({
        name: 'clientes.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(`﻿${lines.join('\r\n')}\r\n`, 'utf8'),
      });
    const header = 'Nombre;Correo;Empresa;ID del equipo;Tipo de equipo;N° de serie;Marca y modelo';
    const good = [
      'Lucía Rojas;lucia.rojas@example.test;Constructora Andes;nb-0100;Computador;5cg-0100;HP 440 G9',
      // MON-7 is in the inventory without an owner: it is assigned, not duplicated.
      'Pablo Díaz;pablo.diaz@example.test;constructora andes;MON-7;Monitor;CN-0007;',
      'Marta Vega;marta.vega@example.test;Minera Sur;NB-0101;Computador;5CG-0101;',
    ];

    // First file: Rosa already has an account and «Minera Sur» does not exist. Nothing can be created.
    await upload([header, 'Rosa Pérez;rosa@example.test;Constructora Andes;NB-0200;Computador;S-200;', ...good]);
    await panel.getByRole('button', { name: 'Revisar archivo' }).click();
    await expect(panel.getByRole('status')).toContainText('2 de 4 filas listas');
    await expect(panel.getByText('Este correo ya tiene una cuenta o invitación en el espacio.')).toBeVisible();
    await expect(panel.getByText(/La empresa «Minera Sur» no existe/)).toBeVisible();
    await expect(
      panel.getByText('Se asigna el equipo MON-7, que ya estaba en el inventario.', { exact: false }),
    ).toBeVisible();
    await expect(panel.getByRole('button', { name: /^Crear \d+ invitaciones$/ })).toHaveCount(0);
    await expectNoSeriousViolations(page, 'Importar clientes con problemas');

    // Fixed file, and the missing company is created on purpose.
    await upload([header, ...good]);
    await panel.getByLabel('Crear las empresas que falten').check();
    await panel.getByRole('button', { name: 'Revisar archivo' }).click();
    await expect(panel.getByRole('status')).toContainText('3 de 3 filas listas');
    await expect(panel.getByRole('status')).toContainText('empresas nuevas: Minera Sur');
    await panel.getByRole('button', { name: 'Crear 3 invitaciones' }).click();
    await expect(panel.getByText(/Se crearon 3 invitaciones y 1 empresas/)).toBeVisible();
    await expect(panel.getByText(/Cada enlace permite crear la cuenta de esa persona/)).toBeVisible();
    await expectNoSeriousViolations(page, 'Importación terminada');

    const linksDownload = page.waitForEvent('download');
    await panel.getByRole('button', { name: 'Descargar enlaces (CSV)' }).click();
    const download = await linksDownload;
    expect(download.suggestedFilename()).toBe('daybook-enlaces-de-invitacion.csv');
    let links = '';
    for await (const chunk of await download.createReadStream()) links += chunk.toString('utf8');
    const lines = links.trim().split('\r\n');
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain('"Lucía Rojas";"lucia.rojas@example.test";"Constructora Andes";"NB-0100"');
    const lucia = /"(http[^"]+\/login\?invite=[a-f0-9]{64})"/.exec(lines[1])?.[1];
    expect(lucia).toBeTruthy();

    // The list shows them as pending; the equipment is theirs, with its serial number.
    await expect(page.locator('.access-table')).toContainText('lucia.rojas@example.test');
    await page.goto('/?view=equipment');
    await expect(page.locator('.equipment-row').filter({ hasText: 'NB-0100' })).toContainText('Serie 5CG-0100');
    await expect(
      page
        .locator('.equipment-row')
        .filter({ hasText: 'MON-7' })
        .getByRole('combobox', { name: 'Asignado a MON-7' })
        .locator('option:checked'),
    ).toHaveText('Pablo Díaz');

    // A downloaded link works: Lucía activates her account and sees her notebook.
    const luciaContext = await browser.newContext();
    try {
      const luciaPage = await luciaContext.newPage();
      await luciaPage.goto(lucia!);
      const password = `Lucia-e2e-${crypto.randomUUID()}`;
      await luciaPage.getByLabel('Contraseña', { exact: true }).fill(password);
      await luciaPage.getByLabel('Repite tu contraseña').fill(password);
      await luciaPage.getByRole('button', { name: 'Activar mi cuenta' }).click();
      await luciaPage.waitForURL(url => url.pathname === '/', { timeout: 30_000 });
      await expect(luciaPage.getByRole('region', { name: 'Mis equipos' })).toContainText('NB-0100');
      luciaSession = await luciaContext.storageState();
    } finally {
      await luciaContext.close();
    }

    // The same file again: everyone already exists, so nothing is created twice.
    await page.goto('/?view=team');
    await page.getByRole('button', { name: 'Importar clientes' }).click();
    await upload([header, ...good]);
    await panel.getByLabel('Crear las empresas que falten').check();
    await panel.getByRole('button', { name: 'Revisar archivo' }).click();
    await expect(panel.getByRole('status')).toContainText('0 de 3 filas listas');
  });

  test('pending invitation links show when they expire, and the expired ones are renewed together', async ({
    page,
  }) => {
    // Marta's link (from the import) is made to expire; nobody else's changes.
    const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 1 });
    try {
      await pool.query(
        `UPDATE invitations SET "expiresAt"='2026-01-01T00:00:00.000Z'
          WHERE "memberId"=(SELECT id FROM members WHERE email='marta.vega@example.test')`,
      );
    } finally {
      await pool.end();
    }
    await page.goto('/security');
    await page.getByLabel('Contraseña actual').fill(readRunState().password);
    await page.getByRole('button', { name: 'Verificar contraseña' }).click();
    await expect(page.getByText('Contraseña verificada para esta sesión.')).toBeVisible();
    await page.goto('/?view=team');
    await page
      .getByRole('combobox', { name: 'Filtrar personas por rol' })
      .selectOption({ label: 'Invitaciones pendientes' });
    const marta = page.locator('.access-table tr').filter({ hasText: 'marta.vega@example.test' });
    const pablo = page.locator('.access-table tr').filter({ hasText: 'pablo.diaz@example.test' });
    await expect(marta).toContainText('Enlace vencido');
    await expect(pablo).toContainText('Enlace vigente hasta el');
    await expect(page.locator('.access-table')).not.toContainText('lucia.rojas@example.test');

    const panel = page.getByRole('region', { name: 'Enlaces de invitación' });
    await expect(panel).toContainText('1 enlace vencido');
    await expectNoSeriousViolations(page, 'Enlaces de invitación');

    // Renewing all would break links that still work: it asks first, and «Cancelar» changes nothing.
    await panel.getByRole('button', { name: /^Renovar todos/ }).click();
    await expect(panel.getByRole('group', { name: 'Confirmar renovación de todos los enlaces' })).toContainText(
      '1 enlace vigente dejará de funcionar. ¿Renovar los 2?',
    );
    await panel.getByRole('button', { name: 'Cancelar' }).click();

    await panel.getByRole('button', { name: 'Renovar vencidos (1)' }).click();
    await expect(panel.getByText(/Se renovaron 1 enlaces/)).toBeVisible();
    const linksDownload = page.waitForEvent('download');
    await panel.getByRole('button', { name: 'Descargar enlaces (CSV)' }).click();
    let links = '';
    for await (const chunk of await (await linksDownload).createReadStream()) links += chunk.toString('utf8');
    const lines = links.trim().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(
      /^"Marta Vega";"marta.vega@example.test";"Minera Sur";"NB-0101";"http[^"]+\/login\?invite=[a-f0-9]{64}"/,
    );
    await expect(marta).toContainText('Enlace vigente hasta el');
  });

  test('a client completes the serial number of their equipment, and registers one when they have none', async ({
    browser,
  }) => {
    expect(luciaSession).toBeDefined();
    const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 1 });
    const lucia = `(SELECT id FROM members WHERE email='lucia.rojas@example.test')`;
    const context = await browser.newContext({ baseURL: BASE_URL, storageState: luciaSession });
    try {
      // Her notebook as if it had been registered before the serial number was required.
      await pool.query(`UPDATE "customerAssets" SET serial='', model='' WHERE "assetTag"='NB-0100'`);
      const page = await context.newPage();
      await page.goto('/');

      const card = page.getByRole('region', { name: 'Confirma tu equipo' });
      await expect(card).toContainText('Falta el número de serie de tu equipo');
      await expectNoSeriousViolations(page, 'Confirma tu equipo: completar serie');
      const form = card.getByRole('form', { name: 'Completar NB-0100 · Computador' });
      // Rosa's serial: refused without saying whose equipment has it.
      await form.getByLabel('N° de serie').fill('5cg 1234x');
      await form.getByRole('button', { name: 'Guardar serie' }).click();
      await expect(card.getByRole('alert')).toHaveText(/Esa serie ya está registrada en otro equipo/);
      await expect(card).not.toContainText('NB-0042');
      await form.getByLabel('N° de serie').fill('5cg-0100');
      await form.getByLabel('Marca y modelo (opcional)').fill('HP 440 G9');
      await form.getByRole('button', { name: 'Guardar serie' }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Datos del equipo guardados' })).toBeVisible();
      await expect(card).toHaveCount(0);
      await expect(page.getByRole('region', { name: 'Mis equipos' })).toContainText('HP 440 G9 · Serie 5CG-0100');
      const saved = await pool.query(`SELECT serial, model FROM "customerAssets" WHERE "assetTag"='NB-0100'`);
      expect(saved.rows[0]).toEqual({ serial: '5CG-0100', model: 'HP 440 G9' });

      // Without equipment (her notebook given up), she registers the one she uses.
      await pool.query(`UPDATE "customerAssets" SET archived=true WHERE "assignedContactMemberId"=${lucia}`);
      await page.reload();
      await expect(card).toContainText('Registra el equipo que usas');
      await expectNoSeriousViolations(page, 'Confirma tu equipo: registrar');
      await card.getByLabel('ID del equipo').fill('nb-0042');
      await card.getByLabel('Tipo de equipo').selectOption({ label: 'Computador' });
      await card.getByLabel('N° de serie').fill('5CG-0300');
      await card.getByRole('button', { name: 'Registrar mi equipo' }).click();
      await expect(card.getByRole('alert')).toHaveText(/El ID NB-0042 ya está registrado/);
      await expect(card).not.toContainText('Rosa');
      await card.getByLabel('ID del equipo').fill('nb-0300');
      await card.getByRole('button', { name: 'Registrar mi equipo' }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Equipo registrado' })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Mis equipos' })).toContainText('NB-0300');
      const owner = await pool.query(
        `SELECT m.email, a.serial FROM "customerAssets" a JOIN members m ON m.id=a."assignedContactMemberId" WHERE a."assetTag"='NB-0300'`,
      );
      expect(owner.rows[0]).toEqual({ email: 'lucia.rojas@example.test', serial: '5CG-0300' });

      // A client cannot write somebody else's equipment through the API.
      const rosaAsset = (await pool.query(`SELECT id FROM "customerAssets" WHERE "assetTag"='NB-0042'`)).rows[0].id;
      const forbidden = await page.request.patch(`/api/equipment/mine/${rosaAsset}`, {
        data: { serial: 'X-1' },
        headers: { Origin: new URL(page.url()).origin },
      });
      expect(forbidden.status()).toBe(404);
    } finally {
      await context.close();
      await pool.end();
    }
  });

  test('an admin hands a password reset link to someone who forgot their password', async ({ page, browser }) => {
    expect(luciaSession).toBeDefined();
    const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 1 });
    const oldContext = await browser.newContext({ baseURL: BASE_URL, storageState: luciaSession });
    const newContext = await browser.newContext({ baseURL: BASE_URL });
    try {
      // Her session works before the reset.
      const before = await oldContext.newPage();
      await before.goto('/');
      await expect(before.getByRole('region', { name: 'Mis equipos' })).toBeVisible();

      await page.goto('/?view=team');
      const row = page.locator('.access-table tbody tr').filter({ hasText: 'lucia.rojas@example.test' });
      const create = row.getByRole('button', { name: 'Crear enlace para nueva contraseña de Lucía Rojas' });
      await create.click();
      const box = page.getByRole('region', { name: 'Enlace para nueva contraseña' });
      await expect(box).toContainText('Nueva contraseña para lucia.rojas@example.test');
      const field = box.getByRole('textbox', { name: 'Enlace para nueva contraseña' });
      const first = await field.inputValue();
      expect(first).toMatch(/\/login\?reset=1&token=[a-f0-9]{64}$/);
      await expectNoSeriousViolations(page, 'Enlace para nueva contraseña');
      // The token is stored only as a hash.
      const token = new URL(first).searchParams.get('token')!;
      const clear = await pool.query(`SELECT 1 FROM "authVerification" WHERE strpos(identifier, $1) > 0`, [token]);
      expect(clear.rowCount).toBe(0);
      // A second link replaces the first one.
      await create.click();
      await expect(field).not.toHaveValue(first);
      const second = await field.inputValue();

      const lucia = await newContext.newPage();
      const password = `Lucia-nueva-${randomUUID()}`;
      const save = async (link: string) => {
        await lucia.goto(link);
        await expect(lucia.getByRole('heading', { name: 'Una nueva contraseña.' })).toBeVisible();
        await lucia.getByLabel('Contraseña', { exact: true }).fill(password);
        await lucia.getByLabel('Repite tu contraseña').fill(password);
        await lucia.getByRole('button', { name: 'Guardar contraseña' }).click();
      };
      await save(first);
      await expect(lucia.getByRole('alert').filter({ hasText: /reemplazado por otro/ })).toBeVisible();
      await save(second);
      await lucia.waitForURL(url => url.pathname === '/login' && !url.searchParams.has('token'));
      // Single use.
      await save(second);
      await expect(lucia.getByRole('alert').filter({ hasText: /ya se usó/ })).toBeVisible();

      // Every session she had open was closed.
      await before.goto('/');
      await expect(before).toHaveURL(/\/login/);

      // She signs in with the new password.
      await lucia.goto('/login');
      await lucia.getByLabel('Correo electrónico').fill('lucia.rojas@example.test');
      await lucia.getByLabel('Contraseña').fill(password);
      await lucia.getByRole('button', { name: 'Entrar a mi espacio' }).click();
      await lucia.waitForURL(url => url.pathname === '/', { timeout: 30_000 });
      await expect(lucia.getByRole('region', { name: 'Mis equipos' })).toBeVisible();

      const audit = await pool.query(
        `SELECT action FROM "securityAudit" WHERE "targetId"=(SELECT id FROM members WHERE email='lucia.rojas@example.test') ORDER BY "createdAt", action`,
      );
      expect(audit.rows.map(row => row.action)).toEqual([
        'member_permissions_changed',
        'member_permissions_changed',
        'other_sessions_revoked',
      ]);
      expect(
        (await pool.query(`SELECT 1 FROM "authVerification" WHERE identifier LIKE 'reset-password%'`)).rowCount,
      ).toBe(0);
    } finally {
      await oldContext.close();
      await newContext.close();
      await pool.end();
    }
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
        ['settings', 'Ajustes del espacio'],
        ['account', 'Configuración'],
      ]) {
        await page.goto(`/?view=${view}`);
        await expect(page.locator('main h1').first()).toBeVisible();
        await expect(page.locator('.loading')).toHaveCount(0);
        await expectNoSeriousViolations(page, `${screen} en modo oscuro`);
      }
    });
  });
});
