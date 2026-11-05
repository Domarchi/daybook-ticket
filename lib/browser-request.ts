import { workspaceFetch } from './workspace-client';
/** Transport errors never trigger an automatic retry of a mutation. The caller
 * retains its scoped draft and operationId until the server confirms success. */
export async function daybookFetch(input:RequestInfo|URL,init?:RequestInit,message='No se pudo conectar con Daybook. Vuelve a intentarlo.'){
 try{return await workspaceFetch(input,init);}
 catch(error){if(init?.signal?.aborted)throw error;throw new Error(message);}
}
export const UNCERTAIN_SEND_MESSAGE='Se interrumpió la conexión. El envío no se ha confirmado y tu borrador se conserva. Vuelve a intentarlo al recuperar la conexión.';
