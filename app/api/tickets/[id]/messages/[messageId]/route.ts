import { requireAccess } from '@/lib/access';
import { handle, json, parseId } from '@/lib/server';
import { requireEvolutionFeature } from '@/lib/evolution-features';
import { getMessageContext } from '@/lib/ticket-collaboration';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string; messageId: string }> }) {
  return handle(async () => {
    const access = await requireAccess(request);
    await requireEvolutionFeature(access, 'collaboration');
    const params = await context.params;
    return json(await getMessageContext(access, parseId(params.id), parseId(params.messageId)));
  });
}
