import { daybookAuth } from '../../../../lib/daybook-auth';
import { getMailStatus } from '../../../../lib/mail';
const allowed = new Set(['sign-up/email', 'sign-in/email', 'sign-out', 'get-session', 'request-password-reset', 'reset-password', 'change-password']);
async function handler(request: Request) {
  const path = new URL(request.url).pathname.replace(/^\/api\/auth\//, '');
  if (!allowed.has(path) && !(request.method === 'GET' && /^reset-password\/[^/]+$/.test(path))) return Response.json({ error: 'Ruta no disponible.' }, { status: 404 });
  // Give the same result for every address when recovery mail is unavailable.
  if (path === 'request-password-reset' && !(await getMailStatus('')).configured) return Response.json({ error: 'La recuperación por correo aún no está configurada.' }, { status: 503 });
  if (Number(request.headers.get('content-length') || 0) > 100000) return new Response(null, { status: 413 });
  const response = await daybookAuth().handler(request);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
export const GET = handler;
export const POST = handler;
