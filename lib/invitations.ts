import type { Database } from '../db/database';

export async function hashInvite(token: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2, '0')).join('');
}
export async function prepareInvitation(database: Database, ownerId: string, memberId: string) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('');
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
  const base = process.env.DAYBOOK_SITE_URL;
  if (!base) throw new Error('Falta DAYBOOK_SITE_URL.');
  const url = new URL('/login', base);
  url.searchParams.set('invite', token);
  const statement = database.prepare("INSERT INTO invitations(\"memberId\",\"ownerId\",\"tokenHash\",\"expiresAt\",\"createdAt\") VALUES($1,$2,$3,$4,$5) ON CONFLICT(\"memberId\") DO UPDATE SET \"tokenHash\"=excluded.\"tokenHash\",\"expiresAt\"=excluded.\"expiresAt\",\"createdAt\"=excluded.\"createdAt\"")
    .bind(memberId, ownerId, await hashInvite(token), expiresAt, now);
  return { statement, url: url.href, expiresAt };
}
export async function readInvitation(database: Database, token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  return database.prepare("SELECT m.id,m.email,m.name,m.\"ownerId\" FROM invitations i JOIN members m ON m.id=i.\"memberId\" AND m.\"ownerId\"=i.\"ownerId\" WHERE i.\"tokenHash\"=$1 AND i.\"expiresAt\">$2 AND m.status='invited' AND m.\"userId\" IS NULL")
    .bind(await hashInvite(token), new Date().toISOString()).first<{ id: string; email: string; name: string; ownerId: string }>();
}
