import {requireAccess} from '@/lib/access';
import {handle,json,parseBody} from '@/lib/server';
import {getEvolutionFeatures,changeEvolutionFeatures} from '@/lib/evolution-features';
import {featureChangeSchema} from '@/lib/evolution-feature-model';
export const dynamic='force-dynamic';
export async function GET(request:Request){return handle(async()=>json(await getEvolutionFeatures((await requireAccess(request)).ownerId)));}
export async function PATCH(request:Request){return handle(async()=>json(await changeEvolutionFeatures(await requireAccess(request),await parseBody(request,featureChangeSchema))));}
