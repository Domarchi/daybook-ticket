import { ticketAccessSql, type AccessContext } from './access';
import type { DatabaseValue } from '@/db/database';

/** Reject reads from a membership snapshot that was revoked or changed meanwhile. */
export function ticketReadScope(access: AccessContext) {
  const scope = ticketAccessSql(access);
  const values: DatabaseValue[] = [...scope.values];
  const bind = (value: DatabaseValue) => { values.push(value); return `$${values.length}`; };
  const member = bind(access.member.id), role = bind(access.role), company = bind(access.member.customerCompanyId ?? null), permission = bind(access.member.companyAccess);
  const organization = bind(access.organizationId), user = bind(access.userId);
  const sql = `(${scope.sql}) AND EXISTS (SELECT 1 FROM members live WHERE live.id=${member} AND live."ownerId"=t."ownerId" AND live."organizationId"=${organization} AND live."userId"=${user} AND live.status='active' AND live.role=${role} AND live."customerCompanyId" IS NOT DISTINCT FROM ${company}::text AND live."companyAccess"=${permission})`;
  return { sql, values, bind };
}
