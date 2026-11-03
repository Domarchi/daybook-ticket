import { pgTable, integer, serial, boolean, text, index, uniqueIndex } from 'drizzle-orm/pg-core';

export const organizations = pgTable('organizations', {
  id: text('id').primaryKey(),
  ownerId: text('ownerId').notNull(),
  name: text('name').notNull(),
  createdAt: text('createdAt').notNull(),
}, (t) => [uniqueIndex('organizations_owner').on(t.ownerId)]);

export const members = pgTable('members', {
  id: text('id').primaryKey(),
  organizationId: text('organizationId').notNull().references(() => organizations.id),
  ownerId: text('ownerId').notNull(),
  userId: text('userId'),
  email: text('email').notNull(),
  name: text('name').notNull(),
  role: text('role').notNull(),
  status: text('status').notNull().default('invited'),
  invitedBy: text('invitedBy'),
  createdAt: text('createdAt').notNull(),
  updatedAt: text('updatedAt').notNull(),
}, (t) => [
  uniqueIndex('members_organization_email').on(t.organizationId, t.email),
  uniqueIndex('members_organization_user').on(t.organizationId, t.userId),
  index('members_owner_status').on(t.ownerId, t.status),
]);

export const tickets = pgTable('tickets', {
  id: serial('id').primaryKey(),
  ownerId: text('ownerId').notNull(),
  creationKey: text('creationKey').notNull(),
  subject: text('subject').notNull(),
  requesterName: text('requesterName').notNull(),
  requesterEmail: text('requesterEmail').notNull(),
  requesterMemberId: text('requesterMemberId').references(() => members.id),
  department: text('department').notNull(),
  assignee: text('assignee').notNull().default(''),
  assigneeMemberId: text('assigneeMemberId').references(() => members.id),
  status: text('status').notNull().default('open'),
  priority: text('priority').notNull().default('normal'),
  createdAt: text('createdAt').notNull(),
  updatedAt: text('updatedAt').notNull(),
  dueAt: text('dueAt').notNull(),
}, (t) => [index('tickets_owner_updated').on(t.ownerId, t.updatedAt), index('tickets_requester').on(t.ownerId, t.requesterMemberId), uniqueIndex('tickets_creation_key').on(t.creationKey)]);

export const messages = pgTable('messages', {
  id: serial('id').primaryKey(),
  ownerId: text('ownerId').notNull(),
  ticketId: integer('ticketId').notNull().references(() => tickets.id),
  author: text('author').notNull(),
  body: text('body').notNull(),
  kind: text('kind').notNull(),
  createdAt: text('createdAt').notNull(),
}, (t) => [index('messages_owner_ticket').on(t.ownerId, t.ticketId)]);

export const articles = pgTable('articles', {
  id: serial('id').primaryKey(),
  ownerId: text('ownerId').notNull(),
  title: text('title').notNull(),
  category: text('category').notNull(),
  body: text('body').notNull(),
  published: boolean('published').notNull().default(false),
  createdAt: text('createdAt').notNull(),
  updatedAt: text('updatedAt').notNull(),
}, (t) => [index('articles_owner').on(t.ownerId)]);

export const settings = pgTable('settings', {
  ownerId: text('ownerId').primaryKey(),
  data: text('data').notNull(),
});

export const demoImports = pgTable('demoImports', {
  ownerId: text('ownerId').primaryKey(),
  importedAt: text('importedAt').notNull(),
});

export const mailOutbox = pgTable('mailOutbox', {
  id: text('id').primaryKey(),
  ownerId: text('ownerId').notNull(),
  eventKey: text('eventKey').notNull(),
  event: text('event').notNull(),
  recipientMemberId: text('recipientMemberId').notNull().references(() => members.id),
  ticketId: integer('ticketId').references(() => tickets.id),
  invitationId: text('invitationId'),
  actionUrl: text('actionUrl'),
  expiresAt: text('expiresAt'),
  payloadJson: text('payloadJson'),
  status: text('status').notNull().default('queued'),
  attempts: integer('attempts').notNull().default(0),
  firstAttemptAt: text('firstAttemptAt'),
  nextAttemptAt: text('nextAttemptAt'),
  leaseUntil: text('leaseUntil'),
  providerId: text('providerId'),
  lastErrorCode: text('lastErrorCode'),
  createdAt: text('createdAt').notNull(),
  updatedAt: text('updatedAt').notNull(),
}, (t) => [uniqueIndex('mail_outbox_event').on(t.eventKey), index('mail_outbox_pending').on(t.ownerId, t.status, t.nextAttemptAt)]);

export * from './auth-schema';
