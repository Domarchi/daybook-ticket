// GET /api/assistant/summary — the desk summary Bita shows when the chat opens. Fixed rules, no model, no quota.
import { requireAssistantAccess } from '@/lib/assistant-access';
import { assistantDailyLimit } from '@/lib/assistant-config';
import { readDeskSummary } from '@/lib/assistant-data';
import { serviceDay } from '@/lib/assistant-desk';
import { readUsed } from '@/lib/assistant-quota';
import { handle, json } from '@/lib/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handle(async () => {
    const access = await requireAssistantAccess(request);
    const now = Date.now();
    const limit = assistantDailyLimit();
    const [summary, used] = await Promise.all([
      readDeskSummary(access, now),
      readUsed(access.userId, serviceDay(now)).catch(() => null),
    ]);
    return json({ summary, remaining: used === null ? null : Math.max(0, limit - used), limit });
  });
}
