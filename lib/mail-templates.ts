import type { NotificationEvent } from './mail';
import { REMINDER_REASON_LABELS } from './reminders-policy';
import { ESCALATION_LABELS } from './escalation-policy';

export type MailEnvironment = 'production' | 'qa';
export interface MailPayload {
  from: string; to: string[]; subject: string; text: string;
  html?: string;
  reply_to?: string;
  attachments?: { filename: string; content: string; content_type: string; content_id: string }[];
  tags?: { name: string; value: string }[];
}
export interface MailMetadata { subject?: string; status?: string; priority?: string; dueAt?: string | null; reasons?: string[] }

/** A byte-for-byte copy of public/icons/daybook-192.png, embedded so serverless
 * sends never depend on a public image endpoint or an untraced filesystem file. */
const LOGO_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAMAAAADACAYAAABS3GwHAAAACXBIWXMAAAsTAAALEwEAmpwYAAAT70lEQVR4nO1de3ROV/o+9Lz7OztBWq1rXIaQKImsIrQu01nVmd5QWqV1q8vgp9Vqqy3q2k6LoizjVndiTCmKMS5FEUFKXFKMSyIIQVGhzj+jXcv+rX0kZMj9O9959/nOu9d6/sof2fvZz/OdfXnfd2uaOu0hxlh9xvgrOjOG6owvBMZ368w4rANPB2ZkAeO3gHFBUJqDW3Ku5JzJubszh3yBnFM5t4yxx+VcY4tNiebz+WoDhPTTGf8WmHFNgckjMEc4MAH4Fp0ZQwBCGmuaVlrzSjMMo6YcuA78FAmODAeMCx34OQA+njEWqQVpAwCjBzC+h0RPooeCOdgNYHTXNE3XgqAxKXwdeCoJn4QPxeBAB35GZ3yQpmlcc2ErBeDrDWBcJOGT8MEPDnQwMgGMN6WmNDc0gNCGwPguEj4JH+zlIBEgNEZTuPkA+CRg/HcSP4kfAsPBbwD8S7m01lQ72QFmJJHwSfjgCAfGfp/PF6Gp0Bjj7bMvqegMnTgQDnLwK4DRGVX8AHwMTToZHxA50JkxEkP7DwEzZpL4SfygAgdgTHfyNtmng7ECfdAE4oDl/hLw5U5sjkvfidsh8okDrhwHOhirAxpoB2BMxR4kgTiAAjkwZgVI/PxTEh+JD1zAgc6MEbaKnzHeEXtQBOIAis7BbZl7YIv45YUDMOMGCZAECK7iwLju8/lq+a1/eeuGPxgCccBLYoJ9fp0MZcf2EPnEgXAtB3dih0oi/tBoK/gIewAE4oD5xcHvMkK5uPovBYzvIPGR+CA4OEgsVj6BlcyC32kCcSBs4wCMbsUJdbhA5JMBIYg40ME4X6QNsa7zAdidJRAHEAgOIKRvoasfHfhpEiAJEIKQA1msq8BqE9mlS9A7SiAOAGMvQGmNJDwIfg525Sl+xlhdGUOhQAcJxIEIJAd5VqAD4H8j4sl84AUOgI+5X/+lZCUu9I4RiAMWeA5kXdr/uRgDCIkl8ZH4wEscQGiDuwbQGX8PvUME4oA5x4Hu4wPvGQCMtSRAEiB4iAMdjFW5S5xcx+4QgTgARzkwrlsJ9PJZIhIfiQ88yAFjrJ7M930FuyMFwbyeGZT49do5cf7MMZGemiKOpiSJvXu2icQdm8T6dSvEyuXxYvJX48QH778rOnd6TbRo0UJUr15T+IxQ9PmAIAJj/GVNZ8Yw7I540QAlwbXLZ0TK/kSxcP4s8d67b4unn/6jeKR8BfQ5ApdCZ8bH8gRoEXZHyAD+fUkO7Nsh5s2ZLnr27CGqhVdHnzNwCXTG52vWwwMKdCY/YP/quhH7924Xn382SrRq1YqWTaxAfSXIJdBRbJGTAQJnhlOpKWLqlAkiLi4OfS5BMejM+EnTgZ/F7ggZwLkvw4eDB4mKlSqjzysoAJn7oqn+QDX2ciIYcflimpgza6po1qwp+vziwrgq9wC38DtCBsAyw9bv14o2bV5Cn2ck/FdToBNkAAW+Ct9vWC2aN2+OPt9OgwyggPhUwrKlC0VkVD10YZIBsknAFoQXkXXlrJg0cax4+JHH0AVKXwAFBOFVHE1JEn/609PoIqUlkAJi8PJN86SJY0VYWHl0sQYCtAdQQGRuwMHkBBEbG4suWDKAAmLwKi5fSBXdu3VBFy19ARQQg5cxaeJYYfAy6OKlJZACYvAqVq34R1CcEtEeQAExuRUJ2zaKylWqoos4qA3gdpR/tKKoULGSqFM30rppbdeurZXMMn3qV2LzxtXWuhpbyKafAXYyWw2b55KCDIA8ATykrGjSpIkY9M5bYt3a5eKXn0+ji9osJmSWWvVqNdDFTAYIAsgUxx49uomN61dZZ/DY4jaLiOQfd7hyOURfAIUhY3ImTvjCCl/GFrhZxD1B2MOPovNGBggyVKkabqU4umF5tPyfC111REpfABfh8foNxIZ/r0QXuVkIPh0zHJ0rMkCQgvlCrD3CxXPH0YVu5oObWefFq692QOeqKKAvgEtRu3YdK5sLW+xmPpAGlUe/2DyRAYL8CHXK5PHoYjfzwQ+b/6X8foC+AEEAebEmlx3YgjfzwLAhH6LzQwbwALq80Vlcv3oWXfBmHuUcGzSIQecnP9AXIIggC+ne+CUDXfRmHgn3cvOOzQ8ZwAPo0b2rksuhLm90RueGDOARjBwxBF3w5n04eWy/kmmVtAQKQsjlRvzC2eiiN+/D4A8GoXNDBvAIZLLK4YO70UVv5kJG+lHlkmiU/wLIqsZuQkxMjKhR4w9KTLTMP1BtU/z+oIHovLjKANgT5m+BqT2JW8Ss6ZNF/359RN3IKMf5GzP6E3QezFxIO3lIhJYph64rMgCSALZtWScG9O/r2NNGIaFlrbfHsIVv5sLrnTuhC58MgCyCM2mHxcC3+jvyaxgd3dC6kMIes5mNLZvWoAufDKAI5Ea12ZPN8p2gqhXKWPB3okeNHIo+VjMXpCmxxS9BewAFxCBDGEZ8MiTP97zG9w4X43uF+z3RZcqGWdXdsMdqZkPuTbDFTwZQDPPnzrAiPHMmJ7p2OXFsdpQ4PidKxEaE+T3ZstCtKrfEx47sVSI8gr4AimHxwq+tjaucnIWDa4iTc6MsLPnIntIj8jlV7DGa2VDhiSYygIKYOW2K+HOj8nfFn4NnGz1iS36xvJDCHqN5PVOMGP4xGaCwCcOeJBRkZYikaY0eMMCmz2sLzv1fNvTq9Sb+GK9nip3bN5EByAAPCuPn/TMeEH8Ouj3r//2BXHvLEGUT2QByP1KpchVaAtEXIJcorqaKtCVP5muApMl1Rfkw/78C9etHiyuXTqGboG3bNmQAMsA9QVxIHJ2v+HPw0Wv2/GoO6N8X3QBjvxhDBiAD3BHDjYsHReqChoUa4PDMSFGzcllblkIrl8d7+laYToEUwrlNAwoVfw6m9K9miwCqVA0XRw7tQS2fgnkfQAZQBFnpW8XJufWKbIATc6JEXL2HbRFBnbqR4lRqCtrYa0fUJQPkNznYwrQNWQX//czqjkUWfw6WD/uDYD57fgnj4uLQqs299MLzZICgN0ABuHLkn8UWfw5ebGpfNeaGDRtaIQpOj19uxmkJ5FED3Lx2VqQve6bEBvhhXIQIDbFvDV29Wg3rgspJDsaN/ZQM4FUDXNo7pcTiz8Ffn69oq4BCQsuKDwcPcqwc+9L4eWQALxrg18snRNriJn4bIHlqpKhQ/sFQan8RGxtrvWMWaB7kazi0BPKgATK3D/Vb/DkY2TVwzxPFxcWJubOnBezJpn1J28kAXjPAjfP7ROr8BrYZ4D9fR4o61coFvCT7wLf6i/XrVthahzTtxEEygNcMkLG+j23iz8HMgc691BgWVl40bRonevbsYW1iF8ybKVYsW2wtZ2QSfnGwcR0tgTxlgGtpG2wXfw5aRvufMwAeAt0EO26A8+LMqnYBM8CaUbWFz6bLMfAAyAAOG+DyTwsDJv4cdGiJX5UOXAIygIPiv/lLuji1tFXADZA4qY4oV8b+Y1EIQpABHDXAaZG+9I8BN8DOiWQAIAOougRaFHADtG9BSyAgA6gK2gSDAksfWgIhmiArfXOxYv+Lgyfr25MjAB4B7QGQTJCxIe+LsDMr24rzW98XqQtiiy3+GW9XRxcUuAxkACQD3MhMtqo/nP6uvRUTdOVwvLhxMUVcS9so0uKblSgUIiJcnbr74FUDTJ/6la3AX7M7hKwMcSlpQonjg0Z0CVwwHOQB+QKOrGrdu3cP8eX4v4lFC2aJld8uKVEoRMdXXwkeA6ALyYXIytglTq/qUOJ1f/LUugEJh4Y8cocHvfOWJXI7n1568fnnyABexdUTa8TJefX92vj2sTkhBu5Dy5YtrfIpgaosXatWBBnAq1AtJRJy4YknnhBbv18b0PFnng2ysijYgnIjrh75psQGeMHGpHi4LyXSiWeVZMYZlvjJAArhzOrXUMuiQDaqV68pdu/c7Ni4x34+OrgMYDewhelUfSDMwliQKwf4+NF9jvLRps1LZABPGcCm0oiT+9lTGhGyIbO7Lp0/4eh4ZY5xxUqVyQBkgDuCuHHxUJGL49awoTguZEM+4J2OUBox4YcN6CsMWgIphgs7xxRqgA872verWbVqNXE0JQllrMOH0RNJ3tsDFOGBjFPxgX8g42559G+XoI1VLrvoC0AGeEAYPx+Yma8Burb2/4kkFR7IOJqSRM+kFmWSsH+RUZCVIfbk80ieYdjz64/9RNLoUcPQf/1pD6AoZBCgfBL1fgO0fsKekicqPJJXv340uvjJAApCRlXmvBa/4IN7D2XH2/RQtgrPpG5a/x268MkACmLG3ycLn3EvqrNBrXLi2OwocXxOlIiNCLNlwuWzpGdPHUEdZ6dOHdGFTwZQCLLO5ohPhvyP+HMwvle4GNcr3LYJnzdnOupY004cFKFl1EncoXsAZPH/dGCXaNasab4TVLVCGQt2TPazrVsHLKTZLCJkPgG26MkACvzqy2WIjLgsU9aepU1hkP/nYHIC6pgz0o9amWTYoicDIAlA/vrK+Pr+/fo4LoRRI4eim/79QQPRBU8GcHDCs66ctUKLZ06bIvr17W2lFGJMcnR0Q0di+80CcOzwj4597VxlgJdfbldgwvSBfQmuQvKP28WPu7dawi8sGVye95d/NLDpjDK5ZVfC9+i//q937oQuduUM8Pxzf3bsITbVTn0+/2yUI6chn44Zjj7eTeu/UyLsQSkDPPeXv4irl9LRJ8dpyD2AfHPLCY6bN29ua/UGswSQP3Cq3PoqY4DWzzyDGoeCgRP/SbaWAU79EspN9pFDe9DH/dHg99BFrpQBWrRoIX7OPIk+MU5GPb7z9v+JsmWdq9kpTbZk0RwlvnYGt+cOIygMIMXvdNod1hpfxtm3b98uz9vdQGPM6E/QObiQcULUjqiLLnBlDCDL6ElSsCcmkEeecrP37sABIjwcr0itvGNQ4b6jQ4eX0cWtjAGaNGkizp85hj4xduLiueNWSPHECV9YlQ1UuOF84/VOAXvM2iwGRgzHT3VUxgBVqoaLtau/KXbBVGxs+PdKsW7tcrE0fp6Y8/XfrZvUvn17iZdefMFKIlftWK9b1zdsfbzaLCH+sXguyrJPWQMQAs+BjCnCDnIzs6s8yAe03TTnZAAXQ16kzZk1FV345vVMsXfPNivXAJsTMoBHIE9Ytm1Zhy5883qmOJS8U1RD3PiTATwEufeQj1Kocpy8d88214pfgpZALkKDBjHWUSu26M1sJGzbKCpXcfZlGjKAB1GzZi0rclSFUx4zG/LBjLCH7S/NTgZQgBRVEFXvceueQbW4qUkTx7rqqLMg0BJIMTxWoaLo0+dNsWXTGiWONs1ckDFcqsb1kwFcCpmwIpPiP3jvHevyTYZUYAvdzAP7924XMTEx6HyRAVyGRx+rICpUrCQio+pZj83JADkpdpkm+cPmfym3vDHvgwytGD/uM1GunD1V6VSD8ksgbAF4GSn7Ey3TYmuADKCAGLyEK5dOWQFtTuYwkAHoC6DEcid+4WwRUQenegV9AWgJhCL8m1nnrQSexo0bowsSYwl0C7sTBQH7VzHYsW7tcitfA3uekfBfDZhxTYGOkAEcFL2sxiFzHBo1aoQ+v7gwrmo68LP4HSEDOBW1KXMH3B6/AzZBB35a05lxBLsjZIDAliOfOmWCVSMIey5BMejM+EnuARKxO0IGsPckR6Z0yspzrVq1Ui51E9RCgqYzvkiBjuQL7E2i6pCV3/Ylbbcyw3p072q9+4s9Z+AS6IzPl0ugYdgdIQMUvczggX07xPy5M6xiW/IXPhhCkgHNAMbHGmO8A3ZHvGgA+cstS8WknTxkVY9L2rVV7Ny+yTqWXLFssRVyLOvpd+z4injqqadE9Wo1aDnD7NUWY7ydxhirjy1yAnEACBwwxuppmqY9BMzIIhGSCMFTHBjXNE0rLQ2g6WCswe8QgTjgjnGgg7HSEr9lAMYHEflkQPAQB7qPv33XAAChDbE7RCAOwEEOGGOP3zWApmml5LUwiZBECB7gQAeeJjWf2wAaAP8Mu2ME4gCcMAAzRmn3N5/PVwcYv00iJBFCcHNw2+fzRTxgAOsrwPgeBTpIIA5EADlIzFP8d5ZBRncinwwIwcwBGF3zNYC8FJMbBPROEogDZj8HOvBT8tS/IANous77kwBJgBCMHICvT4Hiz9kP62BkoneWQBwwW3/9MzRNY0UxgAbg60kCJAFCMHEARhetGK0UAN+O3mkCccBs4WDnAxdfhX8FQhsA47+RCEmE4G4OfgcIjSmW+O+ZgH+pwAAIxIEoMQfAx5ZI/Hc9QJdjZEDmVg6MvUXe+ObXDMOooXrxLAJxAA+KP8vn89XS7GiM8bYUJ0QiA/dwcJsx3l6zs+nMGKnAwAjEgSiMA50ZQ7RANABjCk0AmRCU5sCYoQWwldYZX4Y/SAJxwPP45eff3E10D2BjOuPLaQLIhKCe+P078SnmTfEk7EETiAOQHIAxzYlf/geazowRdDpEIgQ8Dm7rzBiqYTZZXo7uCcgE4DgHxg3GeEdNhXbnsozSKWlJxp0Sf7LP56utKdZYduwQBdDRF0EEiIPfsmN7QFO1McYiAfgWEgEti8BeDhIAQqM1l7RSMsFeB36OjEBGAD8zubIT2YsXz69IAwCjhw78JBmBjADFE/5pWbNWbjG1IGg6gNENGN9Fx6ZkBMifA1mYLTH7F/8hLRibPDGSwUo68FT6KpAZ4O4yh4+X1Qk1LzV5lAUQ0k9n/Ftgxi9kCM8Y4qY8KJE/hAAhjd26vre7lZZP1sg4busLwfh8+TnUmZGiA0/Pvmy7pcDkEViBHNyScyXnTM7dnTnk8+SDdHJuGWNRKGEL+bT/B1N0Z2dUApdOAAAAAElFTkSuQmCC';
const LOGO_CID = 'daybook-brand-v2';
/** Local brand bytes for private PDFs; no external images or protected-preview URLs. */
export function daybookLogoPng() { return Buffer.from(LOGO_PNG_BASE64,'base64'); }
const FOOTER = 'Responde desde el portal. Las respuestas a este correo no se incorporan al ticket.';
const STATUS_LABELS: Record<string, string> = { open: 'Abierto', pending: 'Pendiente', resolved: 'Resuelto', closed: 'Cerrado' };
const PRIORITY_LABELS: Record<string, string> = { low: 'Baja', normal: 'Normal', medium: 'Media', high: 'Alta', urgent: 'Urgente' };

export function notificationEnvironment(): MailEnvironment {
  const explicit = process.env.DAYBOOK_NOTIFICATION_ENVIRONMENT;
  if (explicit === 'production' || explicit === 'qa') return explicit;
  return process.env.VERCEL_ENV === 'production' ? 'production' : 'qa';
}

export function escapeMailHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

/** Only public ticket metadata is accepted. Message excerpts, filenames and
 * internal notes have no field in this contract. Reminder reasons must match
 * the server's fixed labels, even if another caller provides extra properties. */
export function buildMailPayload(input: {
  id: string; environment: MailEnvironment; event: NotificationEvent;
  ticketId: number | null; from: string; to: string; url: string; metadata?: MailMetadata; replyTo?: string;
}): MailPayload {
  const ticket = input.ticketId ? `Ticket #${input.ticketId}` : 'Daybook Ticket';
  const copy: Record<NotificationEvent, { heading: string; body: string; action: string }> = {
    ticket_created: { heading: 'Un nuevo ticket te espera', body: `${ticket} fue creado. Consulta su estado y continúa la atención desde el portal.`, action: 'Ver ticket' },
    agent_replied: { heading: 'Tienes una nueva respuesta', body: `El equipo de soporte respondió en ${ticket.toLowerCase()}. Entra al portal para leer y continuar la conversación.`, action: 'Ver respuesta' },
    client_replied: { heading: 'El cliente respondió', body: `${ticket} tiene una nueva respuesta del cliente. Entra al portal para continuar la atención.`, action: 'Ver ticket' },
    invitation: { heading: 'Bienvenido a Daybook Ticket', body: 'Tu acceso está listo. Activa tu cuenta con este mismo correo para comunicarte con nuestro equipo de soporte.', action: 'Activar mi cuenta' },
    password_reset: { heading: 'Elige una nueva contraseña', body: 'Solicitaste restablecer tu contraseña. Usa este enlace para elegir una nueva. Si no lo solicitaste, puedes ignorar este correo.', action: 'Restablecer contraseña' },
    reminder: { heading: 'Este ticket requiere atención', body: `${ticket} tiene atención pendiente. Revisa la conversación y sus plazos en el portal.`, action: 'Revisar ticket' },
    escalation: { heading: 'Este ticket necesita apoyo', body: `${ticket} fue escalado al equipo. Revisa su atención y su plazo para continuar la conversación a tiempo.`, action: 'Revisar ticket' },
    service_due: { heading: 'Un vencimiento requiere revisión', body: 'Un equipo o contrato requiere atención. Consulta la fecha y los detalles en la ficha privada del servicio.', action: 'Revisar servicio' },
    satisfaction_requested: { heading: '¿Cómo fue la atención?', body: `${ticket} fue resuelto. Tu opinión nos ayuda a mejorar: califica la atención desde tu portal.`, action: 'Calificar atención' },
  };
  const message = copy[input.event];
  const replyTo = input.replyTo && /^[^\s<>@\r\n]+@[^\s<>@\r\n]+\.[^\s<>@\r\n]+$/.test(input.replyTo) ? input.replyTo : null;
  const footer = replyTo ? 'Puedes responder a este correo desde tu dirección registrada con hasta 5 archivos de 10 MiB cada uno. También puedes enviarlos desde el portal.' : FOOTER;
  const metadata: [string, string][] = [];
  if (input.ticketId) metadata.push(['Ticket', `#${input.ticketId}`]);
  if (input.event !== 'service_due' && input.metadata?.subject) metadata.push(['Asunto', input.metadata.subject.replace(/[\r\n\t]+/g, ' ').slice(0, 160)]);
  if (input.event !== 'service_due' && input.metadata?.status && STATUS_LABELS[input.metadata.status]) metadata.push(['Estado', STATUS_LABELS[input.metadata.status]]);
  if (input.event !== 'service_due' && input.metadata?.priority && PRIORITY_LABELS[input.metadata.priority]) metadata.push(['Prioridad', PRIORITY_LABELS[input.metadata.priority]]);
  if (input.event !== 'service_due' && input.metadata?.dueAt && Number.isFinite(Date.parse(input.metadata.dueAt))) {
    metadata.push(['Vencimiento', new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(input.metadata.dueAt))]);
  }
  if ((input.event === 'reminder' || input.event === 'escalation') && input.metadata?.reasons) {
    const allowed = Object.values(input.event === 'reminder' ? REMINDER_REASON_LABELS : ESCALATION_LABELS);
    for (const reason of [...new Set(input.metadata.reasons)].filter(reason => allowed.includes(reason)).slice(0, allowed.length)) metadata.push(['Motivo', reason]);
  }
  const safeUrl = escapeMailHtml(input.url);
  const rows = metadata.map(([label, value]) => `<tr><td style="padding:6px 12px 6px 0;color:#69675f;font-size:14px;vertical-align:top">${escapeMailHtml(label)}</td><td style="padding:6px 0;color:#11120f;font-size:14px;font-weight:600">${escapeMailHtml(value)}</td></tr>`).join('');
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeMailHtml(message.heading)}</title></head><body style="margin:0;padding:0;background-color:#f7f8f9;color:#11120f;font-family:Arial,Helvetica,sans-serif"><div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${escapeMailHtml(message.body)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f7f8f9"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #d9dbdc;border-radius:16px;overflow:hidden"><tr><td bgcolor="#11120f" style="padding:24px;background-color:#11120f"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="60" style="vertical-align:middle"><img src="cid:${LOGO_CID}" width="48" height="48" alt="" style="display:block;border:0;width:48px;height:48px"></td><td style="vertical-align:middle;color:#ffffff;font-size:23px;font-weight:700;letter-spacing:2px">DAYBOOK<br><span style="font-size:12px;letter-spacing:3px;color:#efc56e">TICKET</span></td></tr></table></td></tr><tr><td style="padding:32px 24px"><p style="margin:0 0 12px;color:#805a0e;font-size:12px;font-weight:700;letter-spacing:1px">TU SOPORTE, CONECTADO</p><h1 style="margin:0 0 16px;color:#11120f;font-size:25px;line-height:1.25">${escapeMailHtml(message.heading)}</h1><p style="margin:0 0 24px;color:#45463f;font-size:16px;line-height:1.6">${escapeMailHtml(message.body)}</p>${rows ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px">${rows}</table>` : ''}<table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="#efc56e" style="border-radius:8px;background-color:#efc56e"><a href="${safeUrl}" style="display:inline-block;padding:14px 24px;border:1px solid #efc56e;border-radius:8px;color:#11120f;font-size:16px;font-weight:700;text-decoration:none;line-height:20px">${escapeMailHtml(message.action)}</a></td></tr></table><p style="margin:24px 0 0;color:#69675f;font-size:12px;line-height:1.6">Si el botón no funciona, abre este enlace:<br><a href="${safeUrl}" style="color:#805a0e;word-break:break-all">${safeUrl}</a></p></td></tr><tr><td style="padding:20px 24px;border-top:1px solid #d9dbdc;background-color:#fafaf9;color:#69675f;font-size:12px;line-height:1.6">${escapeMailHtml(footer)}<br><strong style="color:#45463f">Daybook Ticket</strong> · Un servicio Daybook</td></tr></table></td></tr></table></body></html>`;
  return {
    from: input.from, to: [input.to],
    subject: input.event === 'invitation' ? 'Tu acceso a Daybook Ticket'
      : input.event === 'password_reset' ? 'Restablecer contraseña · Daybook Ticket'
        : input.event === 'reminder' ? `${ticket} requiere atención · Daybook Ticket` : `${ticket} · Daybook Ticket`,
    text: `${message.heading}\n\n${message.body}${metadata.length ? `\n\n${metadata.map(([key, value]) => `${key}: ${value}`).join('\n')}` : ''}\n\n${message.action}: ${input.url}\n\n${footer}\nDaybook Ticket · Un servicio Daybook`,
    html,
    ...(replyTo ? { reply_to: replyTo } : {}),
    attachments: [{ filename: 'daybook.png', content: LOGO_PNG_BASE64, content_type: 'image/png', content_id: LOGO_CID }],
    tags: [{ name: 'app', value: 'daybook_ticket' }, { name: 'environment', value: input.environment }, { name: 'outbox_id', value: input.id }],
  };
}

/** Validation does not normalize or rebuild frozen legacy payloads. Callers send
 * the original payloadJson string, retaining its exact bytes on every retry. */
export function readFrozenMailPayload(text: string): MailPayload | null {
  try {
    const data = JSON.parse(text) as MailPayload;
    if (!data || typeof data !== 'object' || typeof data.from !== 'string' || typeof data.subject !== 'string' || typeof data.text !== 'string'
      || !Array.isArray(data.to) || data.to.length !== 1 || typeof data.to[0] !== 'string') return null;
    return data;
  } catch { return null; }
}
