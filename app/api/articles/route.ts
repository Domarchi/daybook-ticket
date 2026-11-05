import { requireAccess, requireAdmin } from '@/lib/access';
import { ApiError,handle,json } from '@/lib/server';
import {listLegacyKnowledge} from '@/lib/knowledge';
export async function GET(request:Request){return handle(async()=>{const params=new URL(request.url).searchParams;for(const key of params.keys())if(!['q','cursor','limit'].includes(key)||params.getAll(key).length!==1)throw new ApiError(400,'Los filtros no son válidos.');return json(await listLegacyKnowledge(await requireAccess(request),{q:params.get('q')||'',cursor:params.has('cursor')?Number(params.get('cursor')):null,limit:params.has('limit')?Number(params.get('limit')):20}));});}
export async function POST(request: Request) {
  return handle(async () => {
    requireAdmin(await requireAccess(request));
    throw new ApiError(409,'Abre la biblioteca de conocimiento para crear una versión y elegir sus empresas autorizadas.');
  });
}
