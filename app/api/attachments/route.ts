import { after } from 'next/server';
import { requireAccess } from '@/lib/access';
import { handle, json } from '@/lib/server';
import { attachmentScopeSchema, cleanupAttachments, listDraftAttachments } from '@/lib/attachments';

export async function GET(request: Request) {
  return handle(async () => {
    const access = await requireAccess(request);
    const query = new URL(request.url).searchParams;
    const scope = attachmentScopeSchema.parse({ draftId: query.get('draftId'), kind: query.get('kind'), ...(query.has('ticketId') ? { ticketId: Number(query.get('ticketId')) } : {}), ...(query.has('contractId') ? { contractId: query.get('contractId') } : {}) });
    const result = await listDraftAttachments(access, scope);
    after(async () => { await cleanupAttachments(access.ownerId, access.member.id, 5).catch(() => {}); });
    return json(result);
  });
}
