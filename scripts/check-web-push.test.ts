import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import test from 'node:test';
import { classifyPushFailure, isPushEndpoint, pushSubscriptionSchema } from '../lib/push-validation';

function subscription() {
  const curve = createECDH('prime256v1');
  curve.generateKeys();
  return {
    endpoint: 'https://fcm.googleapis.com/fcm/send/qa-only-capability',
    keys: { p256dh: curve.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') },
  };
}

test('only HTTPS browser push providers are accepted as delivery destinations', () => {
  for (const endpoint of [
    'https://fcm.googleapis.com/fcm/send/token',
    'https://updates.push.services.mozilla.com/wpush/v2/token',
    'https://web.push.apple.com/token',
    'https://wns2-bl2p.notify.windows.com/w/?token=example',
  ])
    assert.equal(isPushEndpoint(endpoint), true, endpoint);

  for (const endpoint of [
    'http://fcm.googleapis.com/fcm/send/token',
    'https://fcm.googleapis.com:444/token',
    'https://user:password@fcm.googleapis.com/token',
    'https://fcm.googleapis.com/token#fragment',
    'https://fcm.googleapis.com.evil.example/token',
    'https://evilfcm.googleapis.com/token',
    'https://fcm.googleapis.com@127.0.0.1/token',
    'https://127.0.0.1/token',
    'https://[::1]/token',
    'https://169.254.169.254/latest/meta-data',
    'https://10.0.0.1/token',
    'https://localhost/token',
    'https://api.daybook.example/token',
    'https://notify.windows.com.evil.example/token',
    'https://nested.host.notify.windows.com/token',
    'file:///etc/passwd',
    'data:text/plain,test',
    '/relative/path',
    `https://fcm.googleapis.com/${'x'.repeat(2048)}`,
  ])
    assert.equal(isPushEndpoint(endpoint), false, endpoint);
});

test('subscription keys must be canonical base64url and a valid uncompressed P-256 point', () => {
  const valid = subscription();
  assert.equal(pushSubscriptionSchema.safeParse(valid).success, true);
  assert.equal(pushSubscriptionSchema.safeParse({ ...valid, expirationTime: null }).success, true);
  for (const keys of [
    { ...valid.keys, p256dh: `${valid.keys.p256dh}=` },
    { ...valid.keys, p256dh: Buffer.alloc(65).toString('base64url') },
    { ...valid.keys, p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64)]).toString('base64url') },
    { ...valid.keys, auth: `${valid.keys.auth}==` },
    { ...valid.keys, auth: randomBytes(15).toString('base64url') },
    { ...valid.keys, auth: '/'.repeat(22) },
    { ...valid.keys, unknown: 'unexpected' },
  ])
    assert.equal(pushSubscriptionSchema.safeParse({ ...valid, keys }).success, false);
});

test('subscription input cannot supply an owner, recipient, or unexpected delivery metadata', () => {
  const valid = subscription();
  for (const additional of [
    { memberId: 'someone-else' },
    { ownerId: 'someone-else' },
    { active: true },
    { expirationTime: Infinity },
  ])
    assert.equal(pushSubscriptionSchema.safeParse({ ...valid, ...additional }).success, false);
});

test('provider failures expose only bounded classifications and distinguish expired endpoints', () => {
  for (const statusCode of [404, 410])
    assert.equal(classifyPushFailure({ statusCode, body: 'private-capability' }), 'expired_subscription');
  for (const error of [
    undefined,
    new Error('secret endpoint'),
    { statusCode: 408 },
    { statusCode: 429 },
    { statusCode: 500 },
    { statusCode: 503 },
  ]) {
    assert.equal(classifyPushFailure(error), 'provider_unavailable');
  }
  for (const statusCode of [400, 401, 403, 413])
    assert.equal(classifyPushFailure({ statusCode, body: 'private-capability' }), 'provider_rejected');
});
