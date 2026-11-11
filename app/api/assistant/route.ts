// POST /api/assistant — the chat with Bita.
//
// Checks run from the cheapest to the most expensive, and nothing is spent before knowing who asks and whether they
// have quota left:
//   1. flag off, or not owner/admin of the main space → 404 (`requireAssistantAccess`)
//   2. no key configured → 503
//   3. shape and size of the conversation → 400/413
//   4. daily quota per person → 429 (atomic reservation; fails closed with 503)
//   5. only then the Anthropic API is called
//
// Read-only: Bita never writes to a ticket. The key is only read by `createClient`; it travels in no response and no
// log. The server keeps no conversation: the log records outcome, tools and tokens, never text.
import { requireAssistantAccess } from '@/lib/assistant-access';
import { AgentError, classifyFailure, converse, createClient } from '@/lib/assistant-agent';
import { assistantDailyLimit, assistantHasKey, assistantModel } from '@/lib/assistant-config';
import { serviceDay } from '@/lib/assistant-desk';
import { MAX_BODY_BYTES, validateConversation } from '@/lib/assistant-input';
import { refundMessage, reserveMessage } from '@/lib/assistant-quota';
import { describeError, logEvent } from '@/lib/log';
import { ApiError, handle, json } from '@/lib/server';

export const dynamic = 'force-dynamic';
// Up to three tool turns are several calls in a row; the agent's own time budget (50 s) fits inside.
export const maxDuration = 60;

export async function POST(request: Request) {
  return handle(async () => {
    const access = await requireAssistantAccess(request);
    if (!assistantHasKey()) throw new ApiError(503, 'Bita no está configurada.');
    if (!request.headers.get('content-type')?.includes('application/json'))
      throw new ApiError(415, 'Envía los datos en formato JSON.');
    const text = await request.text().catch(() => null);
    if (text === null) throw new ApiError(400, 'El cuerpo de la solicitud no es válido.');
    if (text.length > MAX_BODY_BYTES) throw new ApiError(413, 'La conversación es demasiado larga.');
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new ApiError(400, 'El cuerpo de la solicitud no es válido.');
    }
    const conversation = validateConversation(body);
    if (!conversation.ok) throw new ApiError(400, conversation.error);

    const now = Date.now();
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

    try {
      const result = await converse({
        client: createClient(),
        model: assistantModel(),
        messages: conversation.value,
        context: { access, now },
      });
      logEvent('info', 'assistant_query', {
        outcome: result.outcome,
        tools: result.tools.join(',') || null,
        characters: conversation.value[conversation.value.length - 1].content.length,
        inputTokens: result.inputTokens,
        cachedTokens: result.cachedTokens,
        outputTokens: result.outputTokens,
      });
      return json({ reply: result.text, remaining: Math.max(0, limit - reservation.used), limit });
    } catch (failure) {
      const verdict = classifyFailure(failure);
      // Turns already billed before the failure count: the message stays spent. Only a failure that cost nothing
      // gives it back.
      const spent = failure instanceof AgentError && failure.inputTokens + failure.outputTokens > 0;
      if (!spent && verdict.refund)
        await refundMessage(access.userId, day).catch(error =>
          logEvent('warn', 'assistant_refund_failed', describeError(error)),
        );
      logEvent('error', 'assistant_failed', {
        reason: verdict.reason,
        errorName:
          failure instanceof AgentError ? describeError(failure.origin).errorName : describeError(failure).errorName,
        inputTokens: failure instanceof AgentError ? failure.inputTokens : 0,
        outputTokens: failure instanceof AgentError ? failure.outputTokens : 0,
      });
      return json({ error: verdict.message }, verdict.status);
    }
  });
}
