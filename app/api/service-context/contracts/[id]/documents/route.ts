import { requireStaff } from '@/lib/access';
import { requireServiceContextAccess } from '@/lib/service-context-access';
import { handle, json, parseBody, type RouteContext } from '@/lib/server';
import { listContractDocuments, attachContractDocuments } from '@/lib/service-context';
import { contractDocumentsSchema } from '@/lib/service-context-model';
export async function GET(request: Request, context: RouteContext) {
  return handle(async () =>
    json(
      await listContractDocuments(requireStaff(await requireServiceContextAccess(request)), (await context.params).id),
    ),
  );
}
export async function POST(request: Request, context: RouteContext) {
  return handle(async () =>
    json(
      await attachContractDocuments(
        requireStaff(await requireServiceContextAccess(request)),
        (await context.params).id,
        await parseBody(request, contractDocumentsSchema),
      ),
      201,
    ),
  );
}
