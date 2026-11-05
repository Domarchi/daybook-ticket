import {requireKnowledgeAccess} from '@/lib/knowledge-access';
import { handle,json,parseBody,parseId,type RouteContext } from '@/lib/server';
import { reviewKnowledge } from '@/lib/knowledge';
import { knowledgeReviewSchema } from '@/lib/knowledge-model';
export async function POST(request:Request,context:RouteContext){return handle(async()=>json(await reviewKnowledge(await requireKnowledgeAccess(request),parseId((await context.params).id),await parseBody(request,knowledgeReviewSchema))));}
