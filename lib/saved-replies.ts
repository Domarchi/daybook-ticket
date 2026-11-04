import { z } from 'zod';
import { db, shortText, messageBody } from './server';
import type { AccessContext } from './access';
import type { SavedReply } from './types';
export const savedReplySchema = z.object({ title: shortText, category: shortText, body: messageBody }).strict();
export async function getSavedReplies(access: AccessContext): Promise<SavedReply[]> {
  if (access.role === 'client') return [];
  return (await db().prepare('SELECT id, title, category, body, "createdAt", "updatedAt" FROM "savedReplies" WHERE "ownerId" = $1 ORDER BY category, title, id').bind(access.ownerId).all<SavedReply>()).results;
}
