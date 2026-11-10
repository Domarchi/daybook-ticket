import { daybookAuth } from '../../../../lib/daybook-auth';
import { getMailStatus } from '../../../../lib/mail';
import { publicAuthResponse } from '@/lib/security-model';
const allowed = new Set([
  'sign-up/email',
  'sign-in/email',
  'sign-out',
  'get-session',
  'request-password-reset',
  'reset-password',
  'change-password',
  'two-factor/enable',
  'two-factor/disable',
  'two-factor/verify-totp',
  'two-factor/verify-backup-code',
  'two-factor/generate-backup-codes',
]);
async function handler(request: Request) {
  const path = new URL(request.url).pathname.replace(/^\/api\/auth\//, '');
  if (!allowed.has(path) && !(request.method === 'GET' && /^reset-password\/[^/]+$/.test(path)))
    return Response.json({ error: 'Ruta no disponible.' }, { status: 404 });
  // Give the same result for every address when recovery mail is unavailable.
  if (path === 'request-password-reset' && !(await getMailStatus('')).configured)
    return Response.json({ error: 'La recuperación por correo aún no está configurada.' }, { status: 503 });
  if (Number(request.headers.get('content-length') || 0) > 100000) return new Response(null, { status: 413 });
  const response = await daybookAuth().handler(request);
  response.headers.set('Cache-Control', 'no-store');
  if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
    const data = await response.json();
    response.headers.delete('Content-Length');
    return new Response(JSON.stringify(publicAuthResponse(data)), {
      status: response.status,
      headers: response.headers,
    });
  }
  return response;
}
export const GET = handler;
export const POST = handler;
