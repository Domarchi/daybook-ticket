import { z } from 'zod';
import { requireAccess,requireAdmin } from '@/lib/access';
import { handle,parseBody } from '@/lib/server';
import { requireFreshSecurity } from '@/lib/security';
import { createBusinessExport,encryptBusinessExport } from '@/lib/business-export';
export const maxDuration=300;
export async function POST(request:Request){return handle(async()=>{
  const access=requireAdmin(await requireAccess(request));await requireFreshSecurity(access);
  const {password}=await parseBody(request,z.object({password:z.string().min(16).max(256),confirmation:z.literal('EXPORTAR NEGOCIO')}).strict());
  const archive=await createBusinessExport(access),bytes=encryptBusinessExport(archive,password);let offset=0;
  const stream=new ReadableStream<Uint8Array>({pull(controller){if(offset===bytes.length){bytes.fill(0);controller.close();return;}const end=Math.min(offset+65536,bytes.length);controller.enqueue(new Uint8Array(bytes.subarray(offset,end)));offset=end;},cancel(){bytes.fill(0);}});
  return new Response(stream,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="daybook-negocio-${archive.createdAt.slice(0,10)}.export"`,'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'",'Referrer-Policy':'no-referrer'}});
});}
