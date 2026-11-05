import { requireAccess, requireAdmin } from '@/lib/access';
import { ApiError,handle } from '@/lib/server';
export async function POST(request: Request) {
  return handle(async () => {
    requireAdmin(await requireAccess(request));
    throw new ApiError(409,'Abre la biblioteca de conocimiento para crear una versión y elegir sus empresas autorizadas.');
  });
}
