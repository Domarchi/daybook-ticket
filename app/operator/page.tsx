import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { requireOperator } from '@/lib/workspaces';
import { ApiError } from '@/lib/server';
import { PlatformOperatorConsole } from '../workspace-administration';
export const dynamic='force-dynamic';
export default async function Operator(){try{await requireOperator(new Request(`${process.env.DAYBOOK_SITE_URL}/api/operator/workspaces`,{headers:await headers()}));}catch(error){if(error instanceof ApiError&&error.status===401)redirect('/login');if(error instanceof ApiError&&error.status===428)redirect('/account/security');throw error;}return <main className="security-page commercial-page"><PlatformOperatorConsole/></main>;}
