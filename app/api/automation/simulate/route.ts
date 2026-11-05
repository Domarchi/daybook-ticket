import { requireAutomationAccess } from '@/lib/automation-access';
import { handle,json,parseBody } from '@/lib/server';
import { simulationSchema } from '@/lib/automation-model';
import { simulateAutomation } from '@/lib/automation';
export async function POST(request:Request){return handle(async()=>json(await simulateAutomation(await requireAutomationAccess(request),await parseBody(request,simulationSchema))));}
