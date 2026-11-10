import { requireKnowledgeAccess } from '@/lib/knowledge-access';
import { ApiError, handle, json, parseBody } from '@/lib/server';
import { createKnowledge, listKnowledge } from '@/lib/knowledge';
import { knowledgeCreateSchema, knowledgeSearchSchema } from '@/lib/knowledge-model';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return handle(async () => {
    const access = await requireKnowledgeAccess(request),
      params = new URL(request.url).searchParams;
    for (const key of params.keys())
      if (
        !['q', 'category', 'state', 'includeArchived', 'cursor', 'limit'].includes(key) ||
        params.getAll(key).length !== 1
      )
        throw new ApiError(400, 'Los filtros de artículos no son válidos.');
    if (params.has('includeArchived') && !['true', 'false'].includes(params.get('includeArchived')!))
      throw new ApiError(400, 'El filtro de archivados no es válido.');
    const input = knowledgeSearchSchema.parse({
      q: params.get('q') || '',
      category: params.get('category') || '',
      state: params.get('state') || 'all',
      includeArchived: params.get('includeArchived') === 'true',
      cursor: params.get('cursor') ? Number(params.get('cursor')) : null,
      limit: params.has('limit') ? Number(params.get('limit')) : 20,
    });
    return json(await listKnowledge(access, input));
  });
}
export async function POST(request: Request) {
  return handle(async () =>
    json(
      await createKnowledge(await requireKnowledgeAccess(request), await parseBody(request, knowledgeCreateSchema)),
      201,
    ),
  );
}
