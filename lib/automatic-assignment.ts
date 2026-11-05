import type { PoolClient } from 'pg';
import { acquireTicketWorkLock } from './work-lock';

export interface AssignmentRule {
  id: string;
  name: string;
  customerCompanyId: string | null;
  department: string | null;
  enabled: boolean;
  position: number;
  agentMemberIds: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface AssignmentRuleRecord extends Omit<AssignmentRule, 'agentMemberIds'> {
  agentMemberIdsJson: string;
}

export interface AssignmentCandidate {
  id: string;
  name: string;
  role: string;
  status: string;
  hasAccount: boolean;
  available: boolean;
  capacity: number;
  openTickets: number;
  lastAssignedAt: string | null;
}

export interface AssignmentTicketScope {
  customerCompanyId: string | null;
  department: string;
}

export interface AutomaticAssignee { id: string; name: string; ruleId: string }

export function publicAssignmentRule(row: AssignmentRuleRecord): AssignmentRule {
  let ids: unknown;
  try { ids = JSON.parse(row.agentMemberIdsJson); } catch { ids = []; }
  const { agentMemberIdsJson: _internal, ...rest } = row;
  void _internal;
  return { ...rest, agentMemberIds: Array.isArray(ids) && ids.every(id => typeof id === 'string') ? [...new Set(ids)] : [] };
}

/** A deliberate rule order is authoritative. An unavailable first match must
 * remain unassigned, rather than silently route to a less specific rule. */
export function matchingAssignmentRule(rules: AssignmentRule[], ticket: AssignmentTicketScope): AssignmentRule | null {
  return rules.filter(rule => rule.enabled
    && (rule.customerCompanyId === null || rule.customerCompanyId === ticket.customerCompanyId)
    && (rule.department === null || rule.department === ticket.department))
    .sort((a, b) => a.position - b.position || compareIds(a.id, b.id))[0] ?? null;
}

function compareIds(a: string, b: string) { return a < b ? -1 : a > b ? 1 : 0; }
function lastAssignment(value: string | null): number {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? time : -Infinity;
}

/** Capacity limits only the automatic choice. Manual assignments remain an
 * explicit team decision; unavailable agents keep their existing tickets. */
export function selectAutomaticAssignee(rules: AssignmentRule[], candidates: AssignmentCandidate[], ticket: AssignmentTicketScope): AutomaticAssignee | null {
  const rule = matchingAssignmentRule(rules, ticket);
  if (!rule) return null;
  const allowed = new Set(rule.agentMemberIds);
  const chosen = candidates.filter(candidate => allowed.has(candidate.id)
    && candidate.status === 'active' && ['owner', 'admin', 'agent'].includes(candidate.role)
    && candidate.hasAccount && candidate.available
    && Number.isInteger(candidate.openTickets) && candidate.openTickets >= 0
    && Number.isInteger(candidate.capacity) && candidate.capacity >= 1 && candidate.openTickets < candidate.capacity)
    .sort((a, b) => a.openTickets - b.openTickets
      || lastAssignment(a.lastAssignedAt) - lastAssignment(b.lastAssignedAt)
      || compareIds(a.id, b.id))[0];
  return chosen ? { id: chosen.id, name: chosen.name, ruleId: rule.id } : null;
}

/** Call inside the creation transaction. The caller takes this SAME owner lock
 * before its actor membership lock, sharing the order with all ticket writers.
 * Holding it through insertion makes concurrent load choices serializable. */
export async function chooseAutomaticAssignee(tx: PoolClient, ownerId: string, ticket: AssignmentTicketScope, now: string): Promise<AutomaticAssignee | null> {
  await acquireTicketWorkLock(tx, ownerId);
  const { rows: rules } = await tx.query<AssignmentRuleRecord>(`SELECT id,name,"customerCompanyId",department,enabled,position,
    "agentMemberIdsJson",version,"createdAt","updatedAt" FROM "assignmentRules"
    WHERE "ownerId"=$1 AND enabled=true AND ("customerCompanyId" IS NULL OR "customerCompanyId"=$2)
      AND (department IS NULL OR department=$3) ORDER BY position,id LIMIT 1 FOR SHARE`,
  [ownerId, ticket.customerCompanyId, ticket.department]);
  if (!rules.length) return null;
  const rule = publicAssignmentRule(rules[0]);
  if (!rule.agentMemberIds.length || rule.agentMemberIds.length > 50) return null;
  const { rows: candidates } = await tx.query<AssignmentCandidate>(`SELECT m.id,m.name,m.role,m.status,(m."userId" IS NOT NULL) AS "hasAccount",
    COALESCE(a.available,true) AS available,COALESCE(a.capacity,20) AS capacity,a."lastAssignedAt",
    (SELECT count(*)::integer FROM tickets t WHERE t."ownerId"=$1 AND t."assigneeMemberId"=m.id
      AND t.status IN ('open','pending')) AS "openTickets"
    FROM members m LEFT JOIN "agentAvailability" a ON a."memberId"=m.id AND a."ownerId"=m."ownerId"
    WHERE m."ownerId"=$1 AND m.id=ANY($2::text[]) AND m.status='active'
      AND m.role IN ('owner','admin','agent') AND m."userId" IS NOT NULL ORDER BY m.id FOR SHARE OF m`,
  [ownerId, rule.agentMemberIds]);
  const selected = selectAutomaticAssignee([rule], candidates, ticket);
  if (!selected) return null;
  // This timestamp is a routing tie breaker, not a user configuration edit.
  // Do not increment version or overwrite availability/capacity on conflict.
  await tx.query(`INSERT INTO "agentAvailability" ("memberId","ownerId",available,capacity,version,"lastAssignedAt","updatedAt")
    VALUES ($1,$2,true,20,0,$3,$3) ON CONFLICT ("memberId") DO UPDATE SET "lastAssignedAt"=EXCLUDED."lastAssignedAt"
      WHERE "agentAvailability"."ownerId"=EXCLUDED."ownerId"`, [selected.id, ownerId, now]);
  return selected;
}
