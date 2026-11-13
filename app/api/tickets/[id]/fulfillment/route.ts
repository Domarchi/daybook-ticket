import { z } from 'zod';
import { requireAccess, requireStaff } from '@/lib/access';
import { after } from 'next/server';
import { drainAutomationBestEffort } from '@/lib/automation';
import { drainOutboxBestEffort } from '@/lib/mail';
import {
  changeFulfillmentStage,
  deliverFulfillment,
  readFulfillment,
  reportFulfillmentDelay,
  setFulfillmentDate,
  startFulfillment,
} from '@/lib/fulfillment';
import { handle, json, parseBody, parseId } from '@/lib/server';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };

const date = z.string().max(10);
const version = z.number().int().min(0);
const note = z.string().max(500).nullable().optional();
const changeSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('stage'), expectedVersion: version, stage: z.string().max(20), reason: note }).strict(),
  z
    .object({
      action: z.literal('delay'),
      expectedVersion: version,
      reason: z.string().max(40),
      note,
      newExpectedOn: date,
    })
    .strict(),
  z.object({ action: z.literal('date'), expectedVersion: version, expectedOn: date }).strict(),
  z
    .object({
      action: z.literal('deliver'),
      expectedVersion: version,
      assetTag: z.string().max(200).nullable().optional(),
      kind: z.string().max(40).nullable().optional(),
      serial: z.string().max(120).nullable().optional(),
    })
    .strict(),
]);

/** The follow-up of a requirement and its history, for anyone who can open the ticket. */
export async function GET(request: Request, context: Context) {
  return handle(async () => {
    const access = await requireAccess(request),
      { id } = await context.params;
    return json(await readFulfillment(access, parseId(id)));
  });
}
/** "Seguir como requerimiento". */
export async function POST(request: Request, context: Context) {
  return handle(async () => {
    const access = requireStaff(await requireAccess(request)),
      { id } = await context.params;
    const body = await parseBody(request, z.object({ expectedOn: date.nullable().optional() }).strict());
    return json(await startFulfillment(access, parseId(id), body), 201);
  });
}
/** Stage, delay or first committed date. */
export async function PATCH(request: Request, context: Context) {
  return handle(async () => {
    const access = requireStaff(await requireAccess(request)),
      { id } = await context.params,
      ticketId = parseId(id);
    const body = await parseBody(request, changeSchema);
    if (body.action === 'stage') return json(await changeFulfillmentStage(access, ticketId, body));
    if (body.action === 'delay') return json(await reportFulfillmentDelay(access, ticketId, body));
    if (body.action === 'deliver') {
      const result = await deliverFulfillment(access, ticketId, body);
      // Solving the ticket may queue mail and automation, exactly as "Marcar solucionado" does.
      after(async () => {
        await Promise.allSettled([drainOutboxBestEffort(access.ownerId), drainAutomationBestEffort(access.ownerId)]);
      });
      return json(result);
    }
    return json(await setFulfillmentDate(access, ticketId, body));
  });
}
