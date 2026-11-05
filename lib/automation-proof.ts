import { createHmac, timingSafeEqual } from 'node:crypto';
export interface SimulationProofData{ownerId:string;memberId:string;ruleHash:string;referencesHash:string;expiresAt:number}
const domain='daybook-ticket:automation-simulation:v1:';
export function signSimulationProof(data:Omit<SimulationProofData,'expiresAt'>,secret:string,now=Date.now()):string{
  if(secret.length<32)throw new Error('Simulation signing is unavailable');
  const payload=Buffer.from(JSON.stringify({...data,expiresAt:now+15*60_000})).toString('base64url');
  return `${payload}.${createHmac('sha256',secret).update(domain+payload).digest('base64url')}`;
}
export function verifySimulationProof(token:string|undefined,expected:Omit<SimulationProofData,'expiresAt'>,secret:string,now=Date.now()):boolean{
  if(!token||token.length>2048||secret.length<32)return false;
  const [payload,signature,extra]=token.split('.');if(!payload||!signature||extra||!/^[-_A-Za-z0-9]+$/.test(payload)||!/^[-_A-Za-z0-9]{43}$/.test(signature))return false;
  const actual=Buffer.from(signature,'base64url'),required=createHmac('sha256',secret).update(domain+payload).digest();
  if(actual.length!==required.length||!timingSafeEqual(actual,required))return false;
  try{const data=JSON.parse(Buffer.from(payload,'base64url').toString('utf8')) as SimulationProofData;return Number.isFinite(data.expiresAt)&&data.expiresAt>now&&data.expiresAt<=now+15*60_000&&data.ownerId===expected.ownerId&&data.memberId===expected.memberId&&data.ruleHash===expected.ruleHash&&data.referencesHash===expected.referencesHash;}catch{return false;}
}
