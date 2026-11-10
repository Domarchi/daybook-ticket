import { user as preferenceUser } from './auth-schema';
import {
  pgTable,
  integer,
  serial,
  boolean,
  text,
  index,
  uniqueIndex,
  check,
  primaryKey,
  bigint,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const organizations = pgTable(
  'organizations',
  {
    id: text('id').primaryKey(),
    ownerId: text('ownerId').notNull(),
    name: text('name').notNull(),
    createdAt: text('createdAt').notNull(),
  },
  t => [uniqueIndex('organizations_owner').on(t.ownerId)],
);

export const customerCompanies = pgTable(
  'customerCompanies',
  {
    id: text('id').primaryKey(),
    organizationId: text('organizationId')
      .notNull()
      .references(() => organizations.id),
    ownerId: text('ownerId').notNull(),
    name: text('name').notNull(),
    createdAt: text('createdAt').notNull(),
    updatedAt: text('updatedAt').notNull(),
  },
  t => [index('customer_companies_owner').on(t.ownerId)],
);

export const members = pgTable(
  'members',
  {
    isTest: boolean('isTest').notNull().default(false),
    id: text('id').primaryKey(),
    organizationId: text('organizationId')
      .notNull()
      .references(() => organizations.id),
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
  },
  t => [
    uniqueIndex('members_organization_email').on(t.organizationId, t.email),
    uniqueIndex('members_organization_user').on(t.organizationId, t.userId),
    index('members_owner_status').on(t.ownerId, t.status),
    index('members_company').on(t.ownerId, t.customerCompanyId),
    check(
      'members_company_access',
      sql`${t.companyAccess} IN ('own', 'manager') AND (${t.companyAccess} <> 'manager' OR (${t.role} = 'client' AND ${t.customerCompanyId} IS NOT NULL)) AND (${t.role} = 'client' OR ${t.customerCompanyId} IS NULL)`,
    ),
  ],
);

export const tickets = pgTable(
  'tickets',
  {
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
  },
  t => [
    index('tickets_owner_updated').on(t.ownerId, t.updatedAt),
    index('tickets_owner_page').on(t.ownerId, t.updatedAt.desc(), t.id.desc()),
    index('tickets_requester').on(t.ownerId, t.requesterMemberId),
    index('tickets_company').on(t.ownerId, t.customerCompanyId),
    uniqueIndex('tickets_creation_key').on(t.creationKey),
  ],
);

export const servicePolicies = pgTable(
  'servicePolicies',
  {
    id: text('id').primaryKey(),
    ownerId: text('ownerId')
      .notNull()
      .references(() => organizations.ownerId),
    scopeKey: text('scopeKey').notNull(),
    customerCompanyId: text('customerCompanyId').references(() => customerCompanies.id, { onDelete: 'cascade' }),
    calendarJson: text('calendarJson').notNull(),
    slaHoursJson: text('slaHoursJson').notNull(),
    version: integer('version').notNull().default(0),
    createdAt: text('createdAt').notNull(),
    updatedAt: text('updatedAt').notNull(),
  },
  t => [
    uniqueIndex('service_policies_scope').on(t.ownerId, t.scopeKey),
    check(
      'service_policies_scope_check',
      sql`(${t.scopeKey} = 'default' AND ${t.customerCompanyId} IS NULL) OR (${t.customerCompanyId} IS NOT NULL AND ${t.scopeKey} = ${t.customerCompanyId})`,
    ),
  ],
);

export const assignmentRules = pgTable(
  'assignmentRules',
  {
    id: text('id').primaryKey(),
    ownerId: text('ownerId')
      .notNull()
      .references(() => organizations.ownerId),
    customerCompanyId: text('customerCompanyId').references(() => customerCompanies.id, { onDelete: 'cascade' }),
    department: text('department'),
    name: text('name').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    position: integer('position').notNull(),
    agentMemberIdsJson: text('agentMemberIdsJson').notNull(),
    version: integer('version').notNull().default(0),
    createdAt: text('createdAt').notNull(),
    updatedAt: text('updatedAt').notNull(),
  },
  t => [
    index('assignment_rules_owner_position').on(t.ownerId, t.position),
    check('assignment_rules_position', sql`${t.position} >= 0`),
  ],
);

export const agentAvailability = pgTable(
  'agentAvailability',
  {
    memberId: text('memberId')
      .primaryKey()
      .references(() => members.id, { onDelete: 'cascade' }),
    ownerId: text('ownerId')
      .notNull()
      .references(() => organizations.ownerId),
    available: boolean('available').notNull().default(true),
    capacity: integer('capacity').notNull().default(20),
    version: integer('version').notNull().default(0),
    lastAssignedAt: text('lastAssignedAt'),
    updatedAt: text('updatedAt').notNull(),
  },
  t => [
    index('agent_availability_owner').on(t.ownerId),
    check('agent_availability_capacity', sql`${t.capacity} BETWEEN 1 AND 1000`),
  ],
);

// Genuine future resolution transitions only: migration never invents old SLA outcomes.
export const ticketSlaOutcomes = pgTable(
  'ticketSlaOutcomes',
  {
    id: text('id').primaryKey(),
    ownerId: text('ownerId')
      .notNull()
      .references(() => organizations.ownerId),
    ticketId: integer('ticketId')
      .notNull()
      .references(() => tickets.id),
    actorMemberId: text('actorMemberId').references(() => members.id, { onDelete: 'set null' }),
    startedAt: text('startedAt'),
    dueAt: text('dueAt').notNull(),
    resolvedAt: text('resolvedAt').notNull(),
    customerCompanyId: text('customerCompanyId').references(() => customerCompanies.id),
    policySnapshot: text('policySnapshot'),
  },
  t => [
    index('ticket_sla_outcomes_period').on(t.ownerId, t.resolvedAt),
    index('ticket_sla_outcomes_ticket').on(t.ownerId, t.ticketId),
  ],
);

export const messages = pgTable(
  'messages',
  {
    replyToMessageId: integer('replyToMessageId').references((): AnyPgColumn => messages.id),
    id: serial('id').primaryKey(),
    ownerId: text('ownerId').notNull(),
    ticketId: integer('ticketId')
      .notNull()
      .references(() => tickets.id),
    author: text('author').notNull(),
    authorMemberId: text('authorMemberId').references(() => members.id),
    authorRole: text('authorRole'),
    body: text('body').notNull(),
    bodyFormat: text('bodyFormat').notNull().default('plain'),
    kind: text('kind').notNull(),
    createdAt: text('createdAt').notNull(),
  },
  t => [
    index('messages_owner_ticket').on(t.ownerId, t.ticketId),
    index('messages_owner_page').on(t.ownerId, t.ticketId, t.createdAt.desc(), t.id.desc()),
    check('messages_body_format', sql`${t.bodyFormat} IN ('plain', 'markdown')`),
  ],
);

export const savedReplies = pgTable(
  'savedReplies',
  {
    id: text('id').primaryKey(),
    ownerId: text('ownerId').notNull(),
    title: text('title').notNull(),
    category: text('category').notNull(),
    body: text('body').notNull(),
    createdAt: text('createdAt').notNull(),
    updatedAt: text('updatedAt').notNull(),
  },
  t => [index('saved_replies_owner').on(t.ownerId)],
);

export const ticketEvents = pgTable(
  'ticketEvents',
  {
    id: text('id').primaryKey(),
    ownerId: text('ownerId').notNull(),
    ticketId: integer('ticketId')
      .notNull()
      .references(() => tickets.id),
    actorMemberId: text('actorMemberId').references(() => members.id),
    actorName: text('actorName').notNull(),
    action: text('action').notNull(),
    beforeValue: text('beforeValue'),
    afterValue: text('afterValue'),
    createdAt: text('createdAt').notNull(),
  },
  t => [index('ticket_events_owner_ticket').on(t.ownerId, t.ticketId, t.createdAt)],
);

export const operations = pgTable(
  'operations',
  {
    operationId: text('operationId').primaryKey(),
    ownerId: text('ownerId').notNull(),
    memberId: text('memberId')
      .notNull()
      .references(() => members.id),
    kind: text('kind').notNull(),
    requestHash: text('requestHash').notNull(),
    resultJson: text('resultJson').notNull(),
    createdAt: text('createdAt').notNull(),
  },
  t => [index('operations_scope').on(t.ownerId, t.memberId, t.kind)],
);

export const attachments = pgTable(
  'attachments',
  {
    id: text('id').primaryKey(),
    ownerId: text('ownerId').notNull(),
    memberId: text('memberId')
      .notNull()
      .references(() => members.id),
    draftId: text('draftId').notNull(),
    ticketId: integer('ticketId').references(() => tickets.id),
    messageId: integer('messageId').references(() => messages.id),
    contractId: text('contractId').references(() => serviceContracts.id),
    kind: text('kind').notNull(),
    pathname: text('pathname').notNull(),
    name: text('name').notNull(),
    contentType: text('contentType').notNull(),
    size: integer('size').notNull(),
    status: text('status').notNull().default('reserved'),
    expiresAt: text('expiresAt').notNull(),
    uploadedAt: text('uploadedAt'),
    validatedAt: text('validatedAt'),
    createdAt: text('createdAt').notNull(),
    updatedAt: text('updatedAt').notNull(),
  },
  t => [
    uniqueIndex('attachments_pathname').on(t.pathname),
    index('attachments_pending').on(t.ownerId, t.memberId, t.status, t.expiresAt),
    index('attachments_message').on(t.ownerId, t.messageId),
    check('attachments_size', sql`${t.size} BETWEEN 1 AND 10485760`),
    check('attachments_kind', sql`${t.kind} IN ('request', 'reply', 'note', 'contract')`),
    check(
      'attachment_contract_scope',
      sql`(${t.kind}='contract' AND ${t.contractId} IS NOT NULL AND ${t.ticketId} IS NULL AND ${t.messageId} IS NULL) OR (${t.kind}<>'contract' AND ${t.contractId} IS NULL)`,
    ),
    index('attachments_contract').on(t.ownerId, t.contractId, t.status),
    check(
      'attachments_status',
      sql`${t.status} IN ('reserved', 'uploaded', 'ready', 'attached', 'deleting', 'deleted')`,
    ),
  ],
);

export const articles = pgTable(
  'articles',
  {
    version: integer('version').notNull().default(0),
    contentRevision: integer('contentRevision').notNull().default(0),
    reviewState: text('reviewState').notNull().default('draft'),
    archived: boolean('archived').notNull().default(false),
    id: serial('id').primaryKey(),
    ownerId: text('ownerId').notNull(),
    title: text('title').notNull(),
    category: text('category').notNull(),
    body: text('body').notNull(),
    published: boolean('published').notNull().default(false),
    createdAt: text('createdAt').notNull(),
    updatedAt: text('updatedAt').notNull(),
  },
  t => [
    index('articles_owner').on(t.ownerId),
    check('articles_reviewState_check', sql`${t.reviewState} IN ('draft','review','approved','changes')`),
  ],
);

export const settings = pgTable('settings', {
  ownerId: text('ownerId').primaryKey(),
  data: text('data').notNull(),
});

export const demoImports = pgTable('demoImports', {
  ownerId: text('ownerId').primaryKey(),
  importedAt: text('importedAt').notNull(),
});

export const notificationSettings = pgTable('notificationSettings', {
  ownerId: text('ownerId')
    .primaryKey()
    .references(() => organizations.ownerId, { onDelete: 'cascade' }),
  alertsActivatedAt: text('alertsActivatedAt').notNull(),
  remindersEnabled: boolean('remindersEnabled').notNull().default(false),
  remindersActivatedAt: text('remindersActivatedAt'),
});

export const reminderOccurrences = pgTable(
  'reminderOccurrences',
  {
    id: text('id').primaryKey(),
    ownerId: text('ownerId').notNull(),
    ticketId: integer('ticketId')
      .notNull()
      .references(() => tickets.id),
    cycleMessageId: integer('cycleMessageId')
      .notNull()
      .references(() => messages.id),
    unansweredMessageId: integer('unansweredMessageId').references(() => messages.id),
    activationAt: text('activationAt').notNull(),
    sequence: integer('sequence').notNull(),
    reasonsJson: text('reasonsJson').notNull(),
    recipientMemberIdsJson: text('recipientMemberIdsJson').notNull(),
    dueAtSnapshot: text('dueAtSnapshot').notNull(),
    createdAt: text('createdAt').notNull(),
    expiresAt: text('expiresAt').notNull(),
  },
  t => [
    uniqueIndex('reminder_occurrences_sequence').on(
      t.ownerId,
      t.ticketId,
      t.activationAt,
      t.cycleMessageId,
      t.sequence,
    ),
    index('reminder_occurrences_ticket').on(t.ownerId, t.ticketId, t.activationAt, t.cycleMessageId, t.createdAt),
  ],
);

export const notificationJobHealth = pgTable('notificationJobHealth', {
  ownerId: text('ownerId').primaryKey(),
  lastStartedAt: text('lastStartedAt'),
  lastSucceededAt: text('lastSucceededAt'),
  lastFailedAt: text('lastFailedAt'),
  lastErrorCode: text('lastErrorCode'),
  lastInvocationId: text('lastInvocationId'),
  cursorTicketId: integer('cursorTicketId').notNull().default(0),
  leaseToken: text('leaseToken'),
  leaseUntil: text('leaseUntil'),
});

export const escalationSettings = pgTable(
  'escalationSettings',
  {
    ownerId: text('ownerId')
      .primaryKey()
      .references(() => organizations.ownerId),
    enabled: boolean('enabled').notNull().default(false),
    unansweredMinutes: integer('unansweredMinutes').notNull().default(240),
    overdueMinutes: integer('overdueMinutes').notNull().default(60),
    recipientMemberIdsJson: text('recipientMemberIdsJson').notNull().default('[]'),
    activatedAt: text('activatedAt'),
    version: integer('version').notNull().default(0),
    updatedAt: text('updatedAt').notNull(),
  },
  t => [
    check('escalation_unanswered_minutes', sql`${t.unansweredMinutes} BETWEEN 120 AND 43200`),
    check('escalation_overdue_minutes', sql`${t.overdueMinutes} BETWEEN 0 AND 43200`),
  ],
);
export const escalationOccurrences = pgTable(
  'escalationOccurrences',
  {
    id: text('id').primaryKey(),
    ownerId: text('ownerId')
      .notNull()
      .references(() => organizations.ownerId),
    ticketId: integer('ticketId')
      .notNull()
      .references(() => tickets.id),
    activationAt: text('activationAt').notNull(),
    cycleMessageId: integer('cycleMessageId')
      .notNull()
      .references(() => messages.id),
    unansweredMessageId: integer('unansweredMessageId').references(() => messages.id),
    reason: text('reason').notNull(),
    recipientMemberId: text('recipientMemberId')
      .notNull()
      .references(() => members.id),
    assigneeMemberId: text('assigneeMemberId').references(() => members.id),
    stageKey: text('stageKey').notNull(),
    dueAtSnapshot: text('dueAtSnapshot').notNull(),
    createdAt: text('createdAt').notNull(),
    expiresAt: text('expiresAt').notNull(),
  },
  t => [
    uniqueIndex('escalation_occurrence_stage').on(t.ownerId, t.ticketId, t.stageKey),
    index('escalation_occurrence_ticket').on(t.ownerId, t.ticketId),
    check('escalation_reason', sql`${t.reason} IN ('unanswered','overdue')`),
  ],
);
export const ticketSatisfaction = pgTable(
  'ticketSatisfaction',
  {
    id: text('id').primaryKey(),
    ownerId: text('ownerId')
      .notNull()
      .references(() => organizations.ownerId),
    ticketId: integer('ticketId')
      .notNull()
      .references(() => tickets.id),
    resolutionKey: text('resolutionKey')
      .notNull()
      .references(() => ticketSlaOutcomes.id),
    resolvedAt: text('resolvedAt').notNull(),
    requesterMemberId: text('requesterMemberId')
      .notNull()
      .references(() => members.id),
    resolverMemberId: text('resolverMemberId').references(() => members.id),
    customerCompanyId: text('customerCompanyId').references(() => customerCompanies.id),
    score: integer('score'),
    comment: text('comment'),
    submittedAt: text('submittedAt'),
    createdAt: text('createdAt').notNull(),
  },
  t => [
    uniqueIndex('ticket_satisfaction_resolution').on(t.ownerId, t.resolutionKey),
    index('ticket_satisfaction_period').on(t.ownerId, t.resolvedAt),
    index('ticket_satisfaction_ticket').on(t.ownerId, t.ticketId),
    check('satisfaction_score', sql`${t.score} BETWEEN 1 AND 5`),
    check('satisfaction_comment', sql`length(${t.comment}) <= 2000`),
    check('satisfaction_submission', sql`(${t.score} IS NULL) = (${t.submittedAt} IS NULL)`),
  ],
);
export const inboundMailReceipts = pgTable(
  'inboundMailReceipts',
  {
    providerId: text('providerId').primaryKey(),
    environment: text('environment').notNull(),
    payloadHash: text('payloadHash').notNull(),
    ownerId: text('ownerId').references(() => organizations.ownerId),
    memberId: text('memberId').references(() => members.id),
    ticketId: integer('ticketId').references(() => tickets.id),
    messageId: integer('messageId').references(() => messages.id),
    status: text('status').notNull(),
    reasonCode: text('reasonCode'),
    createdAt: text('createdAt').notNull(),
    updatedAt: text('updatedAt').notNull(),
  },
  t => [
    index('inbound_receipt_owner').on(t.ownerId, t.createdAt),
    index('inbound_receipt_member').on(t.ownerId, t.memberId, t.createdAt),
    check('inbound_environment', sql`${t.environment} IN ('qa','production')`),
    check('inbound_receipt_status', sql`${t.status} IN ('processed','ignored')`),
  ],
);

export const mailOutbox = pgTable(
  'mailOutbox',
  {
    sourceMessageId: integer('sourceMessageId').references(() => messages.id),
    id: text('id').primaryKey(),
    ownerId: text('ownerId').notNull(),
    eventKey: text('eventKey').notNull(),
    event: text('event').notNull(),
    recipientMemberId: text('recipientMemberId')
      .notNull()
      .references(() => members.id),
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
    serviceReminderId: text('serviceReminderId').references(() => serviceContextReminders.id),
    templateVersion: integer('templateVersion').notNull().default(1),
    environment: text('environment'),
    deliveryStatus: text('deliveryStatus').notNull().default('untracked'),
    deliveryEventAt: text('deliveryEventAt'),
    deliveredAt: text('deliveredAt'),
    bouncedAt: text('bouncedAt'),
    complainedAt: text('complainedAt'),
    deliveryErrorCode: text('deliveryErrorCode'),
    createdAt: text('createdAt').notNull(),
    updatedAt: text('updatedAt').notNull(),
  },
  t => [
    uniqueIndex('mail_outbox_event').on(t.eventKey),
    index('mail_outbox_pending').on(t.ownerId, t.status, t.nextAttemptAt),
    index('mail_outbox_alerts').on(t.ownerId, t.recipientMemberId, t.createdAt, t.id),
    index('mail_outbox_provider').on(t.providerId),
  ],
);

// Unmatched, untagged provider receipts contain no recipient or message body.
// They are retained briefly to reconcile a webhook arriving before the send response.
export const mailDeliveryEvents = pgTable(
  'mailDeliveryEvents',
  {
    id: text('id').primaryKey(),
    outboxId: text('outboxId').references(() => mailOutbox.id),
    ownerId: text('ownerId'),
    providerId: text('providerId').notNull(),
    eventType: text('eventType').notNull(),
    occurredAt: text('occurredAt').notNull(),
    receivedAt: text('receivedAt').notNull(),
    payloadHash: text('payloadHash').notNull(),
  },
  t => [
    index('mail_delivery_events_outbox').on(t.ownerId, t.outboxId, t.occurredAt),
    index('mail_delivery_events_provider').on(t.providerId),
  ],
);

// Push endpoints and encryption keys are private device credentials; never expose them in feeds.
export const pushSubscriptions = pgTable(
  'pushSubscriptions',
  {
    id: text('id').primaryKey(),
    ownerId: text('ownerId').notNull(),
    memberId: text('memberId')
      .notNull()
      .references(() => members.id),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: text('createdAt').notNull(),
    updatedAt: text('updatedAt').notNull(),
    lastTestAt: text('lastTestAt'),
  },
  t => [
    uniqueIndex('push_subscription_endpoint').on(t.ownerId, t.memberId, t.endpoint),
    index('push_subscription_member').on(t.ownerId, t.memberId, t.active),
  ],
);

export const pushDeliveries = pgTable(
  'pushDeliveries',
  {
    id: text('id').primaryKey(),
    ownerId: text('ownerId').notNull(),
    eventId: text('eventId')
      .notNull()
      .references(() => mailOutbox.id),
    subscriptionId: text('subscriptionId')
      .notNull()
      .references(() => pushSubscriptions.id),
    status: text('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    leaseUntil: text('leaseUntil'),
    lastErrorCode: text('lastErrorCode'),
    createdAt: text('createdAt').notNull(),
    updatedAt: text('updatedAt').notNull(),
  },
  t => [
    uniqueIndex('push_delivery_event_device').on(t.eventId, t.subscriptionId),
    index('push_delivery_pending').on(t.ownerId, t.status, t.createdAt),
  ],
);

export * from './auth-schema';

// Delivery reliability: only new tables; no synthetic historical state.
export const inboundMailJobs = pgTable(
  'inboundMailJobs',
  {
    providerId: text('providerId').primaryKey(),
    ownerId: text('ownerId')
      .notNull()
      .references(() => organizations.ownerId),
    memberId: text('memberId')
      .notNull()
      .references(() => members.id),
    environment: text('environment').notNull(),
    envelopeJson: text('envelopeJson').notNull(),
    envelopeHash: text('envelopeHash').notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: text('nextAttemptAt'),
    lastAttemptAt: text('lastAttemptAt'),
    lastErrorCode: text('lastErrorCode'),
    leaseToken: text('leaseToken'),
    leaseUntil: text('leaseUntil'),
    ticketId: integer('ticketId').references(() => tickets.id),
    messageId: integer('messageId').references(() => messages.id),
    manualRetries: integer('manualRetries').notNull().default(0),
    lastRetryKey: text('lastRetryKey'),
    lastRetriedAt: text('lastRetriedAt'),
    createdAt: text('createdAt').notNull(),
    updatedAt: text('updatedAt').notNull(),
  },
  t => [
    index('inbound_jobs_owner_recent').on(t.ownerId, t.createdAt.desc(), t.providerId),
    index('inbound_jobs_due').on(t.ownerId, t.status, t.nextAttemptAt, t.leaseUntil),
    check('inbound_jobs_environment', sql`${t.environment} IN ('qa','production')`),
    check('inbound_jobs_status', sql`${t.status} IN ('pending','processing','retry','processed','rejected','failed')`),
    check('inbound_jobs_attempts', sql`${t.attempts} BETWEEN 0 AND 6`),
    check('inbound_jobs_manual_retries', sql`${t.manualRetries} BETWEEN 0 AND 3`),
  ],
);
export const inboundMailJobFiles = pgTable(
  'inboundMailJobFiles',
  {
    providerId: text('providerId')
      .notNull()
      .references(() => inboundMailJobs.providerId),
    providerAttachmentId: text('providerAttachmentId').notNull(),
    attachmentId: text('attachmentId')
      .notNull()
      .references(() => attachments.id),
    sha256: text('sha256').notNull(),
    createdAt: text('createdAt').notNull(),
  },
  t => [
    primaryKey({ columns: [t.providerId, t.providerAttachmentId] }),
    uniqueIndex('inbound_job_file_attachment').on(t.attachmentId),
  ],
);
export const ticketPresence = pgTable(
  'ticketPresence',
  {
    ownerId: text('ownerId')
      .notNull()
      .references(() => organizations.ownerId, { onDelete: 'cascade' }),
    ticketId: integer('ticketId')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    memberId: text('memberId')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    tabId: text('tabId').notNull(),
    activity: text('activity').notNull(),
    updatedAt: text('updatedAt').notNull(),
    expiresAt: text('expiresAt').notNull(),
  },
  t => [
    primaryKey({ columns: [t.ownerId, t.ticketId, t.memberId, t.tabId] }),
    index('ticket_presence_ticket_expiry').on(t.ownerId, t.ticketId, t.expiresAt),
    index('ticket_presence_member_expiry').on(t.ownerId, t.memberId, t.expiresAt),
    check('ticket_presence_activity', sql`${t.activity} IN ('viewing','reply','note')`),
    check(
      'ticket_presence_tab',
      sql`${t.tabId} ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'`,
    ),
  ],
);
export const automaticBackupSettings = pgTable(
  'automaticBackupSettings',
  {
    ownerId: text('ownerId')
      .primaryKey()
      .references(() => organizations.ownerId),
    enabled: boolean('enabled').notNull().default(false),
    localTime: text('localTime').notNull().default('03:00'),
    retention: integer('retention').notNull().default(7),
    storageBudgetMiB: integer('storageBudgetMiB').notNull().default(512),
    planReviewedAt: text('planReviewedAt'),
    version: integer('version').notNull().default(0),
    leaseToken: text('leaseToken'),
    leaseUntil: text('leaseUntil'),
    lastErrorCode: text('lastErrorCode'),
    updatedAt: text('updatedAt').notNull(),
  },
  t => [
    check('automatic_backup_time', sql`${t.localTime} ~ '^([01][0-9]|2[0-3]):(00|30)$'`),
    check('automatic_backup_retention', sql`${t.retention} BETWEEN 1 AND 14`),
    check('automatic_backup_budget', sql`${t.storageBudgetMiB} BETWEEN 64 AND 1024`),
    check('automatic_backup_version', sql`${t.version} >= 0`),
  ],
);
export const automaticBackupRuns = pgTable(
  'automaticBackupRuns',
  {
    id: text('id').primaryKey(),
    ownerId: text('ownerId')
      .notNull()
      .references(() => organizations.ownerId),
    environment: text('environment').notNull(),
    localDate: text('localDate').notNull(),
    status: text('status').notNull(),
    attempts: integer('attempts').notNull().default(0),
    keyId: text('keyId'),
    archiveSha256: text('archiveSha256'),
    sizeBytes: integer('sizeBytes'),
    reservedBytes: integer('reservedBytes').notNull().default(33554432),
    rowCount: integer('rowCount'),
    fileCount: integer('fileCount'),
    errorCode: text('errorCode'),
    createdAt: text('createdAt').notNull(),
    updatedAt: text('updatedAt').notNull(),
    uploadedAt: text('uploadedAt'),
    verifiedAt: text('verifiedAt'),
    deletedAt: text('deletedAt'),
  },
  t => [
    uniqueIndex('automatic_backup_daily').on(t.ownerId, t.environment, t.localDate),
    index('automatic_backup_owner_status').on(t.ownerId, t.createdAt),
    check('automatic_backup_environment', sql`${t.environment} IN ('qa','production')`),
    check('automatic_backup_status', sql`${t.status} IN ('processing','complete','failed','deleting','deleted')`),
    check('automatic_backup_attempts', sql`${t.attempts} BETWEEN 0 AND 3`),
    check('automatic_backup_reserved', sql`${t.reservedBytes} BETWEEN 0 AND 33554432`),
    check('automatic_backup_size', sql`${t.sizeBytes} IS NULL OR ${t.sizeBytes} BETWEEN 1 AND 33554432`),
  ],
);
export const automaticBackupUsage = pgTable(
  'automaticBackupUsage',
  {
    ownerId: text('ownerId')
      .notNull()
      .references(() => organizations.ownerId),
    environment: text('environment').notNull(),
    month: text('month').notNull(),
    transferBytes: bigint('transferBytes', { mode: 'number' }).notNull().default(0),
  },
  t => [
    primaryKey({ columns: [t.ownerId, t.environment, t.month] }),
    check('automatic_backup_usage_environment', sql`${t.environment} IN ('qa','production')`),
    check('automatic_backup_usage_bytes', sql`${t.transferBytes} >= 0`),
  ],
);

// Private customer service context; customer portal permissions are never inherited.
export const companyProfiles = pgTable('companyProfiles', {
  companyId: text('companyId')
    .primaryKey()
    .references(() => customerCompanies.id),
  ownerId: text('ownerId').notNull(),
  legalName: text('legalName').notNull().default(''),
  taxId: text('taxId').notNull().default(''),
  industry: text('industry').notNull().default(''),
  website: text('website').notNull().default(''),
  primaryContactMemberId: text('primaryContactMemberId').references(() => members.id),
  notes: text('notes').notNull().default(''),
  version: integer('version').notNull().default(0),
  createdAt: text('createdAt').notNull(),
  updatedAt: text('updatedAt').notNull(),
});
export const companySites = pgTable(
  'companySites',
  {
    id: text('id').primaryKey(),
    ownerId: text('ownerId').notNull(),
    companyId: text('companyId')
      .notNull()
      .references(() => customerCompanies.id),
    name: text('name').notNull(),
    address: text('address').notNull().default(''),
    primaryContactMemberId: text('primaryContactMemberId').references(() => members.id),
    notes: text('notes').notNull().default(''),
    archived: boolean('archived').notNull().default(false),
    version: integer('version').notNull().default(0),
    createdAt: text('createdAt').notNull(),
    updatedAt: text('updatedAt').notNull(),
  },
  t => [index('company_sites_owner_company').on(t.ownerId, t.companyId, t.id)],
);
export const customerAssets = pgTable(
  'customerAssets',
  {
    id: text('id').primaryKey(),
    ownerId: text('ownerId').notNull(),
    companyId: text('companyId')
      .notNull()
      .references(() => customerCompanies.id),
    name: text('name').notNull(),
    category: text('category').notNull().default('Equipo'),
    vendor: text('vendor').notNull().default(''),
    model: text('model').notNull().default(''),
    serial: text('serial').notNull().default(''),
    siteId: text('siteId').references(() => companySites.id),
    assignedContactMemberId: text('assignedContactMemberId').references(() => members.id),
    responsibleMemberId: text('responsibleMemberId').references(() => members.id),
    warrantyUntil: text('warrantyUntil'),
    notes: text('notes').notNull().default(''),
    archived: boolean('archived').notNull().default(false),
    reminderBaselineAt: text('reminderBaselineAt').notNull(),
    version: integer('version').notNull().default(0),
    createdAt: text('createdAt').notNull(),
    updatedAt: text('updatedAt').notNull(),
  },
  t => [
    index('customer_assets_owner_company').on(t.ownerId, t.companyId, t.id),
    check(
      'customer_asset_warranty_date',
      sql`${t.warrantyUntil} IS NULL OR ${t.warrantyUntil} ~ '^\\d{4}-\\d{2}-\\d{2}$'`,
    ),
  ],
);
export const customerServices = pgTable(
  'customerServices',
  {
    id: text('id').primaryKey(),
    ownerId: text('ownerId').notNull(),
    companyId: text('companyId')
      .notNull()
      .references(() => customerCompanies.id),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    responsibleMemberId: text('responsibleMemberId').references(() => members.id),
    notes: text('notes').notNull().default(''),
    archived: boolean('archived').notNull().default(false),
    version: integer('version').notNull().default(0),
    createdAt: text('createdAt').notNull(),
    updatedAt: text('updatedAt').notNull(),
  },
  t => [index('customer_services_owner_company').on(t.ownerId, t.companyId, t.id)],
);
export const serviceContracts = pgTable(
  'serviceContracts',
  {
    id: text('id').primaryKey(),
    ownerId: text('ownerId').notNull(),
    companyId: text('companyId')
      .notNull()
      .references(() => customerCompanies.id),
    name: text('name').notNull(),
    reference: text('reference').notNull().default(''),
    provider: text('provider').notNull().default(''),
    startsOn: text('startsOn').notNull(),
    endsOn: text('endsOn').notNull(),
    renewalOn: text('renewalOn'),
    responsibleMemberId: text('responsibleMemberId').references(() => members.id),
    serviceIdsJson: text('serviceIdsJson').notNull().default('[]'),
    notes: text('notes').notNull().default(''),
    archived: boolean('archived').notNull().default(false),
    reminderBaselineAt: text('reminderBaselineAt').notNull(),
    version: integer('version').notNull().default(0),
    createdAt: text('createdAt').notNull(),
    updatedAt: text('updatedAt').notNull(),
  },
  t => [
    index('service_contracts_owner_company').on(t.ownerId, t.companyId, t.id),
    check(
      'service_contract_dates',
      sql`${t.startsOn} ~ '^\\d{4}-\\d{2}-\\d{2}$' AND ${t.endsOn} ~ '^\\d{4}-\\d{2}-\\d{2}$' AND ${t.endsOn}>=${t.startsOn} AND (${t.renewalOn} IS NULL OR ${t.renewalOn}>=${t.startsOn})`,
    ),
  ],
);
export const ticketServiceContext = pgTable('ticketServiceContext', {
  ticketId: integer('ticketId')
    .primaryKey()
    .references(() => tickets.id),
  ownerId: text('ownerId').notNull(),
  version: integer('version').notNull().default(0),
  updatedAt: text('updatedAt').notNull(),
});
export const ticketAssetLinks = pgTable(
  'ticketAssetLinks',
  {
    ticketId: integer('ticketId')
      .notNull()
      .references(() => tickets.id),
    assetId: text('assetId')
      .notNull()
      .references(() => customerAssets.id),
    ownerId: text('ownerId').notNull(),
    createdAt: text('createdAt').notNull(),
    createdBy: text('createdBy')
      .notNull()
      .references(() => members.id),
  },
  t => [
    primaryKey({ columns: [t.ticketId, t.assetId] }),
    index('ticket_asset_links_asset').on(t.ownerId, t.assetId, t.ticketId),
  ],
);
export const ticketContractLinks = pgTable(
  'ticketContractLinks',
  {
    ticketId: integer('ticketId')
      .notNull()
      .references(() => tickets.id),
    contractId: text('contractId')
      .notNull()
      .references(() => serviceContracts.id),
    ownerId: text('ownerId').notNull(),
    createdAt: text('createdAt').notNull(),
    createdBy: text('createdBy')
      .notNull()
      .references(() => members.id),
  },
  t => [primaryKey({ columns: [t.ticketId, t.contractId] })],
);
export const serviceContextEvents = pgTable(
  'serviceContextEvents',
  {
    id: text('id').primaryKey(),
    ownerId: text('ownerId').notNull(),
    companyId: text('companyId')
      .notNull()
      .references(() => customerCompanies.id),
    resource: text('resource').notNull(),
    resourceId: text('resourceId').notNull(),
    actorMemberId: text('actorMemberId')
      .notNull()
      .references(() => members.id),
    beforeJson: text('beforeJson'),
    afterJson: text('afterJson').notNull(),
    createdAt: text('createdAt').notNull(),
  },
  t => [index('service_context_events_subject').on(t.ownerId, t.resource, t.resourceId, t.createdAt)],
);
export const serviceContextNotificationSettings = pgTable('serviceContextNotificationSettings', {
  ownerId: text('ownerId')
    .primaryKey()
    .references(() => organizations.ownerId),
  enabled: boolean('enabled').notNull().default(false),
  activatedAt: text('activatedAt'),
  version: integer('version').notNull().default(0),
  updatedAt: text('updatedAt').notNull(),
});
export const serviceContextReminders = pgTable(
  'serviceContextReminders',
  {
    id: text('id').primaryKey(),
    ownerId: text('ownerId').notNull(),
    companyId: text('companyId')
      .notNull()
      .references(() => customerCompanies.id),
    recipientMemberId: text('recipientMemberId')
      .notNull()
      .references(() => members.id),
    entityKind: text('entityKind').notNull(),
    entityId: text('entityId').notNull(),
    entityName: text('entityName').notNull(),
    dateValue: text('dateValue').notNull(),
    stage: integer('stage').notNull(),
    activationAt: text('activationAt').notNull(),
    readAt: text('readAt'),
    createdAt: text('createdAt').notNull(),
  },
  t => [
    uniqueIndex('service_context_reminder_stage').on(
      t.ownerId,
      t.recipientMemberId,
      t.entityKind,
      t.entityId,
      t.dateValue,
      t.stage,
    ),
    index('service_context_reminders_member').on(t.ownerId, t.recipientMemberId, t.createdAt, t.id),
    check('service_reminder_kind', sql`${t.entityKind} IN ('asset','contract')`),
    check('service_reminder_stage', sql`${t.stage} IN (30,7,0)`),
  ],
);
export const serviceContextJobHealth = pgTable('serviceContextJobHealth', {
  ownerId: text('ownerId')
    .primaryKey()
    .references(() => organizations.ownerId),
  cursorKey: text('cursorKey').notNull().default(''),
  leaseToken: text('leaseToken'),
  leaseUntil: text('leaseUntil'),
  lastStartedAt: text('lastStartedAt'),
  lastSucceededAt: text('lastSucceededAt'),
  lastFailedAt: text('lastFailedAt'),
  lastErrorCode: text('lastErrorCode'),
  lastInvocationId: text('lastInvocationId'),
});

export const knowledgeArticleRevisions = pgTable(
  'knowledgeArticleRevisions',
  {
    id: text('id').primaryKey(),
    ownerId: text('ownerId').notNull(),
    articleId: integer('articleId')
      .notNull()
      .references(() => articles.id),
    revision: integer('revision').notNull(),
    title: text('title').notNull(),
    category: text('category').notNull(),
    body: text('body').notNull(),
    changeNote: text('changeNote').notNull().default(''),
    origin: text('origin').notNull(),
    createdByMemberId: text('createdByMemberId').references(() => members.id),
    createdAt: text('createdAt').notNull(),
  },
  t => [
    uniqueIndex('knowledgeArticleRevisions_articleId_revision_key').on(t.articleId, t.revision),
    index('knowledge_revisions_owner_article').on(t.ownerId, t.articleId, t.revision.desc()),
    check('knowledgeArticleRevisions_origin_check', sql`${t.origin} IN ('legacy','edit')`),
  ],
);
export const knowledgeArticleReviews = pgTable(
  'knowledgeArticleReviews',
  {
    id: text('id').primaryKey(),
    ownerId: text('ownerId').notNull(),
    articleId: integer('articleId')
      .notNull()
      .references(() => articles.id),
    revisionId: text('revisionId')
      .notNull()
      .references(() => knowledgeArticleRevisions.id),
    status: text('status').notNull(),
    note: text('note').notNull().default(''),
    requestedByMemberId: text('requestedByMemberId')
      .notNull()
      .references(() => members.id),
    reviewerMemberId: text('reviewerMemberId').references(() => members.id),
    requestedAt: text('requestedAt').notNull(),
    decidedAt: text('decidedAt'),
  },
  t => [
    uniqueIndex('knowledge_reviews_pending')
      .on(t.revisionId)
      .where(sql`${t.status}='pending'`),
    index('knowledge_reviews_owner_article').on(t.ownerId, t.articleId, t.requestedAt.desc(), t.id.desc()),
    check('knowledgeArticleReviews_status_check', sql`${t.status} IN ('pending','approved','changes','superseded')`),
  ],
);
export const knowledgeArticlePublications = pgTable(
  'knowledgeArticlePublications',
  {
    id: text('id').primaryKey(),
    ownerId: text('ownerId').notNull(),
    articleId: integer('articleId')
      .notNull()
      .references(() => articles.id),
    revisionId: text('revisionId')
      .notNull()
      .references(() => knowledgeArticleRevisions.id),
    companyId: text('companyId')
      .notNull()
      .references(() => customerCompanies.id),
    active: boolean('active').notNull().default(true),
    publishedByMemberId: text('publishedByMemberId')
      .notNull()
      .references(() => members.id),
    createdAt: text('createdAt').notNull(),
    revokedAt: text('revokedAt'),
  },
  t => [
    uniqueIndex('knowledge_publication_active')
      .on(t.ownerId, t.articleId, t.companyId)
      .where(sql`${t.active}`),
    index('knowledge_publications_company').on(t.ownerId, t.companyId, t.active, t.articleId),
  ],
);
export const knowledgeEvents = pgTable(
  'knowledgeEvents',
  {
    id: text('id').primaryKey(),
    ownerId: text('ownerId').notNull(),
    articleId: integer('articleId')
      .notNull()
      .references(() => articles.id),
    actorMemberId: text('actorMemberId')
      .notNull()
      .references(() => members.id),
    action: text('action').notNull(),
    detailJson: text('detailJson').notNull(),
    createdAt: text('createdAt').notNull(),
  },
  t => [index('knowledge_events_article').on(t.ownerId, t.articleId, t.createdAt.desc(), t.id.desc())],
);
export const companyMonthlyReports = pgTable(
  'companyMonthlyReports',
  {
    id: text('id').primaryKey(),
    ownerId: text('ownerId').notNull(),
    companyId: text('companyId')
      .notNull()
      .references(() => customerCompanies.id),
    month: text('month').notNull(),
    payloadJson: text('payloadJson').notNull(),
    payloadHash: text('payloadHash').notNull(),
    createdByMemberId: text('createdByMemberId')
      .notNull()
      .references(() => members.id),
    createdAt: text('createdAt').notNull(),
  },
  t => [
    index('company_reports_owner_company').on(t.ownerId, t.companyId, t.createdAt.desc(), t.id.desc()),
    check('companyMonthlyReports_month_check', sql`${t.month} ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'`),
  ],
);

export const workOrganizationCatalog = pgTable(
  'workOrganizationCatalog',
  {
    id: text('id').primaryKey(),
    ownerId: text('ownerId')
      .notNull()
      .references(() => organizations.ownerId),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    definitionJson: text('definitionJson').notNull(),
    version: integer('version').notNull().default(0),
    archived: boolean('archived').notNull().default(false),
    createdAt: text('createdAt').notNull(),
    updatedAt: text('updatedAt').notNull(),
  },
  t => [
    index('work_organization_catalog_owner_kind').on(t.ownerId, t.kind, t.archived, t.name, t.id),
    uniqueIndex('work_organization_catalog_active_name')
      .on(t.ownerId, t.kind, sql`lower(${t.name})`)
      .where(sql`NOT ${t.archived}`),
    check('work_organization_catalog_kind', sql`${t.kind} IN ('tag','requestType','field','form')`),
  ],
);
export const workOrganizationRevisions = pgTable(
  'workOrganizationRevisions',
  {
    catalogId: text('catalogId')
      .notNull()
      .references(() => workOrganizationCatalog.id),
    version: integer('version').notNull(),
    ownerId: text('ownerId').notNull(),
    definitionJson: text('definitionJson').notNull(),
    createdAt: text('createdAt').notNull(),
  },
  t => [primaryKey({ columns: [t.catalogId, t.version] })],
);
export const ticketOrganization = pgTable(
  'ticketOrganization',
  {
    ticketId: integer('ticketId')
      .primaryKey()
      .references(() => tickets.id),
    ownerId: text('ownerId').notNull(),
    metadataJson: text('metadataJson').notNull(),
    tagIdsJson: text('tagIdsJson').notNull().default('[]'),
    waitReason: text('waitReason').notNull().default(''),
    version: integer('version').notNull().default(0),
    updatedAt: text('updatedAt').notNull(),
  },
  t => [index('ticket_organization_owner').on(t.ownerId, t.ticketId)],
);
export const ticketTasks = pgTable(
  'ticketTasks',
  {
    id: text('id').primaryKey(),
    ownerId: text('ownerId').notNull(),
    ticketId: integer('ticketId')
      .notNull()
      .references(() => tickets.id),
    createdByMemberId: text('createdByMemberId')
      .notNull()
      .references(() => members.id),
    operationId: text('operationId').notNull(),
    requestHash: text('requestHash').notNull(),
    title: text('title').notNull(),
    assigneeMemberId: text('assigneeMemberId').references(() => members.id),
    dueAt: text('dueAt'),
    status: text('status').notNull().default('open'),
    version: integer('version').notNull().default(0),
    createdAt: text('createdAt').notNull(),
    updatedAt: text('updatedAt').notNull(),
  },
  t => [
    uniqueIndex('ticket_tasks_operation').on(t.ownerId, t.operationId),
    index('ticket_tasks_owner_ticket').on(t.ownerId, t.ticketId, t.createdAt.desc(), t.id.desc()),
    index('ticket_tasks_assignee').on(t.ownerId, t.assigneeMemberId, t.status, t.dueAt),
    check('ticket_tasks_status', sql`${t.status} IN ('open','done','cancelled')`),
  ],
);
export const savedTicketViews = pgTable(
  'savedTicketViews',
  {
    id: text('id').primaryKey(),
    ownerId: text('ownerId').notNull(),
    memberId: text('memberId')
      .notNull()
      .references(() => members.id),
    name: text('name').notNull(),
    filtersJson: text('filtersJson').notNull(),
    version: integer('version').notNull().default(0),
    createdAt: text('createdAt').notNull(),
    updatedAt: text('updatedAt').notNull(),
  },
  t => [
    uniqueIndex('saved_ticket_views_name').on(t.memberId, t.name),
    index('saved_ticket_views_member').on(t.ownerId, t.memberId, t.name, t.id),
  ],
);

export const automationSettings = pgTable('automationSettings', {
  ownerId: text('ownerId')
    .primaryKey()
    .references(() => organizations.ownerId),
  enabled: boolean('enabled').notNull().default(false),
  activatedAt: text('activatedAt'),
  version: integer('version').notNull().default(0),
  updatedAt: text('updatedAt').notNull(),
});
export const taskTemplates = pgTable(
  'taskTemplates',
  {
    id: text('id').primaryKey(),
    ownerId: text('ownerId')
      .notNull()
      .references(() => organizations.ownerId),
    name: text('name').notNull(),
    itemsJson: text('itemsJson').notNull(),
    version: integer('version').notNull().default(0),
    archived: boolean('archived').notNull().default(false),
    updatedByMemberId: text('updatedByMemberId')
      .notNull()
      .references(() => members.id),
    createdAt: text('createdAt').notNull(),
    updatedAt: text('updatedAt').notNull(),
  },
  t => [
    index('task_templates_owner').on(t.ownerId, t.archived, t.name, t.id),
    uniqueIndex('task_templates_active_name')
      .on(t.ownerId, sql`lower(${t.name})`)
      .where(sql`NOT ${t.archived}`),
  ],
);
export const automationRules = pgTable(
  'automationRules',
  {
    id: text('id').primaryKey(),
    ownerId: text('ownerId')
      .notNull()
      .references(() => organizations.ownerId),
    name: text('name').notNull(),
    conditionsJson: text('conditionsJson').notNull(),
    actionsJson: text('actionsJson').notNull(),
    referencesHash: text('referencesHash').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    position: integer('position').notNull().default(0),
    version: integer('version').notNull().default(0),
    archived: boolean('archived').notNull().default(false),
    enabledAt: text('enabledAt'),
    updatedByMemberId: text('updatedByMemberId')
      .notNull()
      .references(() => members.id),
    createdAt: text('createdAt').notNull(),
    updatedAt: text('updatedAt').notNull(),
  },
  t => [
    index('automation_rules_owner').on(t.ownerId, t.enabled, t.archived, t.position, t.id),
    uniqueIndex('automation_rules_active_name')
      .on(t.ownerId, sql`lower(${t.name})`)
      .where(sql`NOT ${t.archived}`),
  ],
);
export const automationRuleVersions = pgTable(
  'automationRuleVersions',
  {
    id: text('id').primaryKey(),
    ownerId: text('ownerId')
      .notNull()
      .references(() => organizations.ownerId),
    ruleId: text('ruleId')
      .notNull()
      .references(() => automationRules.id),
    version: integer('version').notNull(),
    snapshotJson: text('snapshotJson').notNull(),
    changedByMemberId: text('changedByMemberId')
      .notNull()
      .references(() => members.id),
    createdAt: text('createdAt').notNull(),
  },
  t => [
    uniqueIndex('automation_rule_versions_unique').on(t.ruleId, t.version),
    index('automation_rule_versions_owner').on(t.ownerId, t.ruleId, t.version.desc()),
  ],
);
export const automationEvents = pgTable(
  'automationEvents',
  {
    id: text('id').primaryKey(),
    ownerId: text('ownerId')
      .notNull()
      .references(() => organizations.ownerId),
    ticketId: integer('ticketId')
      .notNull()
      .references(() => tickets.id),
    operationKey: text('operationKey').notNull(),
    eventKind: text('eventKind').notNull(),
    actorMemberId: text('actorMemberId').references(() => members.id),
    requestHash: text('requestHash').notNull(),
    activationVersion: integer('activationVersion').notNull(),
    status: text('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: text('nextAttemptAt').notNull(),
    lastErrorCode: text('lastErrorCode'),
    createdAt: text('createdAt').notNull(),
    updatedAt: text('updatedAt').notNull(),
  },
  t => [
    uniqueIndex('automation_events_operation').on(t.ownerId, t.operationKey, t.eventKind),
    index('automation_events_pending').on(t.ownerId, t.status, t.nextAttemptAt, t.createdAt, t.id),
    check('automation_events_status', sql`${t.status} IN ('queued','done','cancelled','failed')`),
  ],
);
export const automationExecutions = pgTable(
  'automationExecutions',
  {
    id: text('id').primaryKey(),
    ownerId: text('ownerId').notNull(),
    eventId: text('eventId')
      .notNull()
      .references(() => automationEvents.id),
    ticketId: integer('ticketId')
      .notNull()
      .references(() => tickets.id),
    ruleId: text('ruleId').references(() => automationRules.id),
    ruleKey: text('ruleKey').notNull(),
    ruleVersion: integer('ruleVersion').notNull(),
    ruleName: text('ruleName').notNull(),
    status: text('status').notNull(),
    summaryJson: text('summaryJson').notNull(),
    attempts: integer('attempts').notNull().default(1),
    createdAt: text('createdAt').notNull(),
    updatedAt: text('updatedAt').notNull(),
  },
  t => [
    uniqueIndex('automation_executions_event_rule').on(t.eventId, t.ruleKey, t.ruleVersion),
    index('automation_executions_owner').on(t.ownerId, t.createdAt.desc(), t.id.desc()),
    check('automation_executions_status', sql`${t.status} IN ('applied','skipped','failed')`),
  ],
);
export const automationJobHealth = pgTable('automationJobHealth', {
  ownerId: text('ownerId')
    .primaryKey()
    .references(() => organizations.ownerId),
  lastStartedAt: text('lastStartedAt'),
  lastSucceededAt: text('lastSucceededAt'),
  lastFailedAt: text('lastFailedAt'),
  lastErrorCode: text('lastErrorCode'),
  processedEvents: integer('processedEvents').notNull().default(0),
  updatedAt: text('updatedAt').notNull(),
});
export const ticketRelations = pgTable(
  'ticketRelations',
  {
    id: text('id').primaryKey(),
    ownerId: text('ownerId').notNull(),
    sourceTicketId: integer('sourceTicketId')
      .notNull()
      .references(() => tickets.id),
    targetTicketId: integer('targetTicketId')
      .notNull()
      .references(() => tickets.id),
    kind: text('kind').notNull(),
    createdByMemberId: text('createdByMemberId')
      .notNull()
      .references(() => members.id),
    operationId: text('operationId').notNull(),
    requestHash: text('requestHash').notNull(),
    version: integer('version').notNull().default(0),
    archived: boolean('archived').notNull().default(false),
    createdAt: text('createdAt').notNull(),
    updatedAt: text('updatedAt').notNull(),
  },
  t => [
    uniqueIndex('ticket_relations_operation').on(t.ownerId, t.operationId),
    uniqueIndex('ticket_relations_active_pair')
      .on(t.ownerId, t.sourceTicketId, t.targetTicketId, t.kind)
      .where(sql`NOT ${t.archived}`),
    uniqueIndex('ticket_relations_one_principal')
      .on(t.ownerId, t.sourceTicketId)
      .where(sql`NOT ${t.archived} AND ${t.kind}='duplicate'`),
    index('ticket_relations_owner_target').on(t.ownerId, t.targetTicketId, t.archived, t.id),
    check('ticket_relations_kind', sql`${t.kind} IN ('related','duplicate')`),
    check('ticket_relations_different', sql`${t.sourceTicketId}<>${t.targetTicketId}`),
  ],
);
export const messageMentions = pgTable(
  'messageMentions',
  {
    ownerId: text('ownerId').notNull(),
    messageId: integer('messageId')
      .notNull()
      .references(() => messages.id),
    memberId: text('memberId')
      .notNull()
      .references(() => members.id),
    createdAt: text('createdAt').notNull(),
  },
  t => [
    primaryKey({ columns: [t.messageId, t.memberId] }),
    index('message_mentions_recipient').on(t.ownerId, t.memberId, t.messageId),
  ],
);
export const ticketFollowers = pgTable(
  'ticketFollowers',
  {
    ownerId: text('ownerId').notNull(),
    ticketId: integer('ticketId')
      .notNull()
      .references(() => tickets.id),
    memberId: text('memberId')
      .notNull()
      .references(() => members.id),
    createdAt: text('createdAt').notNull(),
  },
  t => [primaryKey({ columns: [t.ticketId, t.memberId] }), index('ticket_followers_owner').on(t.ownerId, t.memberId)],
);
export const evolutionFeatures = pgTable('evolutionFeatures', {
  ownerId: text('ownerId')
    .primaryKey()
    .references(() => organizations.ownerId),
  featuresJson: text('featuresJson').notNull().default('{}'),
  version: integer('version').notNull().default(0),
  updatedAt: text('updatedAt').notNull(),
});
export const userPreferences = pgTable(
  'userPreferences',
  {
    userId: text('userId')
      .primaryKey()
      .references(() => preferenceUser.id),
    theme: text('theme').notNull().default('system'),
    updatedAt: text('updatedAt').notNull(),
  },
  t => [check('user_preferences_theme', sql`${t.theme} IN ('system','light','dark')`)],
);

export const securityPolicies = pgTable(
  'securityPolicies',
  {
    ownerId: text('ownerId')
      .primaryKey()
      .references(() => organizations.ownerId),
    requireStaffMfa: boolean('requireStaffMfa').notNull().default(false),
    activatedAt: text('activatedAt'),
    version: integer('version').notNull().default(0),
    updatedAt: text('updatedAt').notNull(),
  },
  t => [check('security_policy_version', sql`${t.version} >= 0`)],
);
export const securityAudit = pgTable(
  'securityAudit',
  {
    id: text('id').primaryKey(),
    ownerId: text('ownerId')
      .notNull()
      .references(() => organizations.ownerId),
    actorMemberId: text('actorMemberId'),
    actorUserId: text('actorUserId').notNull(),
    actorName: text('actorName').notNull(),
    action: text('action').notNull(),
    targetId: text('targetId'),
    createdAt: text('createdAt').notNull(),
  },
  t => [index('security_audit_page').on(t.ownerId, t.createdAt.desc(), t.id.desc())],
);

export const workspaceProfiles = pgTable('workspaceProfiles', {
  workspaceId: text('workspaceId')
    .primaryKey()
    .references(() => organizations.id),
  ownerId: text('ownerId')
    .notNull()
    .unique()
    .references(() => organizations.ownerId),
  state: text('state').notNull().default('draft'),
  brandName: text('brandName').notNull(),
  mailFrom: text('mailFrom'),
  mailEnabled: boolean('mailEnabled').notNull().default(false),
  inboundEnabled: boolean('inboundEnabled').notNull().default(false),
  limitsJson: text('limitsJson').notNull(),
  version: integer('version').notNull().default(0),
  quotaEpoch: bigint('quotaEpoch', { mode: 'number' }).notNull().default(0),
  createdAt: text('createdAt').notNull(),
  updatedAt: text('updatedAt').notNull(),
  lastJobAt: text('lastJobAt'),
});
