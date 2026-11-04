import { db } from './server';

export interface NotificationConfig {
  ownerId: string;
  alertsActivatedAt: string;
  remindersEnabled: boolean;
  remindersActivatedAt: string | null;
}

/** Existing spaces are initialized by migration; new spaces start without replay. */
export async function getNotificationConfig(ownerId: string): Promise<NotificationConfig> {
  const database = db();
  const columns = '"ownerId", "alertsActivatedAt", "remindersEnabled", "remindersActivatedAt"';
  const existing = await database.prepare(`SELECT ${columns} FROM "notificationSettings" WHERE "ownerId" = $1`)
    .bind(ownerId).first<NotificationConfig>();
  if (existing) return existing;
  await database.prepare(`INSERT INTO "notificationSettings" ("ownerId", "alertsActivatedAt", "remindersEnabled", "remindersActivatedAt")
    VALUES ($1, $2, false, NULL) ON CONFLICT ("ownerId") DO NOTHING`).bind(ownerId, new Date().toISOString()).run();
  const config = await database.prepare(`SELECT ${columns} FROM "notificationSettings" WHERE "ownerId" = $1`)
    .bind(ownerId).first<NotificationConfig>();
  if (!config) throw new Error('Notification configuration is unavailable.');
  return config;
}
