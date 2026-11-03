import { db, handle, json, getSettings, articleColumns, asArticle } from '@/lib/server';
import { requireAccess, memberColumns, publicMember } from '@/lib/access';
import { getMailStatus, processOutboxBestEffort } from '@/lib/mail';
import { getTicketFeed } from '@/lib/ticket-feed';
import type { Article, Member } from '@/lib/types';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return handle(async () => {
    const access = await requireAccess(request);
    const database = db();
    const client = access.role === 'client';
    const [feed, articles, settings, demo, members] = await Promise.all([
      getTicketFeed(access),
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
      ...feed,
      articles: articles.results.map(asArticle),
      settings: client ? { ...settings, agents: [] } : settings,
      demoLoaded: !client && Boolean(demo),
    });
  });
}
