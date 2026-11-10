import { db, handle, json, parseBody } from '@/lib/server';
import { requireAccess, requireAdmin, requireStaff } from '@/lib/access';
import { getSavedReplies, savedReplySchema } from '@/lib/saved-replies';
export async function GET(request: Request) {
  return handle(async () => json({ savedReplies: await getSavedReplies(requireStaff(await requireAccess(request))) }));
}
export async function POST(request: Request) {
  return handle(async () => {
    const access = requireAdmin(await requireAccess(request));
    const data = await parseBody(request, savedReplySchema);
    const now = new Date().toISOString();
    const savedReply = await db()
      .prepare(
        'INSERT INTO "savedReplies" (id,"ownerId",title,category,body,"createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING id,title,category,body,"createdAt","updatedAt"',
      )
      .bind(crypto.randomUUID(), access.ownerId, data.title, data.category, data.body, now)
      .first();
    return json({ savedReply }, 201);
  });
}
