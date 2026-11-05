import { requireAccess } from '@/lib/access';
import { handle,json,parseBody } from '@/lib/server';
import { automationSettingsSchema } from '@/lib/automation-model';
import { getAutomationSettings,saveAutomationSettings } from '@/lib/automation';
export async function GET(request:Request){return handle(async()=>json(await getAutomationSettings(await requireAccess(request))));}
export async function PATCH(request:Request){return handle(async()=>json({settings:await saveAutomationSettings(await requireAccess(request),await parseBody(request,automationSettingsSchema))}));}
