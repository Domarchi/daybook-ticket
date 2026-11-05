import { requireAccess,requireStaff } from '@/lib/access';
import { handle,json,type RouteContext } from '@/lib/server';
import { assetTicketHistory } from '@/lib/service-context';
export async function GET(request:Request,context:RouteContext) {return handle(async()=>json(await assetTicketHistory(requireStaff(await requireAccess(request)),(await context.params).id,new URL(request.url).searchParams.get('cursor'))));}
