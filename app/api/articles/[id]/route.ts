import { requireAccess, requireAdmin } from '@/lib/access';
import { handle,ApiError } from '@/lib/server';
export async function PATCH(request: Request) {
  return handle(async () => {
    requireAdmin(await requireAccess(request));
    throw new ApiError(409,'Abre la biblioteca de conocimiento para editar con control de versiones y publicación por empresa.');
  });
}
