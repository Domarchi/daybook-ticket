import { requireAccess } from '@/lib/access';
import { handle,json,parseBody,parseId,type RouteContext } from '@/lib/server';
import { reviewKnowledge } from '@/lib/knowledge';
import { knowledgeReviewSchema } from '@/lib/knowledge-model';
export async function POST(request:Request,context:RouteContext){return handle(async()=>json(await reviewKnowledge(await requireAccess(request),parseId((await context.params).id),await parseBody(request,knowledgeReviewSchema))));}
