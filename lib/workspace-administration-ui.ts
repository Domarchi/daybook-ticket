import {isJsonObject} from './browser-json';
import {EVOLUTION_FEATURES} from './evolution-feature-model';
import {limitsSchema} from './workspace-model';

export const MEGABYTE=1024*1024;
export const WORKSPACE_LIMIT_FIELDS=[
 {key:'members',label:'Personas con acceso',description:'Cuentas activas e invitadas del negocio.'},
 {key:'ticketsMonthly',label:'Tickets por mes',description:'Nuevas solicitudes durante el mes en curso.'},
 {key:'messagesMonthly',label:'Mensajes por mes',description:'Solicitudes, respuestas y notas del equipo.'},
 {key:'storageBytes',label:'Almacenamiento privado',description:'Archivos de tickets y documentos privados.'},
 {key:'mailMonthly',label:'Correos por mes',description:'Envíos automáticos del negocio.'},
] as const;
const ROLE_LABELS:Record<string,string>={owner:'Propietario',admin:'Administrador',agent:'Agente',client:'Cliente'};
const STATE_LABELS:Record<string,string>={draft:'En preparación',active:'Activo',suspended:'En pausa'};
function labelFor(labels:Record<string,string>,value:unknown){return typeof value==='string'&&Object.hasOwn(labels,value)?labels[value]:'No disponible';}
export function workspaceRoleLabel(role:unknown){return labelFor(ROLE_LABELS,role);}
export function workspaceStateLabel(state:unknown){return labelFor(STATE_LABELS,state);}
/** A byte is exactly 0.00000095367431640625 MB; keep all digits when editing. */
export function workspaceStorageMegabytesInput(bytes:number){
 if(!Number.isSafeInteger(bytes)||bytes<0)throw new Error('El límite de almacenamiento no es válido.');
 const whole=Math.floor(bytes/MEGABYTE),remainder=BigInt(bytes%MEGABYTE);
 const fraction=(remainder*BigInt(10)**BigInt(20)/BigInt(MEGABYTE)).toString().padStart(20,'0').replace(/0+$/,'');
 return `${whole}${fraction?`.${fraction}`:''}`;
}
export function workspaceQuotaValue(key:string,value:number|string){
 const number=Number(value);
 if(!Number.isSafeInteger(number)||number<0)return 'No disponible';
 if(key!=='storageBytes')return number.toLocaleString('es-CL');
 const [whole,fraction]=workspaceStorageMegabytesInput(number).split('.');
 return `${Number(whole).toLocaleString('es-CL')}${fraction?`,${fraction}`:''} MB`;
}
export function readWorkspaceLimits(fields:FormData){
 const raw=String(fields.get('storageMegabytes')||'').trim();
 const decimal=raw.length<=80?/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(raw):null;
 if(!decimal||Math.abs(Number(decimal[3]||0))>40)throw new Error('Revisa la cantidad de MB del almacenamiento.');
 const fraction=decimal[2]||'',scale=fraction.length-Number(decimal[3]||0);
 const denominator=BigInt(10)**BigInt(Math.max(0,scale));
 const numerator=BigInt(decimal[1]+fraction)*BigInt(MEGABYTE)*BigInt(10)**BigInt(Math.max(0,-scale));
 if(numerator%denominator!==BigInt(0))throw new Error('El almacenamiento en MB debe equivaler a una cantidad entera de bytes.');
 const storageBytes=Number(numerator/denominator);
 const values=Object.fromEntries(WORKSPACE_LIMIT_FIELDS.map(({key})=>[key,key==='storageBytes'?storageBytes:Number(fields.get(key))]));
 const result=limitsSchema.safeParse(values);
 if(!Number.isSafeInteger(storageBytes)||!result.success)throw new Error('Revisa los límites: usa números enteros dentro de los rangos indicados.');
 return result.data;
}
/** Both GET and PATCH return this DTO; partial bodies must not confirm a change. */
export function isEvolutionFeaturesResponse(value:unknown){
 if(!isJsonObject(value)||!isJsonObject(value.features))return false;
 const features=value.features;
 return EVOLUTION_FEATURES.every(key=>typeof features[key]==='boolean')
  &&typeof value.version==='number'&&Number.isSafeInteger(value.version)&&value.version>=0&&typeof value.available==='boolean';
}
