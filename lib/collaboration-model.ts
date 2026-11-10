import { z } from 'zod';
import type { Message } from './types';
export const collaborationMessageFields = {
  replyToMessageId: z.number().int().positive().nullable().optional(),
  mentionMemberIds: z.array(z.string().min(1).max(160)).max(10).optional(),
};
export const followerSchema = z.object({ following: z.boolean() }).strict();
export function quoteIsAllowed(
  source: Pick<Message, 'kind' | 'ticketId'>,
  target: { kind: string; ticketId: number; client: boolean },
) {
  return source.ticketId === target.ticketId && !(source.kind === 'note' && (target.client || target.kind !== 'note'));
}
export function safeMentionIds(ids: string[], authorId: string, kind: string) {
  if (ids.length && kind !== 'note') throw new Error('Las menciones están disponibles solo en notas internas.');
  return [...new Set(ids)].filter(id => id !== authorId);
}
export function publicQuote(message: Message) {
  return {
    id: message.id,
    author: message.author,
    kind: message.kind,
    body: message.body.slice(0, 400),
    createdAt: message.createdAt,
  };
}
