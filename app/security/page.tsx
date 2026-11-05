import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getDaybookUser } from '@/lib/daybook-auth';
import { safeTicketReturnPath,ticketLoginPath } from '@/lib/return-path';
import Brand from '../brand';
import { SecurityCenter } from '../security-center';
export const dynamic='force-dynamic';
export const metadata={title:'Seguridad · Daybook Ticket',robots:{index:false,follow:false},referrer:'no-referrer'};
export default async function SecurityPage({searchParams}:{searchParams:Promise<{return_to?:string}>}){
  const returnTo=safeTicketReturnPath((await searchParams).return_to),user=await getDaybookUser();
  if(!user)redirect(ticketLoginPath(returnTo));
  return <main className="security-page"><header><Link href="/" aria-label="Daybook Ticket · Inicio"><Brand/></Link><span>Acceso privado</span></header><h1>Protege tu cuenta</h1><SecurityCenter returnTo={returnTo}/></main>;
}
