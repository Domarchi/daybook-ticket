import {requireAccess,requireStaff} from './access';
import {requireEvolutionFeature} from './evolution-features';
export async function requireServiceContextAccess(request:Request){
 const access=requireStaff(await requireAccess(request));
 await requireEvolutionFeature(access,'serviceContext');
 return access;
}
