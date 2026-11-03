import { requireAccess, requireAdmin } from '@/lib/access';
import { db, handle, json, parseBody, articleSchema, articleColumns, asArticle } from '@/lib/server';
import type { Article } from '@/lib/types';
export async function POST(request: Request) {
  return handle(async () => {
    const access = requireAdmin(await requireAccess(request));
    const data = await parseBody(request, articleSchema);
    const now = new Date().toISOString();
    const article = await db().prepare(`INSERT INTO articles ("ownerId", title, category, body, published, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${articleColumns}`).bind(access.ownerId, data.title, data.category, data.body, data.published, now, now).first<Article>();
    return json({ article: asArticle(article!) }, 201);
  });
}
