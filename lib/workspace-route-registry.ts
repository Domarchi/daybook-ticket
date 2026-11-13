// Explicit reviewed endpoint registry. Never dispatch auth, setup, provider webhooks, internal jobs or platform backups.
import * as r0 from '@/app/api/agent-availability/route';
import * as r1 from '@/app/api/alerts/route';
import * as r2 from '@/app/api/articles/[id]/route';
import * as r3 from '@/app/api/articles/route';
import * as r4 from '@/app/api/assignment-rules/[id]/route';
import * as r5 from '@/app/api/assignment-rules/route';
import * as r6 from '@/app/api/attachments/[id]/complete/route';
import * as r7 from '@/app/api/attachments/[id]/download/route';
import * as r8 from '@/app/api/attachments/[id]/preview/route';
import * as r9 from '@/app/api/attachments/[id]/route';
import * as r10 from '@/app/api/attachments/cleanup/route';
import * as r11 from '@/app/api/attachments/reserve/route';
import * as r12 from '@/app/api/attachments/route';
import * as r13 from '@/app/api/attachments/upload/route';
import * as r14 from '@/app/api/companies/[id]/route';
import * as r15 from '@/app/api/companies/route';
import * as r16 from '@/app/api/email-inbound/[id]/retry/route';
import * as r17 from '@/app/api/email-inbound/route';
import * as r18 from '@/app/api/escalations/route';
import * as r19 from '@/app/api/evolution/features/route';
import * as r20 from '@/app/api/members/[id]/invite/route';
import * as r21 from '@/app/api/members/[id]/route';
import * as r22 from '@/app/api/members/route';
import * as r23 from '@/app/api/metrics/agents/route';
import * as r24 from '@/app/api/notifications/process/route';
import * as r25 from '@/app/api/notifications/route';
import * as r26 from '@/app/api/notifications/settings/route';
import * as r27 from '@/app/api/push/diagnostics/route';
import * as r28 from '@/app/api/push/receipt/route';
import * as r29 from '@/app/api/push/route';
import * as r30 from '@/app/api/push/test/route';
import * as r31 from '@/app/api/satisfaction/route';
import * as r32 from '@/app/api/saved-replies/[id]/route';
import * as r33 from '@/app/api/saved-replies/route';
import * as r34 from '@/app/api/security/audit/route';
import * as r35 from '@/app/api/security/export/route';
import * as r36 from '@/app/api/security/health/route';
import * as r37 from '@/app/api/security/policy/route';
import * as r38 from '@/app/api/security/route';
import * as r39 from '@/app/api/security/sessions/route';
import * as r40 from '@/app/api/service-policies/[scope]/route';
import * as r41 from '@/app/api/service-policies/route';
import * as r42 from '@/app/api/settings/route';
import * as r43 from '@/app/api/tickets/[id]/claim/route';
import * as r44 from '@/app/api/tickets/[id]/conversation/route';
import * as r45 from '@/app/api/tickets/[id]/events/route';
import * as r46 from '@/app/api/tickets/[id]/mail-delivery/route';
import * as r47 from '@/app/api/tickets/[id]/messages/route';
import * as r48 from '@/app/api/tickets/[id]/presence/route';
import * as r49 from '@/app/api/tickets/[id]/progress/route';
import * as r50 from '@/app/api/tickets/[id]/route';
import * as r51 from '@/app/api/tickets/[id]/satisfaction/route';
import * as r52 from '@/app/api/tickets/contacts/route';
import * as r53 from '@/app/api/tickets/route';
import * as r54 from '@/app/api/tickets/search/route';
import * as r55 from '@/app/api/tickets/updates/route';
import * as r56 from '@/app/api/workspace/route';
import * as evolution0 from '@/app/api/automation/executions/route';
import * as evolution1 from '@/app/api/automation/rules/[id]/versions/route';
import * as evolution2 from '@/app/api/automation/rules/route';
import * as evolution3 from '@/app/api/automation/settings/route';
import * as evolution4 from '@/app/api/automation/simulate/route';
import * as evolution5 from '@/app/api/organization/catalog/route';
import * as evolution6 from '@/app/api/saved-views/[id]/route';
import * as evolution7 from '@/app/api/saved-views/route';
import * as evolution8 from '@/app/api/service-context/[resource]/[id]/route';
import * as evolution9 from '@/app/api/service-context/assets/[id]/tickets/route';
import * as evolution10 from '@/app/api/service-context/contracts/[id]/documents/route';
import * as evolution11 from '@/app/api/service-context/route';
import * as evolution12 from '@/app/api/task-templates/route';
import * as evolution13 from '@/app/api/ticket-tasks/[id]/route';
import * as evolution14 from '@/app/api/tickets/[id]/files/route';
import * as evolution15 from '@/app/api/tickets/[id]/followers/route';
import * as evolution16 from '@/app/api/tickets/[id]/messages/[messageId]/route';
import * as evolution17 from '@/app/api/tickets/[id]/messages/search/route';
import * as evolution18 from '@/app/api/tickets/[id]/organization/route';
import * as evolution19 from '@/app/api/tickets/[id]/relations/route';
import * as evolution20 from '@/app/api/tickets/[id]/service-context/route';
import * as evolution21 from '@/app/api/tickets/[id]/task-templates/route';
import * as evolution22 from '@/app/api/tickets/[id]/tasks/route';
import * as knowledge0 from '@/app/api/knowledge/[id]/publications/route';
import * as knowledge1 from '@/app/api/knowledge/[id]/review/route';
import * as knowledge2 from '@/app/api/knowledge/[id]/route';
import * as knowledge3 from '@/app/api/knowledge/route';
import * as knowledge4 from '@/app/api/knowledge/suggestions/route';
import * as knowledge5 from '@/app/api/reports/company/route';
import * as knowledge6 from '@/app/api/reports/monthly/[id]/download/route';
import * as knowledge7 from '@/app/api/reports/monthly/[id]/route';
import * as knowledge8 from '@/app/api/reports/monthly/route';
import * as equipment0 from '@/app/api/equipment/[id]/route';
import * as equipment1 from '@/app/api/equipment/route';
import * as equipment2 from '@/app/api/equipment/mine/route';
import * as equipment3 from '@/app/api/tickets/[id]/equipment/route';
import * as fulfillment0 from '@/app/api/tickets/[id]/fulfillment/route';
import * as fulfillment1 from '@/app/api/fulfillments/route';
import * as fulfillment2 from '@/app/api/fulfillments/mine/route';
import * as fulfillment3 from '@/app/api/tickets/[id]/fulfillment/receipt/route';
import * as backfill0 from '@/app/api/tickets/classify/route';
export const WORKSPACE_ROUTE_REGISTRY = [
  { pattern: new RegExp('^knowledge/([^/]+)/publications$'), names: ['id'], handlers: knowledge0 },
  { pattern: new RegExp('^knowledge/([^/]+)/review$'), names: ['id'], handlers: knowledge1 },
  { pattern: new RegExp('^knowledge/([^/]+)$'), names: ['id'], handlers: knowledge2 },
  { pattern: new RegExp('^knowledge$'), names: [], handlers: knowledge3 },
  { pattern: new RegExp('^knowledge/suggestions$'), names: [], handlers: knowledge4 },
  { pattern: new RegExp('^reports/company$'), names: [], handlers: knowledge5 },
  { pattern: new RegExp('^reports/monthly/([^/]+)/download$'), names: ['id'], handlers: knowledge6 },
  { pattern: new RegExp('^reports/monthly/([^/]+)$'), names: ['id'], handlers: knowledge7 },
  { pattern: new RegExp('^reports/monthly$'), names: [], handlers: knowledge8 },
  { pattern: new RegExp('^automation/executions$'), names: [], handlers: evolution0 },
  { pattern: new RegExp('^automation/rules/([^/]+)/versions$'), names: ['id'], handlers: evolution1 },
  { pattern: new RegExp('^automation/rules$'), names: [], handlers: evolution2 },
  { pattern: new RegExp('^automation/settings$'), names: [], handlers: evolution3 },
  { pattern: new RegExp('^automation/simulate$'), names: [], handlers: evolution4 },
  { pattern: new RegExp('^organization/catalog$'), names: [], handlers: evolution5 },
  { pattern: new RegExp('^saved-views/([^/]+)$'), names: ['id'], handlers: evolution6 },
  { pattern: new RegExp('^saved-views$'), names: [], handlers: evolution7 },
  { pattern: new RegExp('^service-context/([^/]+)/([^/]+)$'), names: ['resource', 'id'], handlers: evolution8 },
  { pattern: new RegExp('^service-context/assets/([^/]+)/tickets$'), names: ['id'], handlers: evolution9 },
  { pattern: new RegExp('^service-context/contracts/([^/]+)/documents$'), names: ['id'], handlers: evolution10 },
  { pattern: new RegExp('^service-context$'), names: [], handlers: evolution11 },
  { pattern: new RegExp('^task-templates$'), names: [], handlers: evolution12 },
  { pattern: new RegExp('^ticket-tasks/([^/]+)$'), names: ['id'], handlers: evolution13 },
  { pattern: new RegExp('^tickets/([^/]+)/files$'), names: ['id'], handlers: evolution14 },
  { pattern: new RegExp('^tickets/([^/]+)/followers$'), names: ['id'], handlers: evolution15 },
  { pattern: new RegExp('^tickets/([^/]+)/messages/([^/]+)$'), names: ['id', 'messageId'], handlers: evolution16 },
  { pattern: new RegExp('^tickets/([^/]+)/messages/search$'), names: ['id'], handlers: evolution17 },
  { pattern: new RegExp('^tickets/([^/]+)/organization$'), names: ['id'], handlers: evolution18 },
  { pattern: new RegExp('^tickets/([^/]+)/relations$'), names: ['id'], handlers: evolution19 },
  { pattern: new RegExp('^tickets/([^/]+)/service-context$'), names: ['id'], handlers: evolution20 },
  { pattern: new RegExp('^tickets/([^/]+)/task-templates$'), names: ['id'], handlers: evolution21 },
  { pattern: new RegExp('^tickets/([^/]+)/tasks$'), names: ['id'], handlers: evolution22 },
  { pattern: new RegExp('^agent-availability$'), names: [], handlers: r0 },
  { pattern: new RegExp('^alerts$'), names: [], handlers: r1 },
  { pattern: new RegExp('^articles/([^/]+)$'), names: ['id'], handlers: r2 },
  { pattern: new RegExp('^articles$'), names: [], handlers: r3 },
  { pattern: new RegExp('^assignment-rules/([^/]+)$'), names: ['id'], handlers: r4 },
  { pattern: new RegExp('^assignment-rules$'), names: [], handlers: r5 },
  { pattern: new RegExp('^attachments/([^/]+)/complete$'), names: ['id'], handlers: r6 },
  { pattern: new RegExp('^attachments/([^/]+)/download$'), names: ['id'], handlers: r7 },
  { pattern: new RegExp('^attachments/([^/]+)/preview$'), names: ['id'], handlers: r8 },
  { pattern: new RegExp('^attachments/([^/]+)$'), names: ['id'], handlers: r9 },
  { pattern: new RegExp('^attachments/cleanup$'), names: [], handlers: r10 },
  { pattern: new RegExp('^attachments/reserve$'), names: [], handlers: r11 },
  { pattern: new RegExp('^attachments$'), names: [], handlers: r12 },
  { pattern: new RegExp('^attachments/upload$'), names: [], handlers: r13 },
  { pattern: new RegExp('^companies/([^/]+)$'), names: ['id'], handlers: r14 },
  { pattern: new RegExp('^companies$'), names: [], handlers: r15 },
  { pattern: new RegExp('^email-inbound/([^/]+)/retry$'), names: ['id'], handlers: r16 },
  { pattern: new RegExp('^email-inbound$'), names: [], handlers: r17 },
  { pattern: new RegExp('^equipment/mine$'), names: [], handlers: equipment2 },
  { pattern: new RegExp('^tickets/([^/]+)/fulfillment$'), names: ['id'], handlers: fulfillment0 },
  { pattern: new RegExp('^tickets/([^/]+)/fulfillment/receipt$'), names: ['id'], handlers: fulfillment3 },
  { pattern: new RegExp('^tickets/classify$'), names: [], handlers: backfill0 },
  { pattern: new RegExp('^fulfillments$'), names: [], handlers: fulfillment1 },
  { pattern: new RegExp('^fulfillments/mine$'), names: [], handlers: fulfillment2 },
  { pattern: new RegExp('^tickets/([^/]+)/equipment$'), names: ['id'], handlers: equipment3 },
  { pattern: new RegExp('^equipment/([^/]+)$'), names: ['id'], handlers: equipment0 },
  { pattern: new RegExp('^equipment$'), names: [], handlers: equipment1 },
  { pattern: new RegExp('^escalations$'), names: [], handlers: r18 },
  { pattern: new RegExp('^evolution/features$'), names: [], handlers: r19 },
  { pattern: new RegExp('^members/([^/]+)/invite$'), names: ['id'], handlers: r20 },
  { pattern: new RegExp('^members/([^/]+)$'), names: ['id'], handlers: r21 },
  { pattern: new RegExp('^members$'), names: [], handlers: r22 },
  { pattern: new RegExp('^metrics/agents$'), names: [], handlers: r23 },
  { pattern: new RegExp('^notifications/process$'), names: [], handlers: r24 },
  { pattern: new RegExp('^notifications$'), names: [], handlers: r25 },
  { pattern: new RegExp('^notifications/settings$'), names: [], handlers: r26 },
  { pattern: new RegExp('^push/diagnostics$'), names: [], handlers: r27 },
  { pattern: new RegExp('^push/receipt$'), names: [], handlers: r28 },
  { pattern: new RegExp('^push$'), names: [], handlers: r29 },
  { pattern: new RegExp('^push/test$'), names: [], handlers: r30 },
  { pattern: new RegExp('^satisfaction$'), names: [], handlers: r31 },
  { pattern: new RegExp('^saved-replies/([^/]+)$'), names: ['id'], handlers: r32 },
  { pattern: new RegExp('^saved-replies$'), names: [], handlers: r33 },
  { pattern: new RegExp('^security/audit$'), names: [], handlers: r34 },
  { pattern: new RegExp('^security/export$'), names: [], handlers: r35 },
  { pattern: new RegExp('^security/health$'), names: [], handlers: r36 },
  { pattern: new RegExp('^security/policy$'), names: [], handlers: r37 },
  { pattern: new RegExp('^security$'), names: [], handlers: r38 },
  { pattern: new RegExp('^security/sessions$'), names: [], handlers: r39 },
  { pattern: new RegExp('^service-policies/([^/]+)$'), names: ['scope'], handlers: r40 },
  { pattern: new RegExp('^service-policies$'), names: [], handlers: r41 },
  { pattern: new RegExp('^settings$'), names: [], handlers: r42 },
  { pattern: new RegExp('^tickets/([^/]+)/claim$'), names: ['id'], handlers: r43 },
  { pattern: new RegExp('^tickets/([^/]+)/conversation$'), names: ['id'], handlers: r44 },
  { pattern: new RegExp('^tickets/([^/]+)/events$'), names: ['id'], handlers: r45 },
  { pattern: new RegExp('^tickets/([^/]+)/mail-delivery$'), names: ['id'], handlers: r46 },
  { pattern: new RegExp('^tickets/([^/]+)/messages$'), names: ['id'], handlers: r47 },
  { pattern: new RegExp('^tickets/([^/]+)/presence$'), names: ['id'], handlers: r48 },
  { pattern: new RegExp('^tickets/([^/]+)/progress$'), names: ['id'], handlers: r49 },
  { pattern: new RegExp('^tickets/([^/]+)$'), names: ['id'], handlers: r50 },
  { pattern: new RegExp('^tickets/([^/]+)/satisfaction$'), names: ['id'], handlers: r51 },
  { pattern: new RegExp('^tickets/contacts$'), names: [], handlers: r52 },
  { pattern: new RegExp('^tickets$'), names: [], handlers: r53 },
  { pattern: new RegExp('^tickets/search$'), names: [], handlers: r54 },
  { pattern: new RegExp('^tickets/updates$'), names: [], handlers: r55 },
  { pattern: new RegExp('^workspace$'), names: [], handlers: r56 },
].sort((left, right) => left.names.length - right.names.length);
