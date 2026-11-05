import { requireAccess, requireAdmin } from '@/lib/access';
import { handle,ApiError,json,parseId,type RouteContext } from '@/lib/server';
import {getLegacyKnowledge} from '@/lib/knowledge';
export async function GET(request:Request,context:RouteContext){return handle(async()=>json(await getLegacyKnowledge(await requireAccess(request),parseId((await context.params).id))));}
export async function PATCH(request: Request) {
  return handle(async () => {
    requireAdmin(await requireAccess(request));
    throw new ApiError(409,'Abre la biblioteca de conocimiento para editar con control de versiones y publicación por empresa.');
  });
}
