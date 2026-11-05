import { requireAccess } from '@/lib/access';
import { handle,json,parseBody } from '@/lib/server';
import { taskTemplateSchema,templatePatchSchema } from '@/lib/automation-model';
import { listTaskTemplates,patchTaskTemplate,saveTaskTemplate } from '@/lib/automation';
export async function GET(request:Request){return handle(async()=>{const q=new URL(request.url).searchParams;return json(await listTaskTemplates(await requireAccess(request),q.get('includeArchived')==='true',q.get('cursor'),Number(q.get('limit')??50)));});}
export async function POST(request:Request){return handle(async()=>json({template:await saveTaskTemplate(await requireAccess(request),await parseBody(request,taskTemplateSchema))},201));}
export async function PATCH(request:Request){return handle(async()=>json({template:await patchTaskTemplate(await requireAccess(request),await parseBody(request,templatePatchSchema))}));}
