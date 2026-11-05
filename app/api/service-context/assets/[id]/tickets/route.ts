import { requireStaff } from '@/lib/access';
import {requireServiceContextAccess} from '@/lib/service-context-access';
import { handle,json,type RouteContext } from '@/lib/server';
import { assetTicketHistory } from '@/lib/service-context';
export async function GET(request:Request,context:RouteContext) {return handle(async()=>json(await assetTicketHistory(requireStaff(await requireServiceContextAccess(request)),(await context.params).id,new URL(request.url).searchParams.get('cursor'))));}
