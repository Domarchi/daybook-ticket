'use client';
import { useEffect,useState } from 'react';
import { readTicketResource } from './use-ticket-search';
import { quoteIsAllowed } from '@/lib/collaboration-model';
import type { Message } from '@/lib/types';
import type { DraftKind,DraftScope } from '@/lib/ticket-drafts';
export function authorizedDraftQuote(messages:Message[],messageId:number,ticketId:number,kind:DraftKind,client:boolean):Message|null {const source=messages.find(message=>message.id===messageId);return source&&quoteIsAllowed(source,{ticketId,kind,client})?source:null;}
/** Storage contains identifiers only. Every restored citation is resolved again
 * through the authenticated context endpoint; failure never drops its ID. */
export function useDraftQuote(scope:DraftScope,kind:DraftKind,messageId:number|null|undefined){
  const [attempt,setAttempt]=useState(0);
  const key=`${scope.memberId}:${scope.role}:${scope.ticketId}:${kind}:${messageId??''}:${attempt}`;
  const [state,setState]=useState<{key:string;quote:Message|null;error:string}>({key:'',quote:null,error:''});
  useEffect(()=>{if(!messageId)return;let active=true;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(new Error('La comprobación tardó demasiado. Reintenta la cita.')),15000);void readTicketResource<{messages:Message[]}>(`/api/tickets/${scope.ticketId}/messages/${messageId}`,scope.memberId,controller.signal).then(data=>{if(!active)return;const quote=authorizedDraftQuote(data.messages,messageId,scope.ticketId,kind,scope.role==='client');setState({key,quote,error:quote?'':'La cita ya no está disponible para tu cuenta. Retírala para enviar otra respuesta.'});}).catch(error=>{if(active)setState({key,quote:null,error:error instanceof Error?error.message:'No se pudo comprobar la cita.'});}).finally(()=>clearTimeout(timer));return()=>{active=false;clearTimeout(timer);controller.abort();};},[key,messageId,scope.memberId,scope.role,scope.ticketId,kind]);
  return {retry:()=>setAttempt(value=>value+1),quote:messageId&&state.key===key?state.quote:null,loading:Boolean(messageId&&state.key!==key),error:messageId&&state.key===key?state.error:''};
}
