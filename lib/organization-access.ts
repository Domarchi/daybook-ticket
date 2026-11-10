import { requireAccess } from './access';
import { requireEvolutionFeature } from './evolution-features';
export async function requireOrganizationAccess(request: Request) {
  const access = await requireAccess(request);
  await requireEvolutionFeature(access, 'organization');
  return access;
}
