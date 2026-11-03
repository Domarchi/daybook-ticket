import { pgTable, text, integer, bigint, boolean, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';

export const user = pgTable('authUser', {
  id: text('id').primaryKey(), name: text('name').notNull(), email: text('email').notNull().unique(),
  emailVerified: boolean('emailVerified').notNull().default(false), image: text('image'),
  createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).notNull(), updatedAt: timestamp('updatedAt', { withTimezone: true, mode: 'date' }).notNull(),
});
export const session = pgTable('authSession', {
  id: text('id').primaryKey(), token: text('token').notNull().unique(),
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expiresAt', { withTimezone: true, mode: 'date' }).notNull(),
  createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).notNull(), updatedAt: timestamp('updatedAt', { withTimezone: true, mode: 'date' }).notNull(),
  ipAddress: text('ipAddress'), userAgent: text('userAgent'),
}, t => [index('auth_session_user').on(t.userId)]);
export const account = pgTable('authAccount', {
  id: text('id').primaryKey(), accountId: text('accountId').notNull(), providerId: text('providerId').notNull(),
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('accessToken'), refreshToken: text('refreshToken'), idToken: text('idToken'),
  accessTokenExpiresAt: timestamp('accessTokenExpiresAt', { withTimezone: true, mode: 'date' }), refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt', { withTimezone: true, mode: 'date' }),
  scope: text('scope'), password: text('password'),
  createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).notNull(), updatedAt: timestamp('updatedAt', { withTimezone: true, mode: 'date' }).notNull(),
}, t => [index('auth_account_user').on(t.userId), uniqueIndex('auth_account_provider').on(t.providerId, t.accountId)]);
export const verification = pgTable('authVerification', {
  id: text('id').primaryKey(), identifier: text('identifier').notNull(), value: text('value').notNull(),
  expiresAt: timestamp('expiresAt', { withTimezone: true, mode: 'date' }).notNull(),
  createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).notNull(), updatedAt: timestamp('updatedAt', { withTimezone: true, mode: 'date' }).notNull(),
}, t => [index('auth_verification_identifier').on(t.identifier)]);
export const rateLimit = pgTable('authRateLimit', {
  id: text('id').primaryKey(), key: text('key').notNull().unique(), count: integer('count').notNull(), lastRequest: bigint('lastRequest', { mode: 'number' }).notNull(),
});
export const invitations = pgTable('invitations', {
  memberId: text('memberId').primaryKey(), ownerId: text('ownerId').notNull(), tokenHash: text('tokenHash').notNull().unique(),
  expiresAt: text('expiresAt').notNull(), createdAt: text('createdAt').notNull(),
});
