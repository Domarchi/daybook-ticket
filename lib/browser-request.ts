import {workspaceFetch,workspaceRequestInput} from './workspace-client';
import {followSecurityResponse} from './security-navigation';
/** Transport errors never trigger an automatic retry of a mutation. The caller
 * retains its scoped draft and operationId until the server confirms success. */
export async function daybookFetch(input:RequestInfo|URL,init?:RequestInit,message='No se pudo conectar con Daybook. Vuelve a intentarlo.'){
 let response:Response;const target=workspaceRequestInput(input);
 try{response=await workspaceFetch(target,init);}
 catch(error){if(init?.signal?.aborted)throw error;throw new Error(message);}
 return followSecurityResponse(response,target);
}
export const UNCERTAIN_SEND_MESSAGE='Se interrumpió la conexión. El envío no se ha confirmado y tu borrador se conserva. Vuelve a intentarlo al recuperar la conexión.';
