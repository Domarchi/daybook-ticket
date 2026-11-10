import { ApiError, db, handle, json, parseBody, type RouteContext } from '@/lib/server';
import { requireAccess, requireAdmin } from '@/lib/access';
import { savedReplySchema } from '@/lib/saved-replies';
export async function PATCH(request: Request, context: RouteContext) {
  return handle(async () => {
    const access = requireAdmin(await requireAccess(request));
    const { id } = await context.params;
    const data = await parseBody(request, savedReplySchema);
    const savedReply = await db()
      .prepare(
        'UPDATE "savedReplies" SET title=$1,category=$2,body=$3,"updatedAt"=$4 WHERE id=$5 AND "ownerId"=$6 RETURNING id,title,category,body,"createdAt","updatedAt"',
      )
      .bind(data.title, data.category, data.body, new Date().toISOString(), id, access.ownerId)
      .first();
    if (!savedReply) throw new ApiError(404, 'La respuesta guardada no existe.');
    return json({ savedReply });
  });
}
export async function DELETE(request: Request, context: RouteContext) {
  return handle(async () => {
    const access = requireAdmin(await requireAccess(request));
    const { id } = await context.params;
    const result = await db()
      .prepare('DELETE FROM "savedReplies" WHERE id=$1 AND "ownerId"=$2')
      .bind(id, access.ownerId)
      .run();
    if (!result.meta.changes) throw new ApiError(404, 'La respuesta guardada no existe.');
    return json({ ok: true });
  });
}
