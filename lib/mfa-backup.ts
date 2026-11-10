import { symmetricDecrypt } from 'better-auth/crypto';
type Row = Record<string, unknown>;
type Manifest = { tables: { name: string; rows: Row[] }[] };
/** Never infer or disable a factor from incomplete portable identity records. */
export function validateMfaBackup(backup: Manifest) {
  const users = new Map((backup.tables.find(table => table.name === 'authUser')?.rows || []).map(row => [row.id, row]));
  const factors = backup.tables.find(table => table.name === 'twoFactor')?.rows || [],
    seen = new Set<unknown>();
  for (const factor of factors) {
    const user = users.get(factor.userId);
    if (
      !user ||
      seen.has(factor.userId) ||
      typeof factor.verified !== 'boolean' ||
      typeof factor.secret !== 'string' ||
      !factor.secret ||
      typeof factor.backupCodes !== 'string' ||
      !factor.backupCodes
    )
      throw Error('Invalid MFA backup records');
    seen.add(factor.userId);
    if (
      (user.twoFactorEnabled === true && factor.verified !== true) ||
      (user.twoFactorEnabled !== true && factor.verified === true)
    )
      throw Error('Inconsistent MFA backup flags');
  }
  for (const user of users.values()) {
    if (user.twoFactorEnabled !== undefined && typeof user.twoFactorEnabled !== 'boolean')
      throw Error('Invalid MFA backup flag');
    if (user.twoFactorEnabled === true && !seen.has(user.id))
      throw Error('Enabled MFA is missing its protected factor');
  }
  for (const policy of backup.tables.find(table => table.name === 'securityPolicies')?.rows || []) {
    if (typeof policy.requireStaffMfa !== 'boolean') throw Error('Invalid MFA policy backup');
    if (policy.requireStaffMfa === true) {
      const owner = (backup.tables.find(table => table.name === 'members')?.rows || []).find(
        member => member.ownerId === policy.ownerId && member.role === 'owner' && member.status === 'active',
      );
      if (!owner || users.get(owner.userId)?.twoFactorEnabled !== true)
        throw Error('Required MFA policy is missing its verified owner');
    }
  }
  return factors;
}
/** Restore checks the privately supplied original auth key before SQL or file writes. */
export async function verifyMfaBackupSecret(backup: Manifest, secret?: string) {
  const factors = validateMfaBackup(backup);
  if (!factors.length) return;
  if (!secret) throw Error('The original authentication secret is required to recover MFA.');
  try {
    for (const factor of factors) {
      const value = await symmetricDecrypt({ key: secret, data: String(factor.secret) }),
        codes = JSON.parse(await symmetricDecrypt({ key: secret, data: String(factor.backupCodes) }));
      if (
        value.length < 16 ||
        value.length > 1024 ||
        !Array.isArray(codes) ||
        codes.length > 10 ||
        codes.some(code => typeof code !== 'string' || !code || code.length > 64) ||
        new Set(codes).size !== codes.length
      )
        throw Error();
    }
  } catch {
    throw Error('MFA recovery cannot verify the original authentication secret and protected factor data.');
  }
}
