import { db, handle, json, getSettings, ticketColumns, messageColumns, articleColumns, asArticle } from '@/lib/server';
import { requireAccess, memberColumns, publicMember } from '@/lib/access';
import { getMailStatus, processOutboxBestEffort } from '@/lib/mail';
import type { Ticket, Message, Article, Member } from '@/lib/types';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return handle(async () => {
    const access = await requireAccess(request);
    const database = db();
    const client = access.role === 'client';
    const ticketScope = client ? ' AND "requesterMemberId" = $2' : '';
    const ticketBindings = client ? [access.ownerId, access.member.id] : [access.ownerId];
    const messageScope = client ? ` AND kind <> 'note' AND "ticketId" IN (SELECT id FROM tickets WHERE "ownerId" = $2 AND "requesterMemberId" = $3)` : '';
    const messageBindings = client ? [access.ownerId, access.ownerId, access.member.id] : [access.ownerId];
    const [tickets, messages, articles, settings, demo, members] = await Promise.all([
      database.prepare(`SELECT ${ticketColumns} FROM tickets WHERE "ownerId" = $1${ticketScope} ORDER BY "updatedAt" DESC, id DESC`).bind(...ticketBindings).all<Ticket>(),
      database.prepare(`SELECT ${messageColumns} FROM messages WHERE "ownerId" = $1${messageScope} ORDER BY "createdAt" ASC, id ASC`).bind(...messageBindings).all<Message>(),
      database.prepare(`SELECT ${articleColumns} FROM articles WHERE "ownerId" = $1${client ? ' AND published = true' : ''} ORDER BY "updatedAt" DESC`).bind(access.ownerId).all<Article>(),
      getSettings(access.ownerId),
      client ? null : database.prepare("SELECT \"ownerId\" FROM \"demoImports\" WHERE \"ownerId\" = $1").bind(access.ownerId).first(),
      client ? { results: [] as Member[] } : database.prepare(`SELECT ${memberColumns} FROM members WHERE "ownerId" = $1 ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'agent' THEN 2 ELSE 3 END, name`).bind(access.ownerId).all<Member>(),
    ]);
    if (!client) await processOutboxBestEffort(access.ownerId);
    const mailStatus = ['owner', 'admin'].includes(access.role) ? await getMailStatus(access.ownerId) : null;
    return json({
      viewer: access.member,
      members: members.results.map(publicMember),
      mailStatus,
      tickets: tickets.results,
      messages: messages.results,
      articles: articles.results.map(asArticle),
      settings: client ? { ...settings, agents: [] } : settings,
      demoLoaded: !client && Boolean(demo),
    });
  });
}
