// GET /api/assistant/tickets/:id/suggestions — "Sugerir solución", rules part: the classifier's category, similar
// solved tickets and related knowledge articles. No model and no quota; the chat is the step that costs.
import { requireAssistantAccess } from '@/lib/assistant-access';
import { readSuggestions } from '@/lib/assistant-data';
import { handle, json, parseId } from '@/lib/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: RouteContext<'/api/assistant/tickets/[id]/suggestions'>) {
  return handle(async () => {
    const access = await requireAssistantAccess(request);
    const id = parseId((await context.params).id);
    return json({ suggestions: await readSuggestions(access, id) });
  });
}
