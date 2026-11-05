import { requireAccess } from '@/lib/access';
import { handle,json,parseBody } from '@/lib/server';
import { savedViewSchema } from '@/lib/work-organization-model';
import { savedTicketViews,saveTicketView } from '@/lib/work-organization';
export async function GET(request:Request) {return handle(async()=>json({views:await savedTicketViews(await requireAccess(request))}));}
export async function POST(request:Request) {return handle(async()=>json({view:await saveTicketView(await requireAccess(request),await parseBody(request,savedViewSchema))},201));}
