import { operatorGranted } from '@/lib/workspace-model';
import { getEvolutionFeatures } from '@/lib/evolution-features';
import { getUserPreferences } from '@/lib/user-preferences';
import { knowledgeWorkspaceArticles } from '@/lib/knowledge';
import { db, handle, json, getSettings } from '@/lib/server';
import { requireAccess, memberColumns, publicMember, getCustomerCompanies } from '@/lib/access';
import { getSavedReplies } from '@/lib/saved-replies';
import { getMailStatus, drainOutboxBestEffort } from '@/lib/mail';
import { after } from 'next/server';
import { getTicketFeed } from '@/lib/ticket-feed';
import type { Member } from '@/lib/types';
import { readCommercialWorkspace } from '@/lib/workspaces';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return handle(async () => {
    const access = await requireAccess(request);
    const database = db();
    const client = access.role === 'client';
    const [feed, articles, settings, demo, members, companies, savedReplies, evolution, preferences] =
      await Promise.all([
        getTicketFeed(access),
        knowledgeWorkspaceArticles(access, database),
        getSettings(access.ownerId),
        client
          ? null
          : database.prepare('SELECT "ownerId" FROM "demoImports" WHERE "ownerId" = $1').bind(access.ownerId).first(),
        client
          ? { results: [] as Member[] }
          : database
              .prepare(
                `SELECT ${memberColumns} FROM members WHERE "ownerId" = $1 ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'agent' THEN 2 ELSE 3 END, name`,
              )
              .bind(access.ownerId)
              .all<Member>(),
        getCustomerCompanies(access),
        getSavedReplies(access),
        getEvolutionFeatures(access.ownerId),
        getUserPreferences(access.userId),
      ]);
    if (!client)
      after(async () => {
        await drainOutboxBestEffort(access.ownerId);
      });
    const mailStatus = ['owner', 'admin'].includes(access.role) ? await getMailStatus(access.ownerId) : null;
    const profile = access.organizationId === 'daybook' ? null : await readCommercialWorkspace(access.organizationId);
    if (profile) settings.brandName = profile.brandName;
    return json({
      workspaceId: access.organizationId,
      platformBackupAllowed:
        access.organizationId === 'daybook' && access.role === 'owner' && operatorGranted({ userId: access.userId }),
      viewer: access.member,
      evolution,
      preferences,
      members: members.results.map(publicMember),
      companies,
      savedReplies,
      mailStatus,
      ...feed,
      articles: client && !evolution.features.knowledge ? [] : articles,
      settings: client ? { ...settings, agents: [], notificationMemberIds: [] } : settings,
      demoLoaded: !client && Boolean(demo),
    });
  });
}
