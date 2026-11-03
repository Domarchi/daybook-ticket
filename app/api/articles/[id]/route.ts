import { requireAccess, requireAdmin } from '@/lib/access';
import { db, handle, json, parseBody, patchArticleSchema, articleColumns, asArticle, parseId, ApiError, type RouteContext } from '@/lib/server';
import type { Article } from '@/lib/types';
export async function PATCH(request: Request, context: RouteContext) {
  return handle(async () => {
    const access = requireAdmin(await requireAccess(request));
    const id = parseId((await context.params).id);
    const data = await parseBody(request, patchArticleSchema);
    const changes: Record<string, string | boolean> = { ...data, updatedAt: new Date().toISOString() };
    const keys = Object.keys(changes);
    const article = await db().prepare(`UPDATE articles SET ${keys.map((key, index) => `"${key}" = $${index + 1}`).join(', ')} WHERE id = $${keys.length + 1} AND "ownerId" = $${keys.length + 2} RETURNING ${articleColumns}`).bind(...Object.values(changes), id, access.ownerId).first<Article>();
    if (!article) throw new ApiError(404, 'El artículo no existe o no tienes acceso.');
    return json({ article: asArticle(article) });
  });
}
