/** Safe, local review artifact. Real sends retain CID; only the preview uses a data URL. */
import { mkdir, writeFile } from 'node:fs/promises';
import { buildMailPayload } from '../lib/mail-templates.ts';
const output = 'outputs/mail-preview';
await mkdir(output, { recursive: true });
const events = [
  'ticket_created',
  'agent_replied',
  'client_replied',
  'reminder',
  'escalation',
  'satisfaction_requested',
  'invitation',
  'password_reset',
];
for (const event of events) {
  const payload = buildMailPayload({
    id: '00000000-0000-4000-8000-000000000123',
    environment: 'qa',
    event,
    ticketId: ['invitation', 'password_reset'].includes(event) ? null : 123,
    from: 'Daybook QA <notifications@example.test>',
    to: 'cliente@example.test',
    url: 'https://daybook-ticket.example.test/',
    metadata: {
      subject: 'No puedo acceder al sistema de facturación',
      status: event === 'satisfaction_requested' ? 'resolved' : 'open',
      priority: 'high',
      dueAt: '2026-11-05T16:00:00.000Z',
      reasons: ['El ticket está vencido'],
    },
  });
  const logo = payload.attachments[0];
  await writeFile(
    `${output}/${event}.html`,
    payload.html.replace(`cid:${logo.content_id}`, `data:image/png;base64,${logo.content}`),
  );
  await writeFile(`${output}/${event}.txt`, payload.text);
}
await writeFile(
  `${output}/index.html`,
  '<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Daybook · revisión de correos</title><body style="font:16px system-ui;padding:32px;background:#f7f8f9;color:#11120f"><h1>Correos de Daybook Ticket</h1><p>Vista previa con datos ficticios. No se ha enviado ningún correo.</p><ul>' +
    events.map(event => `<li style="margin:16px 0"><a href="${event}.html">${event}</a></li>`).join('') +
    '</ul></body></html>',
);
console.log(`Eight HTML/text previews created in ${output}; no network requests or delivery.`);
