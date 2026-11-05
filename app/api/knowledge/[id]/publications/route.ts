import { requireAccess } from '@/lib/access';
import { handle,json,parseBody,parseId,type RouteContext } from '@/lib/server';
import { publishKnowledge } from '@/lib/knowledge';
import { knowledgePublicationSchema } from '@/lib/knowledge-model';
export async function PUT(request:Request,context:RouteContext){return handle(async()=>json(await publishKnowledge(await requireAccess(request),parseId((await context.params).id),await parseBody(request,knowledgePublicationSchema))));}
