import { z } from 'zod';
export const SECURITY_FRESH_MS = 5 * 60_000;
export type SecurityAction =
  | 'password_verified'
  | 'mfa_verified'
  | 'mfa_enabled'
  | 'mfa_disabled'
  | 'recovery_acknowledged'
  | 'recovery_regenerated'
  | 'policy_enabled'
  | 'policy_disabled'
  | 'session_revoked'
  | 'other_sessions_revoked'
  | 'platform_backup_created'
  | 'business_export_created'
  | 'member_permissions_changed'
  | 'configuration_changed';
export const SECURITY_ACTIONS: readonly SecurityAction[] = [
  'password_verified',
  'mfa_verified',
  'mfa_enabled',
  'mfa_disabled',
  'recovery_acknowledged',
  'recovery_regenerated',
  'policy_enabled',
  'policy_disabled',
  'session_revoked',
  'other_sessions_revoked',
  'platform_backup_created',
  'business_export_created',
  'member_permissions_changed',
  'configuration_changed',
];
export interface SecurityProof {
  passwordVerifiedAt: string | null;
  mfaVerifiedAt: string | null;
}
export interface SecurityPolicy {
  requireStaffMfa: boolean;
  activatedAt: string | null;
  version: number;
}
export function recentProof(value: string | null | undefined, now = Date.now()): boolean {
  const timestamp = value ? Date.parse(value) : NaN;
  return Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= SECURITY_FRESH_MS;
}
export function requiresMfaChallenge(
  role: string,
  policy: SecurityPolicy,
  enabled: boolean,
  proof: SecurityProof | null,
  now = Date.now(),
): boolean {
  if (!policy.requireStaffMfa || !['owner', 'admin', 'agent'].includes(role)) return false;
  const verified = proof?.mfaVerifiedAt ? Date.parse(proof.mfaVerifiedAt) : NaN;
  const activated = policy.activatedAt ? Date.parse(policy.activatedAt) : NaN;
  return (
    !enabled || !Number.isFinite(verified) || !Number.isFinite(activated) || verified < activated || verified > now
  );
}
export function hasFreshProof(proof: SecurityProof | null, mfaEnabled: boolean, now = Date.now()): boolean {
  return Boolean(
    proof && recentProof(proof.passwordVerifiedAt, now) && (!mfaEnabled || recentProof(proof.mfaVerifiedAt, now)),
  );
}
export function safeOperationalCode(value: unknown): string | null {
  return typeof value === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(value) ? value : value ? 'operation_failed' : null;
}
export function securityActionNeedsReauthentication(pathname: string, method: string): boolean {
  const path = pathname.replace(/^\/api\/workspaces\/[^/]+(?=\/)/, '/api');
  if (/^\/api\/backups(?:\/|$)/.test(path)) return method !== 'GET' || /\/download$/.test(path);
  return (
    !['GET', 'HEAD', 'OPTIONS'].includes(method) &&
    /^\/api\/(?:members|settings|service-policies|assignment-rules|escalations|notifications\/settings|organization\/catalog|administration|task-templates|evolution\/features|service-context\/(?:notifications|config)|automation\/(?:rules|settings|templates))(?:\/|$)/.test(
      path,
    )
  );
}
export function publicSessionLabel(userAgent: string | null): string {
  const agent = userAgent || '';
  const browser = /Edg\//.test(agent)
    ? 'Edge'
    : /Firefox\//.test(agent)
      ? 'Firefox'
      : /Chrome\//.test(agent)
        ? 'Chrome'
        : /Safari\//.test(agent)
          ? 'Safari'
          : 'Navegador';
  const system = /Android/.test(agent)
    ? 'Android'
    : /iPhone|iPad/.test(agent)
      ? 'iOS'
      : /Windows/.test(agent)
        ? 'Windows'
        : /Macintosh/.test(agent)
          ? 'macOS'
          : /Linux/.test(agent)
            ? 'Linux'
            : 'otro dispositivo';
  return `${browser} · ${system}`;
}
/** Raw auth responses are never used as session-management DTOs. */
export function publicAuthResponse(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !['token', 'sessionToken', 'accessToken', 'refreshToken', 'idToken'].includes(key))
      .map(([key, item]) => [
        key,
        key === 'session' && item && typeof item === 'object' ? publicAuthResponse(item) : item,
      ]),
  );
}

/** Better Auth IDs are opaque strings, not necessarily UUIDs. Ownership is checked in SQL. */
export const sessionRevocationSchema = z.union([
  z.object({ id: z.string().min(1).max(256) }).strict(),
  z.object({ others: z.literal(true) }).strict(),
]);
