import type { PreparedStatement } from '@/db/database';
import { requireAccess, requireAdmin } from '@/lib/access';
import { db, handle, json, getSettings } from '@/lib/server';
import { DEMO_TICKETS, DEMO_ARTICLES } from '@/lib/demo';
export async function POST(request: Request) {
  return handle(async () => {
    const access = requireAdmin(await requireAccess(request));
    const database = db();
    const existing = await database.prepare("SELECT \"ownerId\" FROM \"demoImports\" WHERE \"ownerId\" = $1").bind(access.ownerId).first();
    if (existing) return json({ loaded: false });
    const settings = await getSettings(access.ownerId);
    const now = new Date().toISOString();
    const statements: PreparedStatement[] = [];
    const demoSettings = { ...settings, agents: Array.from(new Set([...settings.agents, ...DEMO_TICKETS.map(t => t.assignee).filter(Boolean)])), departments: Array.from(new Set([...settings.departments, ...DEMO_TICKETS.map(t => t.department)])) };
    statements.push(database.prepare("INSERT INTO settings (\"ownerId\", data) SELECT $1, $2 WHERE NOT EXISTS (SELECT 1 FROM \"demoImports\" WHERE \"ownerId\" = $3) ON CONFLICT(\"ownerId\") DO UPDATE SET data = excluded.data").bind(access.ownerId, JSON.stringify(demoSettings), access.ownerId));
    for (const entry of DEMO_TICKETS) {
      const createdAt = new Date(Date.now() - entry.ageHours * 3600000).toISOString();
      const updatedAt = new Date(Date.now() - Math.min(entry.ageHours, 0.5) * 3600000).toISOString();
      const dueAt = new Date(new Date(createdAt).getTime() + settings.slaHours[entry.priority] * 3600000).toISOString();
      const creationKey = `${access.ownerId}:nexodesk-demo:${entry.key}`;
      statements.push(database.prepare("INSERT INTO tickets (\"ownerId\", \"creationKey\", subject, \"requesterName\", \"requesterEmail\", department, assignee, status, priority, \"createdAt\", \"updatedAt\", \"dueAt\") SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12 WHERE NOT EXISTS (SELECT 1 FROM \"demoImports\" WHERE \"ownerId\" = $13)").bind(access.ownerId, creationKey, entry.subject, entry.requesterName, entry.requesterEmail, entry.department, entry.assignee, entry.status, entry.priority, createdAt, updatedAt, dueAt, access.ownerId));
      statements.push(database.prepare("INSERT INTO messages (\"ownerId\", \"ticketId\", author, body, kind, \"createdAt\") SELECT $1, id, $2, $3, $4, $5 FROM tickets WHERE \"creationKey\" = $6 AND \"ownerId\" = $7 AND NOT EXISTS (SELECT 1 FROM \"demoImports\" WHERE \"ownerId\" = $8)").bind(access.ownerId, entry.requesterName, entry.body, 'request', createdAt, creationKey, access.ownerId, access.ownerId));
      if (entry.followup) statements.push(database.prepare("INSERT INTO messages (\"ownerId\", \"ticketId\", author, body, kind, \"createdAt\") SELECT $1, id, $2, $3, $4, $5 FROM tickets WHERE \"creationKey\" = $6 AND \"ownerId\" = $7 AND NOT EXISTS (SELECT 1 FROM \"demoImports\" WHERE \"ownerId\" = $8)").bind(access.ownerId, entry.followup.author, entry.followup.body, entry.followup.kind, updatedAt, creationKey, access.ownerId, access.ownerId));
    }
    for (const article of DEMO_ARTICLES) statements.push(database.prepare("INSERT INTO articles (\"ownerId\", title, category, body, published, \"createdAt\", \"updatedAt\") SELECT $1, $2, $3, $4, $5, $6, $7 WHERE NOT EXISTS (SELECT 1 FROM \"demoImports\" WHERE \"ownerId\" = $8)").bind(access.ownerId, article.title, article.category, article.body, article.published, now, now, access.ownerId));
    statements.push(database.prepare("INSERT INTO \"demoImports\" (\"ownerId\", \"importedAt\") VALUES ($1, $2) ON CONFLICT(\"ownerId\") DO NOTHING").bind(access.ownerId, now));
    const result = await database.batch(statements);
    return json({ loaded: Boolean(result[0].meta.changes) });
  });
}
