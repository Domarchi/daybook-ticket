import { auth } from './server';
import type { AccessContext } from './access';
/** Account operations confer no membership and no business role. Never pass this context to domain routes. */
export async function requireIdentityAccess(request: Request): Promise<AccessContext> {
  const user = await auth(request),
    now = new Date().toISOString();
  return {
    organizationId: '',
    ownerId: '',
    userId: user.userId,
    sessionId: user.sessionId,
    role: 'client',
    member: {
      id: user.userId,
      name: user.fullName || user.email,
      email: user.email,
      role: 'client',
      status: 'active',
      isTest: false,
      hasAccount: true,
      customerCompanyId: null,
      companyAccess: 'own',
      createdAt: now,
      updatedAt: now,
    },
  };
}
