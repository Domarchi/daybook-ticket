import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePrivateAttachmentSize, readAttachmentBytes } from '../lib/attachments-storage';

test('private chunked responses use authenticated metadata and preserve exact stream bounds', async () => {
  let calls = 0;
  const metadata = async () => {
    calls++;
    return { size: 3 };
  };
  assert.equal(await resolvePrivateAttachmentSize(3, metadata), 3);
  assert.equal(calls, 0);
  assert.equal(await resolvePrivateAttachmentSize(0, metadata), 3);
  assert.equal(calls, 1);
  const storage = {
    async read() {
      return {
        size: await resolvePrivateAttachmentSize(0, metadata),
        stream: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(Buffer.from('abc'));
            controller.close();
          },
        }),
      };
    },
    async remove() {},
  };
  assert.equal((await readAttachmentBytes(storage, 'fictitious-private-path', 3))?.toString(), 'abc');
  await assert.rejects(readAttachmentBytes(storage, 'fictitious-private-path', 2), /mismatch/);
});

test('missing or oversized metadata cannot disable the attachment limit', async () => {
  for (const size of [0, -1, NaN, 1.5, 10485761])
    await assert.rejects(
      resolvePrivateAttachmentSize(0, async () => ({ size })),
      /size invalid/,
    );
  await assert.rejects(
    resolvePrivateAttachmentSize(0, async () => {
      throw new Error('fictitious metadata unavailable');
    }),
    /unavailable/,
  );
});
