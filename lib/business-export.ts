import { createCipheriv,randomBytes,scryptSync } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import type { PoolClient } from 'pg';
import type { AccessContext } from './access';
import { db,ApiError } from './server';
import { lockAccess } from './ticket-mutations';
import { attachmentStorage,readAttachmentBytes,type PrivateAttachmentStorage } from './attachments-storage';
import { backupPassword,canonicalBackupRows,MAX_BACKUP_BYTES,sha256,type BackupRow } from './backup-format';

/** Positive allowlist: never read an auth, mail capability, browser push or provider table. */
export const BUSINESS_EXPORT_TABLES=['organizations','customerCompanies','members','tickets','messages','articles','settings','savedReplies','attachments','ticketEvents','servicePolicies','assignmentRules','agentAvailability','ticketSlaOutcomes','notificationSettings','escalationSettings','ticketSatisfaction','securityPolicies','securityAudit'] as const;
const FORBIDDEN_COLUMNS=new Set(['userId','actorUserId','pathname','url','token','tokenHash','secret','backupCodes','password','sessionId','accessToken','refreshToken','idToken','p256dh','auth','endpoint','payloadJson','actionUrl']);
export function businessExportColumns(names:string[]):string[] {return names.filter(name=>/^[A-Za-z][A-Za-z0-9_]*$/.test(name)&&!FORBIDDEN_COLUMNS.has(name)&&!/(?:token|secret|password|credential|privatekey|apikey|backupcodes|recoverycodes|sessionid|authorization|cookie)/i.test(name));}
export interface BusinessExport {format:'daybook.business-export.v1';createdAt:string;organizationId:string;tables:{name:string;columns:string[];rows:BackupRow[];sha256:string}[];files:{attachmentId:string;name:string;contentType:string;size:number;sha256:string;base64:string}[];omissions:string[]}
const quote=(name:string)=>`"${name.replaceAll('"','""')}"`;
export async function createBusinessExport(access:AccessContext,database=db(),storage?:PrivateAttachmentStorage):Promise<BusinessExport>{
  if(!['owner','admin'].includes(access.role))throw new ApiError(403,'Solo administración puede exportar los datos del negocio.');
  return database.transaction(async tx=>{
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await tx.query("SET LOCAL statement_timeout='90s'");
    const fresh=await lockAccess(tx,access);
    if(!['owner','admin'].includes(fresh.role))throw new ApiError(403,'Tu acceso cambió.');
    const output:BusinessExport={format:'daybook.business-export.v1',createdAt:new Date().toISOString(),organizationId:access.organizationId,tables:[],files:[],omissions:['Global login accounts, password hashes, MFA secrets and recovery codes are excluded.','Sessions, invitation/reset/reply capabilities, provider keys, device subscriptions and operational mail payloads are excluded.','Draft files are excluded. This archive is a business data export, not a platform recovery or identity import.']};
    let count=0,bytes=0;
    for(const table of BUSINESS_EXPORT_TABLES){
      const metadata=(await tx.query('SELECT column_name,data_type FROM information_schema.columns WHERE table_schema=\'public\' AND table_name=$1 ORDER BY ordinal_position',[table])).rows;
      if(!metadata.length)throw new ApiError(503,'Aplica las migraciones de esta versión antes de exportar.');
      const names=businessExportColumns(metadata.map(row=>row.column_name));
      const selection=names.map(name=>{
        if(table==='settings'&&name==='data')return `jsonb_build_object('brandName',data::jsonb->'brandName','tagline',data::jsonb->'tagline','agents',data::jsonb->'agents','notificationMemberIds',data::jsonb->'notificationMemberIds','departments',data::jsonb->'departments','slaHours',data::jsonb->'slaHours')::text AS data`;
        return /^timestamp/.test(metadata.find(row=>row.column_name===name)?.data_type||'')?`${quote(name)}::text AS ${quote(name)}`:quote(name);
      }).join(',');
      const query=`SELECT ${selection} FROM ${quote(table)} WHERE "ownerId"=$1 ${table==='attachments'?"AND status='attached'":''} LIMIT 100001`;
      const totals=(await tx.query(`SELECT count(*)::int AS count,COALESCE(sum(octet_length(row_to_json(item)::text)),0)::bigint::text AS bytes FROM (${query}) item`,[access.ownerId])).rows[0];
      if(count+Number(totals.count)>100000||bytes+Number(totals.bytes)>24*1024*1024)throw new ApiError(413,'El negocio supera el límite de esta exportación.');
      const rows=JSON.parse(JSON.stringify((await tx.query(query,[access.ownerId])).rows)) as BackupRow[];
      const encoded=canonicalBackupRows(rows);count+=rows.length;bytes+=Buffer.byteLength(encoded);
      output.tables.push({name:table,columns:names,rows,sha256:sha256(encoded)});
    }
    const sent=(await tx.query(`SELECT id,name,size,"contentType",pathname FROM attachments WHERE "ownerId"=$1 AND status='attached' ORDER BY id LIMIT 100001`,[access.ownerId])).rows;
    const deadline=Date.now()+180000;
    for(const file of sent){
      if(Date.now()>deadline)throw new ApiError(503,'La exportación necesita más tiempo. Vuelve a intentarlo o solicita una copia operativa.');
      const content=await readAttachmentBytes(storage??attachmentStorage(),file.pathname,file.size);
      if(!content)throw new ApiError(503,'No se pudo comprobar un archivo privado. No se ofrecerá una exportación incompleta.');
      const base64=content.toString('base64');bytes+=base64.length;
      if(bytes>MAX_BACKUP_BYTES-1024*1024)throw new ApiError(413,'La exportación supera 128 MiB.');
      output.files.push({attachmentId:file.id,name:file.name,contentType:file.contentType,size:file.size,sha256:sha256(content),base64});
    }
    await auditBusinessExport(tx,fresh);
    return output;
  });
}
async function auditBusinessExport(tx:PoolClient,access:AccessContext){
  await tx.query(`INSERT INTO "securityAudit" (id,"ownerId","actorMemberId","actorUserId","actorName",action,"createdAt") VALUES ($1,$2,$3,$4,$5,'business_export_created',$6)`,[crypto.randomUUID(),access.ownerId,access.member.id,access.userId,access.member.name,new Date().toISOString()]);
}
export const BUSINESS_EXPORT_MAGIC=Buffer.from('DAYBOOK-BUSINESS1\n');
export function encryptBusinessExport(value:BusinessExport,password:string):Buffer{
  backupPassword(password);const json=Buffer.from(JSON.stringify(value));
  if(json.length>MAX_BACKUP_BYTES)throw new ApiError(413,'La exportación supera el límite de 128 MiB.');
  const salt=randomBytes(16),iv=randomBytes(12),key=scryptSync(password,salt,32,{N:32768,maxmem:128*1024*1024});
  try{const cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(BUSINESS_EXPORT_MAGIC);const encrypted=Buffer.concat([cipher.update(gzipSync(json)),cipher.final()]);return Buffer.concat([BUSINESS_EXPORT_MAGIC,salt,iv,cipher.getAuthTag(),encrypted]);}
  finally{key.fill(0);json.fill(0);}
}
