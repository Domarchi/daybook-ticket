// POST /api/assistant/tickets/:id/recap — feature 4: Bita recaps a long ticket for whoever picks it up halfway.
//
// The recap is shown inside the ticket, to the team only; nothing is written. Order of checks, cheapest first:
//   1. flag off, or not owner/admin of the main space → 404 (`requireAssistantAccess`; a foreign origin is 403)
//   2. no key configured → 503
//   3. the ticket must be readable by this person → 404 (read before any quota is spent)
//   4. rules before AI: a short ticket gets a notice, no model call and no quota
//   5. daily quota per person, shared with the chat and the draft → 429 (atomic; fails closed with 503)
//   6. only then one call to the Anthropic API
//
// The log records outcome, message count and tokens, never text.
import { requireAssistantAccess } from '@/lib/assistant-access';
import { AgentError, classifyFailure, createClient } from '@/lib/assistant-agent';
import { assistantDailyLimit, assistantHasKey, assistantModel } from '@/lib/assistant-config';
import { readRecap } from '@/lib/assistant-data';
import { serviceDay } from '@/lib/assistant-desk';
import { recapNotNeeded, writeRecap } from '@/lib/assistant-recap';
import { refundMessage, reserveMessage } from '@/lib/assistant-quota';
import { describeError, logEvent } from '@/lib/log';
import { ApiError, handle, json, parseId } from '@/lib/server';

export const dynamic = 'force-dynamic';
// One call of at most 25 s.
export const maxDuration = 30;

export async function POST(request: Request, context: RouteContext<'/api/assistant/tickets/[id]/recap'>) {
  return handle(async () => {
    const access = await requireAssistantAccess(request);
    if (!assistantHasKey()) throw new ApiError(503, 'Bita no está configurada.');
    const id = parseId((await context.params).id);
    const now = Date.now();
    const data = await readRecap(access, id, now);
    const limit = assistantDailyLimit();

    const skip = recapNotNeeded(data.mensajes_totales);
    if (skip) return json({ recap: null, notice: skip, remaining: null, limit });

    const day = serviceDay(now);
    let reservation;
    try {
      reservation = await reserveMessage(access.userId, day, limit);
    } catch (failure) {
      logEvent('error', 'assistant_quota_unavailable', describeError(failure));
      throw new ApiError(503, 'Bita no está disponible por ahora.');
    }
    if (!reservation.allowed)
      return json({ error: `Llegaste al límite de ${limit} mensajes de hoy. Mañana vuelve a estar disponible.` }, 429);
    const remaining = Math.max(0, limit - reservation.used);

    try {
      const result = await writeRecap({ client: createClient(), model: assistantModel(), data, now });
      logEvent('info', 'assistant_recap', {
        outcome: result.outcome,
        messages: data.mensajes_totales,
        inputTokens: result.inputTokens,
        cachedTokens: result.cachedTokens,
        outputTokens: result.outputTokens,
      });
      if (result.outcome === 'refusal' || result.outcome === 'empty')
        return json({ recap: null, notice: result.text, remaining, limit });
      return json({ recap: result.text, cut: result.outcome === 'cut', remaining, limit });
    } catch (failure) {
      const verdict = classifyFailure(failure);
      // The only call failed, so nothing was billed: the message is given back.
      if (verdict.refund)
        await refundMessage(access.userId, day).catch(error =>
          logEvent('warn', 'assistant_refund_failed', describeError(error)),
        );
      logEvent('error', 'assistant_recap_failed', {
        reason: verdict.reason,
        errorName:
          failure instanceof AgentError ? describeError(failure.origin).errorName : describeError(failure).errorName,
      });
      return json({ error: verdict.message }, verdict.status);
    }
  });
}
