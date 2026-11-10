import { requireAccess, requireStaff } from './access';
import { requireEvolutionFeature } from './evolution-features';
/** HTTP gate; domain transactions also recheck the switch before returning private data. */
export async function requireKnowledgeAccess(request: Request, staff = false) {
  const access = await requireAccess(request);
  if (staff) requireStaff(access);
  await requireEvolutionFeature(access, 'knowledge');
  return access;
}
