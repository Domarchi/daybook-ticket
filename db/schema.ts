import { pgTable, integer, serial, boolean, text, index, uniqueIndex, check, primaryKey, bigint } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const organizations = pgTable('organizations', {
  id: text('id').primaryKey(),
  ownerId: text('ownerId').notNull(),
  name: text('name').notNull(),
  createdAt: text('createdAt').notNull(),
}, (t) => [uniqueIndex('organizations_owner').on(t.ownerId)]);

export const customerCompanies = pgTable('customerCompanies', {
  id: text('id').primaryKey(),
  organizationId: text('organizationId').notNull().references(() => organizations.id),
  ownerId: text('ownerId').notNull(),
  name: text('name').notNull(),
  createdAt: text('createdAt').notNull(),
  updatedAt: text('updatedAt').notNull(),
}, (t) => [index('customer_companies_owner').on(t.ownerId)]);

export const members = pgTable('members', {
  isTest: boolean('isTest').notNull().default(false),
  id: text('id').primaryKey(),
  organizationId: text('organizationId').notNull().references(() => organizations.id),
  ownerId: text('ownerId').notNull(),
  userId: text('userId'),
  email: text('email').notNull(),
  name: text('name').notNull(),
  role: text('role').notNull(),
  status: text('status').notNull().default('invited'),
  customerCompanyId: text('customerCompanyId').references(() => customerCompanies.id),
  companyAccess: text('companyAccess').notNull().default('own'),
  invitedBy: text('invitedBy'),
  createdAt: text('createdAt').notNull(),
  updatedAt: text('updatedAt').notNull(),
}, (t) => [
  uniqueIndex('members_organization_email').on(t.organizationId, t.email),
  uniqueIndex('members_organization_user').on(t.organizationId, t.userId),
  index('members_owner_status').on(t.ownerId, t.status),
  index('members_company').on(t.ownerId, t.customerCompanyId),
  check('members_company_access', sql`${t.companyAccess} IN ('own', 'manager') AND (${t.companyAccess} <> 'manager' OR (${t.role} = 'client' AND ${t.customerCompanyId} IS NOT NULL)) AND (${t.role} = 'client' OR ${t.customerCompanyId} IS NULL)`),
]);

export const tickets = pgTable('tickets', {
  isTest: boolean('isTest').notNull().default(false),
  id: serial('id').primaryKey(),
  ownerId: text('ownerId').notNull(),
  creationKey: text('creationKey').notNull(),
  subject: text('subject').notNull(),
  requesterName: text('requesterName').notNull(),
  requesterEmail: text('requesterEmail').notNull(),
  requesterMemberId: text('requesterMemberId').references(() => members.id),
  customerCompanyId: text('customerCompanyId').references(() => customerCompanies.id),
  version: integer('version').notNull().default(0),
  department: text('department').notNull(),
  assignee: text('assignee').notNull().default(''),
  assigneeMemberId: text('assigneeMemberId').references(() => members.id),
  status: text('status').notNull().default('open'),
  priority: text('priority').notNull().default('normal'),
  createdAt: text('createdAt').notNull(),
  updatedAt: text('updatedAt').notNull(),
  dueAt: text('dueAt').notNull(),
  slaPolicySnapshot: text('slaPolicySnapshot'),
  slaStartedAt: text('slaStartedAt'),
}, (t) => [index('tickets_owner_updated').on(t.ownerId, t.updatedAt), index('tickets_owner_page').on(t.ownerId, t.updatedAt.desc(), t.id.desc()), index('tickets_requester').on(t.ownerId, t.requesterMemberId), index('tickets_company').on(t.ownerId, t.customerCompanyId), uniqueIndex('tickets_creation_key').on(t.creationKey)]);

export const servicePolicies = pgTable('servicePolicies', {
  id: text('id').primaryKey(), ownerId: text('ownerId').notNull().references(() => organizations.ownerId),
  scopeKey: text('scopeKey').notNull(),
  customerCompanyId: text('customerCompanyId').references(() => customerCompanies.id, { onDelete: 'cascade' }),
  calendarJson: text('calendarJson').notNull(), slaHoursJson: text('slaHoursJson').notNull(),
  version: integer('version').notNull().default(0),
  createdAt: text('createdAt').notNull(), updatedAt: text('updatedAt').notNull(),
}, t => [uniqueIndex('service_policies_scope').on(t.ownerId, t.scopeKey),
  check('service_policies_scope_check', sql`(${t.scopeKey} = 'default' AND ${t.customerCompanyId} IS NULL) OR (${t.customerCompanyId} IS NOT NULL AND ${t.scopeKey} = ${t.customerCompanyId})`)]);

export const assignmentRules = pgTable('assignmentRules', {
  id: text('id').primaryKey(), ownerId: text('ownerId').notNull().references(() => organizations.ownerId),
  customerCompanyId: text('customerCompanyId').references(() => customerCompanies.id, { onDelete: 'cascade' }),
  department: text('department'), name: text('name').notNull(), enabled: boolean('enabled').notNull().default(false),
  position: integer('position').notNull(), agentMemberIdsJson: text('agentMemberIdsJson').notNull(),
  version: integer('version').notNull().default(0), createdAt: text('createdAt').notNull(), updatedAt: text('updatedAt').notNull(),
}, t => [index('assignment_rules_owner_position').on(t.ownerId, t.position), check('assignment_rules_position', sql`${t.position} >= 0`)]);

export const agentAvailability = pgTable('agentAvailability', {
  memberId: text('memberId').primaryKey().references(() => members.id, { onDelete: 'cascade' }),
  ownerId: text('ownerId').notNull().references(() => organizations.ownerId),
  available: boolean('available').notNull().default(true), capacity: integer('capacity').notNull().default(20),
  version: integer('version').notNull().default(0), lastAssignedAt: text('lastAssignedAt'), updatedAt: text('updatedAt').notNull(),
}, t => [index('agent_availability_owner').on(t.ownerId), check('agent_availability_capacity', sql`${t.capacity} BETWEEN 1 AND 1000`)]);

// Genuine future resolution transitions only: migration never invents old SLA outcomes.
export const ticketSlaOutcomes = pgTable('ticketSlaOutcomes', {
  id: text('id').primaryKey(), ownerId: text('ownerId').notNull().references(() => organizations.ownerId),
  ticketId: integer('ticketId').notNull().references(() => tickets.id),
  actorMemberId: text('actorMemberId').references(() => members.id, { onDelete: 'set null' }),
  startedAt: text('startedAt'), dueAt: text('dueAt').notNull(), resolvedAt: text('resolvedAt').notNull(),
  customerCompanyId: text('customerCompanyId').references(() => customerCompanies.id), policySnapshot: text('policySnapshot'),
}, t => [index('ticket_sla_outcomes_period').on(t.ownerId, t.resolvedAt), index('ticket_sla_outcomes_ticket').on(t.ownerId, t.ticketId)]);

export const messages = pgTable('messages', {
  id: serial('id').primaryKey(),
  ownerId: text('ownerId').notNull(),
  ticketId: integer('ticketId').notNull().references(() => tickets.id),
  author: text('author').notNull(),
  authorMemberId: text('authorMemberId').references(() => members.id),
  authorRole: text('authorRole'),
  body: text('body').notNull(),
  bodyFormat: text('bodyFormat').notNull().default('plain'),
  kind: text('kind').notNull(),
  createdAt: text('createdAt').notNull(),
}, (t) => [index('messages_owner_ticket').on(t.ownerId, t.ticketId), index('messages_owner_page').on(t.ownerId, t.ticketId, t.createdAt.desc(), t.id.desc()), check('messages_body_format', sql`${t.bodyFormat} IN ('plain', 'markdown')`)]);

export const savedReplies = pgTable('savedReplies', {
  id: text('id').primaryKey(), ownerId: text('ownerId').notNull(),
  title: text('title').notNull(), category: text('category').notNull(), body: text('body').notNull(),
  createdAt: text('createdAt').notNull(), updatedAt: text('updatedAt').notNull(),
}, (t) => [index('saved_replies_owner').on(t.ownerId)]);

export const ticketEvents = pgTable('ticketEvents', {
  id: text('id').primaryKey(), ownerId: text('ownerId').notNull(),
  ticketId: integer('ticketId').notNull().references(() => tickets.id),
  actorMemberId: text('actorMemberId').references(() => members.id), actorName: text('actorName').notNull(),
  action: text('action').notNull(), beforeValue: text('beforeValue'), afterValue: text('afterValue'), createdAt: text('createdAt').notNull(),
}, (t) => [index('ticket_events_owner_ticket').on(t.ownerId, t.ticketId, t.createdAt)]);

export const operations = pgTable('operations', {
  operationId: text('operationId').primaryKey(), ownerId: text('ownerId').notNull(),
  memberId: text('memberId').notNull().references(() => members.id), kind: text('kind').notNull(),
  requestHash: text('requestHash').notNull(), resultJson: text('resultJson').notNull(), createdAt: text('createdAt').notNull(),
}, (t) => [index('operations_scope').on(t.ownerId, t.memberId, t.kind)]);

export const attachments = pgTable('attachments', {
  id: text('id').primaryKey(), ownerId: text('ownerId').notNull(),
  memberId: text('memberId').notNull().references(() => members.id), draftId: text('draftId').notNull(),
  ticketId: integer('ticketId').references(() => tickets.id), messageId: integer('messageId').references(() => messages.id),
  kind: text('kind').notNull(), pathname: text('pathname').notNull(), name: text('name').notNull(),
  contentType: text('contentType').notNull(), size: integer('size').notNull(), status: text('status').notNull().default('reserved'),
  expiresAt: text('expiresAt').notNull(), uploadedAt: text('uploadedAt'), validatedAt: text('validatedAt'),
  createdAt: text('createdAt').notNull(), updatedAt: text('updatedAt').notNull(),
}, (t) => [
  uniqueIndex('attachments_pathname').on(t.pathname), index('attachments_pending').on(t.ownerId, t.memberId, t.status, t.expiresAt),
  index('attachments_message').on(t.ownerId, t.messageId),
  check('attachments_size', sql`${t.size} BETWEEN 1 AND 10485760`),
  check('attachments_kind', sql`${t.kind} IN ('request', 'reply', 'note')`),
  check('attachments_status', sql`${t.status} IN ('reserved', 'uploaded', 'ready', 'attached', 'deleting', 'deleted')`),
]);

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

export const notificationSettings = pgTable('notificationSettings', {
  ownerId: text('ownerId').primaryKey().references(() => organizations.ownerId, { onDelete: 'cascade' }),
  alertsActivatedAt: text('alertsActivatedAt').notNull(),
  remindersEnabled: boolean('remindersEnabled').notNull().default(false),
  remindersActivatedAt: text('remindersActivatedAt'),
});

export const reminderOccurrences = pgTable('reminderOccurrences', {
  id: text('id').primaryKey(), ownerId: text('ownerId').notNull(),
  ticketId: integer('ticketId').notNull().references(() => tickets.id),
  cycleMessageId: integer('cycleMessageId').notNull().references(() => messages.id),
  unansweredMessageId: integer('unansweredMessageId').references(() => messages.id),
  activationAt: text('activationAt').notNull(), sequence: integer('sequence').notNull(),
  reasonsJson: text('reasonsJson').notNull(), recipientMemberIdsJson: text('recipientMemberIdsJson').notNull(),
  dueAtSnapshot: text('dueAtSnapshot').notNull(), createdAt: text('createdAt').notNull(), expiresAt: text('expiresAt').notNull(),
}, (t) => [
  uniqueIndex('reminder_occurrences_sequence').on(t.ownerId, t.ticketId, t.activationAt, t.cycleMessageId, t.sequence),
  index('reminder_occurrences_ticket').on(t.ownerId, t.ticketId, t.activationAt, t.cycleMessageId, t.createdAt),
]);

export const notificationJobHealth = pgTable('notificationJobHealth', {
  ownerId: text('ownerId').primaryKey(),
  lastStartedAt: text('lastStartedAt'), lastSucceededAt: text('lastSucceededAt'), lastFailedAt: text('lastFailedAt'),
  lastErrorCode: text('lastErrorCode'), lastInvocationId: text('lastInvocationId'),
  cursorTicketId: integer('cursorTicketId').notNull().default(0),
  leaseToken: text('leaseToken'), leaseUntil: text('leaseUntil'),
});

export const escalationSettings = pgTable('escalationSettings', {
  ownerId: text('ownerId').primaryKey().references(() => organizations.ownerId),
  enabled: boolean('enabled').notNull().default(false), unansweredMinutes: integer('unansweredMinutes').notNull().default(240),
  overdueMinutes: integer('overdueMinutes').notNull().default(60), recipientMemberIdsJson: text('recipientMemberIdsJson').notNull().default('[]'),
  activatedAt: text('activatedAt'), version: integer('version').notNull().default(0), updatedAt: text('updatedAt').notNull(),
}, t => [check('escalation_unanswered_minutes', sql`${t.unansweredMinutes} BETWEEN 120 AND 43200`), check('escalation_overdue_minutes', sql`${t.overdueMinutes} BETWEEN 0 AND 43200`)]);
export const escalationOccurrences = pgTable('escalationOccurrences', {
  id: text('id').primaryKey(), ownerId: text('ownerId').notNull().references(() => organizations.ownerId),
  ticketId: integer('ticketId').notNull().references(() => tickets.id), activationAt: text('activationAt').notNull(),
  cycleMessageId: integer('cycleMessageId').notNull().references(() => messages.id), unansweredMessageId: integer('unansweredMessageId').references(() => messages.id),
  reason: text('reason').notNull(), recipientMemberId: text('recipientMemberId').notNull().references(() => members.id),
  assigneeMemberId: text('assigneeMemberId').references(() => members.id), stageKey: text('stageKey').notNull(), dueAtSnapshot: text('dueAtSnapshot').notNull(),
  createdAt: text('createdAt').notNull(), expiresAt: text('expiresAt').notNull(),
}, t => [uniqueIndex('escalation_occurrence_stage').on(t.ownerId, t.ticketId, t.stageKey), index('escalation_occurrence_ticket').on(t.ownerId, t.ticketId), check('escalation_reason', sql`${t.reason} IN ('unanswered','overdue')`)]);
export const ticketSatisfaction = pgTable('ticketSatisfaction', {
  id: text('id').primaryKey(), ownerId: text('ownerId').notNull().references(() => organizations.ownerId), ticketId: integer('ticketId').notNull().references(() => tickets.id),
  resolutionKey: text('resolutionKey').notNull().references(() => ticketSlaOutcomes.id), resolvedAt: text('resolvedAt').notNull(),
  requesterMemberId: text('requesterMemberId').notNull().references(() => members.id), resolverMemberId: text('resolverMemberId').references(() => members.id),
  customerCompanyId: text('customerCompanyId').references(() => customerCompanies.id), score: integer('score'), comment: text('comment'), submittedAt: text('submittedAt'), createdAt: text('createdAt').notNull(),
}, t => [uniqueIndex('ticket_satisfaction_resolution').on(t.ownerId, t.resolutionKey), index('ticket_satisfaction_period').on(t.ownerId, t.resolvedAt), index('ticket_satisfaction_ticket').on(t.ownerId, t.ticketId), check('satisfaction_score', sql`${t.score} BETWEEN 1 AND 5`), check('satisfaction_comment', sql`length(${t.comment}) <= 2000`), check('satisfaction_submission', sql`(${t.score} IS NULL) = (${t.submittedAt} IS NULL)`)]);
export const inboundMailReceipts = pgTable('inboundMailReceipts', {
  providerId: text('providerId').primaryKey(), environment: text('environment').notNull(), payloadHash: text('payloadHash').notNull(),
  ownerId: text('ownerId').references(() => organizations.ownerId), memberId: text('memberId').references(() => members.id),
  ticketId: integer('ticketId').references(() => tickets.id), messageId: integer('messageId').references(() => messages.id), status: text('status').notNull(),
  reasonCode: text('reasonCode'), createdAt: text('createdAt').notNull(), updatedAt: text('updatedAt').notNull(),
}, t => [index('inbound_receipt_owner').on(t.ownerId, t.createdAt), index('inbound_receipt_member').on(t.ownerId, t.memberId, t.createdAt), check('inbound_environment', sql`${t.environment} IN ('qa','production')`), check('inbound_receipt_status', sql`${t.status} IN ('processed','ignored')`)]);

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
  readAt: text('readAt'),
  reminderId: text('reminderId').references(() => reminderOccurrences.id),
  escalationId: text('escalationId').references(() => escalationOccurrences.id),
  satisfactionId: text('satisfactionId').references(() => ticketSatisfaction.id),
  templateVersion: integer('templateVersion').notNull().default(1),
  environment: text('environment'),
  deliveryStatus: text('deliveryStatus').notNull().default('untracked'),
  deliveryEventAt: text('deliveryEventAt'), deliveredAt: text('deliveredAt'),
  bouncedAt: text('bouncedAt'), complainedAt: text('complainedAt'), deliveryErrorCode: text('deliveryErrorCode'),
  createdAt: text('createdAt').notNull(),
  updatedAt: text('updatedAt').notNull(),
}, (t) => [uniqueIndex('mail_outbox_event').on(t.eventKey), index('mail_outbox_pending').on(t.ownerId, t.status, t.nextAttemptAt),
  index('mail_outbox_alerts').on(t.ownerId, t.recipientMemberId, t.createdAt, t.id), index('mail_outbox_provider').on(t.providerId)]);

// Unmatched, untagged provider receipts contain no recipient or message body.
// They are retained briefly to reconcile a webhook arriving before the send response.
export const mailDeliveryEvents = pgTable('mailDeliveryEvents', {
  id: text('id').primaryKey(), outboxId: text('outboxId').references(() => mailOutbox.id), ownerId: text('ownerId'),
  providerId: text('providerId').notNull(), eventType: text('eventType').notNull(),
  occurredAt: text('occurredAt').notNull(), receivedAt: text('receivedAt').notNull(), payloadHash: text('payloadHash').notNull(),
}, (t) => [index('mail_delivery_events_outbox').on(t.ownerId, t.outboxId, t.occurredAt), index('mail_delivery_events_provider').on(t.providerId)]);

// Push endpoints and encryption keys are private device credentials; never expose them in feeds.
export const pushSubscriptions = pgTable('pushSubscriptions', {
  id: text('id').primaryKey(),
  ownerId: text('ownerId').notNull(),
  memberId: text('memberId').notNull().references(() => members.id),
  endpoint: text('endpoint').notNull(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: text('createdAt').notNull(),
  updatedAt: text('updatedAt').notNull(),
  lastTestAt: text('lastTestAt'),
}, (t) => [uniqueIndex('push_subscription_endpoint').on(t.ownerId,t.memberId,t.endpoint), index('push_subscription_member').on(t.ownerId, t.memberId, t.active)]);

export const pushDeliveries = pgTable('pushDeliveries', {
  id: text('id').primaryKey(),
  ownerId: text('ownerId').notNull(),
  eventId: text('eventId').notNull().references(() => mailOutbox.id),
  subscriptionId: text('subscriptionId').notNull().references(() => pushSubscriptions.id),
  status: text('status').notNull().default('queued'),
  attempts: integer('attempts').notNull().default(0),
  leaseUntil: text('leaseUntil'),
  lastErrorCode: text('lastErrorCode'),
  createdAt: text('createdAt').notNull(),
  updatedAt: text('updatedAt').notNull(),
}, (t) => [uniqueIndex('push_delivery_event_device').on(t.eventId, t.subscriptionId), index('push_delivery_pending').on(t.ownerId, t.status, t.createdAt)]);

export * from './auth-schema';

// Delivery reliability: only new tables; no synthetic historical state.
export const inboundMailJobs = pgTable('inboundMailJobs', {
  providerId: text('providerId').primaryKey(), ownerId: text('ownerId').notNull().references(() => organizations.ownerId),
  memberId: text('memberId').notNull().references(() => members.id), environment: text('environment').notNull(),
  envelopeJson: text('envelopeJson').notNull(), envelopeHash: text('envelopeHash').notNull(), status: text('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0), nextAttemptAt: text('nextAttemptAt'), lastAttemptAt: text('lastAttemptAt'), lastErrorCode: text('lastErrorCode'),
  leaseToken: text('leaseToken'), leaseUntil: text('leaseUntil'), ticketId: integer('ticketId').references(() => tickets.id), messageId: integer('messageId').references(() => messages.id),
  manualRetries: integer('manualRetries').notNull().default(0), lastRetryKey: text('lastRetryKey'), lastRetriedAt: text('lastRetriedAt'), createdAt: text('createdAt').notNull(), updatedAt: text('updatedAt').notNull(),
}, t => [index('inbound_jobs_owner_recent').on(t.ownerId,t.createdAt.desc(),t.providerId),index('inbound_jobs_due').on(t.ownerId,t.status,t.nextAttemptAt,t.leaseUntil),
  check('inbound_jobs_environment',sql`${t.environment} IN ('qa','production')`),check('inbound_jobs_status',sql`${t.status} IN ('pending','processing','retry','processed','rejected','failed')`),
  check('inbound_jobs_attempts',sql`${t.attempts} BETWEEN 0 AND 6`),check('inbound_jobs_manual_retries',sql`${t.manualRetries} BETWEEN 0 AND 3`)]);
export const inboundMailJobFiles = pgTable('inboundMailJobFiles', {
  providerId:text('providerId').notNull().references(() => inboundMailJobs.providerId), providerAttachmentId:text('providerAttachmentId').notNull(),
  attachmentId:text('attachmentId').notNull().references(() => attachments.id), sha256:text('sha256').notNull(), createdAt:text('createdAt').notNull(),
},t=>[primaryKey({columns:[t.providerId,t.providerAttachmentId]}),uniqueIndex('inbound_job_file_attachment').on(t.attachmentId)]);
export const ticketPresence = pgTable('ticketPresence', {
  ownerId:text('ownerId').notNull().references(()=>organizations.ownerId,{onDelete:'cascade'}),ticketId:integer('ticketId').notNull().references(()=>tickets.id,{onDelete:'cascade'}),
  memberId:text('memberId').notNull().references(()=>members.id,{onDelete:'cascade'}),tabId:text('tabId').notNull(),activity:text('activity').notNull(),updatedAt:text('updatedAt').notNull(),expiresAt:text('expiresAt').notNull(),
},t=>[primaryKey({columns:[t.ownerId,t.ticketId,t.memberId,t.tabId]}),index('ticket_presence_ticket_expiry').on(t.ownerId,t.ticketId,t.expiresAt),index('ticket_presence_member_expiry').on(t.ownerId,t.memberId,t.expiresAt),check('ticket_presence_activity',sql`${t.activity} IN ('viewing','reply','note')`),check('ticket_presence_tab',sql`${t.tabId} ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'`)]);
export const automaticBackupSettings=pgTable('automaticBackupSettings',{
  ownerId:text('ownerId').primaryKey().references(()=>organizations.ownerId),enabled:boolean('enabled').notNull().default(false),localTime:text('localTime').notNull().default('03:00'),retention:integer('retention').notNull().default(7),storageBudgetMiB:integer('storageBudgetMiB').notNull().default(512),planReviewedAt:text('planReviewedAt'),version:integer('version').notNull().default(0),leaseToken:text('leaseToken'),leaseUntil:text('leaseUntil'),lastErrorCode:text('lastErrorCode'),updatedAt:text('updatedAt').notNull(),
},t=>[check('automatic_backup_time',sql`${t.localTime} ~ '^([01][0-9]|2[0-3]):(00|30)$'`),check('automatic_backup_retention',sql`${t.retention} BETWEEN 1 AND 14`),check('automatic_backup_budget',sql`${t.storageBudgetMiB} BETWEEN 64 AND 1024`),check('automatic_backup_version',sql`${t.version} >= 0`)]);
export const automaticBackupRuns=pgTable('automaticBackupRuns',{
  id:text('id').primaryKey(),ownerId:text('ownerId').notNull().references(()=>organizations.ownerId),environment:text('environment').notNull(),localDate:text('localDate').notNull(),status:text('status').notNull(),attempts:integer('attempts').notNull().default(0),keyId:text('keyId'),archiveSha256:text('archiveSha256'),sizeBytes:integer('sizeBytes'),reservedBytes:integer('reservedBytes').notNull().default(33554432),rowCount:integer('rowCount'),fileCount:integer('fileCount'),errorCode:text('errorCode'),createdAt:text('createdAt').notNull(),updatedAt:text('updatedAt').notNull(),uploadedAt:text('uploadedAt'),verifiedAt:text('verifiedAt'),deletedAt:text('deletedAt'),
},t=>[uniqueIndex('automatic_backup_daily').on(t.ownerId,t.environment,t.localDate),index('automatic_backup_owner_status').on(t.ownerId,t.createdAt),check('automatic_backup_environment',sql`${t.environment} IN ('qa','production')`),check('automatic_backup_status',sql`${t.status} IN ('processing','complete','failed','deleting','deleted')`),check('automatic_backup_attempts',sql`${t.attempts} BETWEEN 0 AND 3`),check('automatic_backup_reserved',sql`${t.reservedBytes} BETWEEN 0 AND 33554432`),check('automatic_backup_size',sql`${t.sizeBytes} IS NULL OR ${t.sizeBytes} BETWEEN 1 AND 33554432`)]);
export const automaticBackupUsage=pgTable('automaticBackupUsage',{
  ownerId:text('ownerId').notNull().references(()=>organizations.ownerId),environment:text('environment').notNull(),month:text('month').notNull(),transferBytes:bigint('transferBytes',{mode:'number'}).notNull().default(0),
},t=>[primaryKey({columns:[t.ownerId,t.environment,t.month]}),check('automatic_backup_usage_environment',sql`${t.environment} IN ('qa','production')`),check('automatic_backup_usage_bytes',sql`${t.transferBytes} >= 0`)]);

export const securityPolicies=pgTable('securityPolicies',{
  ownerId:text('ownerId').primaryKey().references(()=>organizations.ownerId),requireStaffMfa:boolean('requireStaffMfa').notNull().default(false),activatedAt:text('activatedAt'),version:integer('version').notNull().default(0),updatedAt:text('updatedAt').notNull(),
},t=>[check('security_policy_version',sql`${t.version} >= 0`)]);
export const securityAudit=pgTable('securityAudit',{
  id:text('id').primaryKey(),ownerId:text('ownerId').notNull().references(()=>organizations.ownerId),actorMemberId:text('actorMemberId'),actorUserId:text('actorUserId').notNull(),actorName:text('actorName').notNull(),action:text('action').notNull(),targetId:text('targetId'),createdAt:text('createdAt').notNull(),
},t=>[index('security_audit_page').on(t.ownerId,t.createdAt.desc(),t.id.desc())]);

export const workspaceProfiles=pgTable('workspaceProfiles',{workspaceId:text('workspaceId').primaryKey().references(()=>organizations.id),ownerId:text('ownerId').notNull().unique().references(()=>organizations.ownerId),state:text('state').notNull().default('draft'),brandName:text('brandName').notNull(),mailFrom:text('mailFrom'),mailEnabled:boolean('mailEnabled').notNull().default(false),inboundEnabled:boolean('inboundEnabled').notNull().default(false),limitsJson:text('limitsJson').notNull(),version:integer('version').notNull().default(0),quotaEpoch:bigint('quotaEpoch',{mode:'number'}).notNull().default(0),createdAt:text('createdAt').notNull(),updatedAt:text('updatedAt').notNull(),lastJobAt:text('lastJobAt')});
