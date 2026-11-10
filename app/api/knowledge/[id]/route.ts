import { requireKnowledgeAccess } from '@/lib/knowledge-access';
import { ApiError, handle, json, parseBody, parseId, type RouteContext } from '@/lib/server';
import { getKnowledge, updateKnowledge } from '@/lib/knowledge';
import { knowledgePatchSchema } from '@/lib/knowledge-model';
export async function GET(request: Request, context: RouteContext) {
  return handle(async () => {
    const params = new URL(request.url).searchParams,
      cursor = params.get('historyCursor');
    for (const key of params.keys())
      if (key !== 'historyCursor' || params.getAll(key).length !== 1)
        throw new ApiError(400, 'El cursor no es válido.');
    if (cursor !== null && (!/^\d+$/.test(cursor) || Number(cursor) > 2147483647))
      throw new ApiError(400, 'El cursor no es válido.');
    return json(
      await getKnowledge(
        await requireKnowledgeAccess(request),
        parseId((await context.params).id),
        cursor === null ? null : Number(cursor),
      ),
    );
  });
}
export async function PATCH(request: Request, context: RouteContext) {
  return handle(async () =>
    json(
      await updateKnowledge(
        await requireKnowledgeAccess(request),
        parseId((await context.params).id),
        await parseBody(request, knowledgePatchSchema),
      ),
    ),
  );
}
