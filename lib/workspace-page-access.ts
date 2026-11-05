import {safeTicketReturnPath,ticketLoginPath} from './return-path';
import {workspaceHome,workspaceIdFromPath} from './workspace-model';
export type WorkspacePageAccessDecision={kind:'redirect';href:string}|{kind:'denied';loginHref:string}|null;
/** Page-only handling: API authorization is unchanged and private error details
 * never become UI content. A verification/login return stays in this workspace. */
export function workspacePageAccessDecision(status:number,workspaceId:string,requestedReturn:unknown):WorkspacePageAccessDecision{
 const safe=safeTicketReturnPath(requestedReturn),destination=workspaceIdFromPath(safe)===workspaceId?safe:workspaceHome(workspaceId);
 if(status===401)return {kind:'redirect',href:ticketLoginPath(destination)};
 if(status===403)return {kind:'denied',loginHref:ticketLoginPath(destination)};
 if(status===428)return {kind:'redirect',href:`/w/${workspaceId}/security?return_to=${encodeURIComponent(destination)}`};
 if(status===423)return {kind:'redirect',href:`/w/${workspaceId}/onboarding`};
 return null;
}
