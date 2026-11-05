import { requireAccess } from './access';
import { requireEvolutionFeature } from './evolution-features';
export async function requireAutomationAccess(request:Request){const access=await requireAccess(request);await requireEvolutionFeature(access,'automation');return access;}
