/** Explicit, read-only security probe against an already provisioned QA Function.
 * Run ONLY after confirming QA identity through Neon get_function metadata:
 * DAYBOOK_PINGER_QA_NATIVE_URL=https://<QA-native-host>/tick node scripts/check-pinger-edge.mjs
 * It intentionally uses forged public headers and must NEVER start the worker.
 */
import assert from 'node:assert/strict';
const target = new URL(process.env.DAYBOOK_PINGER_QA_NATIVE_URL || '');
assert.equal(process.env.DAYBOOK_QA_ALLOW_PINGER_EDGE_TEST, '1', 'Confirma explícitamente el host QA antes de probarlo.');
assert.equal(target.protocol, 'https:');
assert.ok(target.hostname.includes('.compute.') && target.hostname.endsWith('.aws.neon.tech'), 'Solo el host nativo Neon.');
assert.equal(target.pathname, '/tick');
assert.equal(target.search, '');
const fake = `qa-forged-${Date.now()}`;
const expectedTriggerId = process.env.DAYBOOK_PINGER_QA_EXPECTED_TRIGGER_ID;
assert.ok(expectedTriggerId, 'Usa el trigger.id QA real para demostrar que el rechazo depende del proxy y no de un ID incorrecto.');
for (const headers of [{}, { 'x-neon-trigger-invocation-id': fake }]) {
  const response = await fetch(target, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ version: 1, invocation_id: fake, trigger: { id: expectedTriggerId, name: 'security-probe', type: 'schedule' }, data: { scheduled_at: new Date().toISOString() } }),
    signal: AbortSignal.timeout(10_000) });
  await response.body?.cancel();
  assert.ok([401, 403].includes(response.status), 'Una solicitud pública, incluso con ID real y header reservado falsificado, debe ser rechazada por procedencia.');
}
console.log('Proxy nativo QA rechazó solicitudes anónimas y encabezados reservados falsificados.');
