import { isJsonObject } from './browser-json';
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const codes = (value: unknown) =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.length <= 10 &&
  value.every(code => typeof code === 'string' && code.length > 0 && code.length <= 64);
const status = (value: Record<string, unknown>) =>
  ['enabled', 'recoveryAcknowledged', 'challengeRequired', 'fresh', 'canManagePolicy'].every(
    key => typeof value[key] === 'boolean',
  ) &&
  typeof value.memberId === 'string' &&
  ['owner', 'admin', 'agent', 'client'].includes(String(value.role)) &&
  isJsonObject(value.policy) &&
  typeof value.policy.requireStaffMfa === 'boolean' &&
  Number.isInteger(value.policy.version) &&
  (value.policy.activatedAt === null || date(value.policy.activatedAt));
/** Success DTOs must be complete before ephemeral enrollment/recovery data or form contents change. */
export function securityResponseValid(path: string, method: string, value: unknown): boolean {
  if (!isJsonObject(value)) return false;
  const route = path.replace(/^\/api\/account\/security/, '/api/security').split('?')[0];
  if (route === '/api/security' || route === '/api/security/policy') return status(value);
  if (route === '/api/security/sessions')
    return method === 'GET'
      ? Array.isArray(value.sessions) &&
          value.sessions.every(
            session =>
              isJsonObject(session) &&
              typeof session.id === 'string' &&
              typeof session.label === 'string' &&
              date(session.createdAt) &&
              date(session.expiresAt) &&
              typeof session.current === 'boolean' &&
              !['token', 'userAgent', 'ipAddress'].some(key => key in session),
          )
      : Number.isInteger(value.revoked) && Number(value.revoked) >= 0;
  if (route === '/api/auth/two-factor/enable') {
    if (!codes(value.backupCodes) || typeof value.totpURI !== 'string') return false;
    try {
      const url = new URL(value.totpURI);
      return url.protocol === 'otpauth:' && url.hostname === 'totp' && Boolean(url.searchParams.get('secret'));
    } catch {
      return false;
    }
  }
  if (route === '/api/auth/two-factor/generate-backup-codes') return codes(value.backupCodes);
  if (route === '/api/auth/two-factor/disable') return value.status === true;
  if (route === '/api/auth/two-factor/verify-totp' || route === '/api/auth/two-factor/verify-backup-code')
    return isJsonObject(value.user) && typeof value.user.id === 'string';
  if (route === '/api/security/audit')
    return (
      Array.isArray(value.items) &&
      value.items.every(
        item =>
          isJsonObject(item) &&
          typeof item.id === 'string' &&
          typeof item.actorName === 'string' &&
          typeof item.action === 'string' &&
          date(item.createdAt),
      ) &&
      (value.nextCursor === null || typeof value.nextCursor === 'string')
    );
  if (route === '/api/security/health')
    return (
      Array.isArray(value.mail) &&
      Array.isArray(value.inbound) &&
      Array.isArray(value.backups) &&
      Array.isArray(value.jobs) &&
      value.jobs.every(
        job =>
          isJsonObject(job) &&
          typeof job.id === 'string' &&
          typeof job.name === 'string' &&
          ['lastStartedAt', 'lastSucceededAt', 'lastFailedAt'].every(key => job[key] === null || date(job[key])) &&
          (job.lastErrorCode === null || typeof job.lastErrorCode === 'string'),
      ) &&
      date(value.checkedAt) &&
      (value.scheduler === null || isJsonObject(value.scheduler))
    );
  return true;
}
