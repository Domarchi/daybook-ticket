// POST /api/assistant/tickets/:id/draft — feature 3: Bita writes a draft of the reply to the customer.
//
// The draft goes back to the browser, which puts it in the composer; the person edits it and sends it. Nothing is
// written here. Order of checks, cheapest first, as in the chat:
//   1. flag off, or not owner/admin of the main space → 404 (`requireAssistantAccess`; a foreign origin is 403)
//   2. no key configured → 503
//   3. the ticket must be readable by this person → 404 (read before any quota is spent)
//   4. daily quota per person, shared with the chat → 429 (atomic reservation; fails closed with 503)
//   5. only then one call to the Anthropic API
//
// The log records outcome and tokens, never text. The customer's name is added after the model answers.
import { requireAssistantAccess } from '@/lib/assistant-access';
import { AgentError, classifyFailure, createClient } from '@/lib/assistant-agent';
import { assistantDailyLimit, assistantHasKey, assistantModel } from '@/lib/assistant-config';
import { readSuggestions } from '@/lib/assistant-data';
import { serviceDay } from '@/lib/assistant-desk';
import { writeDraft } from '@/lib/assistant-draft';
import { refundMessage, reserveMessage } from '@/lib/assistant-quota';
import { describeError, logEvent } from '@/lib/log';
import { ApiError, getTicket, handle, json, parseId } from '@/lib/server';

export const dynamic = 'force-dynamic';
// One call of at most 25 s.
export const maxDuration = 30;

export async function POST(request: Request, context: RouteContext<'/api/assistant/tickets/[id]/draft'>) {
  return handle(async () => {
    const access = await requireAssistantAccess(request);
    if (!assistantHasKey()) throw new ApiError(503, 'Bita no está configurada.');
    const id = parseId((await context.params).id);
    const now = Date.now();
    const [ticket, data] = await Promise.all([
      getTicket(access, id),
      readSuggestions(access, id, { conversation: true }, now),
    ]);

    const day = serviceDay(now);
    const limit = assistantDailyLimit();
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
      const result = await writeDraft({
        client: createClient(),
        model: assistantModel(),
        data,
        requesterName: ticket.requesterName,
        now,
      });
      logEvent('info', 'assistant_draft', {
        outcome: result.outcome,
        inputTokens: result.inputTokens,
        cachedTokens: result.cachedTokens,
        outputTokens: result.outputTokens,
      });
      // A refusal or an empty answer is said, never put in the composer as if it were a reply.
      if (result.outcome === 'refusal' || result.outcome === 'empty')
        return json({ draft: null, notice: result.text, remaining, limit });
      return json({ draft: result.text, cut: result.outcome === 'cut', remaining, limit });
    } catch (failure) {
      const verdict = classifyFailure(failure);
      // The only call failed, so nothing was billed: the message is given back.
      if (verdict.refund)
        await refundMessage(access.userId, day).catch(error =>
          logEvent('warn', 'assistant_refund_failed', describeError(error)),
        );
      logEvent('error', 'assistant_draft_failed', {
        reason: verdict.reason,
        errorName:
          failure instanceof AgentError ? describeError(failure.origin).errorName : describeError(failure).errorName,
      });
      return json({ error: verdict.message }, verdict.status);
    }
  });
}
