import type { PoolClient } from 'pg';
import type { AccessContext } from './access';
import { ApiError } from './server';
import { operationHash } from './ticket-mutations';

/** Caller holds current membership, ticket and owner work locks before replay. */
export async function internalOperation<T>(tx:PoolClient,access:AccessContext,operationId:string,kind:string,payload:unknown,work:()=>Promise<T>):Promise<T>{
  const hash=operationHash(payload);
  await tx.query('INSERT INTO operations ("operationId","ownerId","memberId",kind,"requestHash","resultJson","createdAt") VALUES ($1,$2,$3,$4,$5,\'null\',$6) ON CONFLICT ("operationId") DO NOTHING',[operationId,access.ownerId,access.member.id,kind,hash,new Date().toISOString()]);
  const record=(await tx.query('SELECT * FROM operations WHERE "operationId"=$1 FOR UPDATE',[operationId])).rows[0];
  if(record.ownerId!==access.ownerId||record.memberId!==access.member.id||record.kind!==kind||record.requestHash!==hash)throw new ApiError(409,'Esta operación ya se utilizó con otros datos.');
  if(record.resultJson!=='null')return JSON.parse(record.resultJson) as T;
  const result=await work();await tx.query('UPDATE operations SET "resultJson"=$1 WHERE "operationId"=$2',[JSON.stringify(result),operationId]);return result;
}
