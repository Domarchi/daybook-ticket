import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import type { Database } from '../db/database';
import { requireAdmin, requireStaff, type AccessContext } from './access';
import { ApiError, db } from './server';
import { parseEvolutionFeatures } from './evolution-feature-model';
import { lockAccess, operationHash } from './ticket-mutations';
import {
  knowledgeSearchSchema,
  knowledgeSearchTokens,
  type KnowledgeArticle,
  type KnowledgeDetail,
  type KnowledgePage,
  type KnowledgeRevision,
  type KnowledgeReview,
  type KnowledgePublication,
  knowledgeCreateSchema,
  knowledgePatchSchema,
  knowledgeReviewSchema,
  knowledgePublicationSchema,
} from './knowledge-model';

interface ArticleRow extends KnowledgeArticle {
  ownerId: string;
}
const articleView = (row: ArticleRow): KnowledgeArticle => {
  const { ownerId, ...article } = row;
  void ownerId;
  return article;
};
const fields =
  'a.id,a.title,a.category,a.body,a.version,a."contentRevision",a."reviewState",a.archived,a."createdAt",a."updatedAt"';
async function audit(tx: PoolClient, access: AccessContext, articleId: number, action: string, detail: unknown) {
  await tx.query(
    'INSERT INTO "knowledgeEvents" (id,"ownerId","articleId","actorMemberId",action,"detailJson","createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [
      randomUUID(),
      access.ownerId,
      articleId,
      access.member.id,
      action,
      JSON.stringify(detail),
      new Date().toISOString(),
    ],
  );
}
async function articleLock(tx: PoolClient, access: AccessContext, id: number, expected?: number): Promise<ArticleRow> {
  const row = (
    await tx.query<ArticleRow>('SELECT * FROM articles WHERE id=$1 AND "ownerId"=$2 FOR UPDATE', [id, access.ownerId])
  ).rows[0];
  if (!row) throw new ApiError(404, 'El artículo no existe o ya no tienes acceso.');
  if (expected !== undefined && row.version !== expected)
    throw new ApiError(409, 'El artículo cambió. Actualiza antes de guardar.');
  return row;
}
async function revision(
  tx: PoolClient,
  access: AccessContext,
  row: ArticleRow,
  origin: 'legacy' | 'edit',
  changeNote = '',
) {
  const existing = (
    await tx.query<{ id: string }>(
      'SELECT id FROM "knowledgeArticleRevisions" WHERE "ownerId"=$1 AND "articleId"=$2 AND revision=$3',
      [access.ownerId, row.id, row.contentRevision],
    )
  ).rows[0];
  if (existing) return existing.id;
  const id = randomUUID();
  await tx.query(
    'INSERT INTO "knowledgeArticleRevisions" (id,"ownerId","articleId",revision,title,category,body,"changeNote",origin,"createdByMemberId","createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
    [
      id,
      access.ownerId,
      row.id,
      row.contentRevision,
      row.title,
      row.category,
      row.body,
      changeNote,
      origin,
      origin === 'legacy' ? null : access.member.id,
      new Date().toISOString(),
    ],
  );
  return id;
}
async function operation<T>(
  access: AccessContext,
  operationId: string,
  kind: string,
  input: unknown,
  admin: boolean,
  work: (tx: PoolClient, fresh: AccessContext) => Promise<T>,
  database: Database,
) {
  return database.transaction(async tx => {
    const fresh = admin ? requireAdmin(await lockAccess(tx, access)) : requireStaff(await lockAccess(tx, access)),
      hash = operationHash(input);
    await requireKnowledgeEnabled(tx, fresh.ownerId);
    await tx.query(
      'INSERT INTO operations ("operationId","ownerId","memberId",kind,"requestHash","resultJson","createdAt") VALUES ($1,$2,$3,$4,$5,\'null\',$6) ON CONFLICT DO NOTHING',
      [operationId, fresh.ownerId, fresh.member.id, kind, hash, new Date().toISOString()],
    );
    const old = (await tx.query('SELECT * FROM operations WHERE "operationId"=$1 FOR UPDATE', [operationId])).rows[0];
    if (
      old.ownerId !== fresh.ownerId ||
      old.memberId !== fresh.member.id ||
      old.kind !== kind ||
      old.requestHash !== hash
    )
      throw new ApiError(409, 'Este envío ya se utilizó con otros datos.');
    if (old.resultJson !== 'null') return JSON.parse(old.resultJson) as T;
    const result = await work(tx, fresh);
    await tx.query('UPDATE operations SET "resultJson"=$1 WHERE "operationId"=$2', [
      JSON.stringify(result),
      operationId,
    ]);
    return result;
  });
}
export async function knowledgeEnabledInTransaction(tx: PoolClient, ownerId: string) {
  if (
    !(await tx.query<{ relation: string | null }>(`SELECT to_regclass('public."evolutionFeatures"')::text AS relation`))
      .rows[0]?.relation
  )
    return false;
  const row = (
    await tx.query<{ featuresJson: string }>(
      'SELECT "featuresJson" FROM "evolutionFeatures" WHERE "ownerId"=$1 FOR SHARE',
      [ownerId],
    )
  ).rows[0];
  return parseEvolutionFeatures(row?.featuresJson).knowledge;
}
export async function requireKnowledgeEnabled(tx: PoolClient, ownerId: string) {
  if (!(await knowledgeEnabledInTransaction(tx, ownerId)))
    throw new ApiError(503, 'Esta función está en pausa para este espacio. Sus datos se conservan.');
}
async function knowledgePageInTransaction(
  tx: PoolClient,
  fresh: AccessContext,
  query: z.output<typeof knowledgeSearchSchema>,
): Promise<KnowledgePage> {
  const client = fresh.role === 'client',
    tokens = knowledgeSearchTokens(query.q);
  if (!client) requireStaff(fresh);
  const source = client
    ? '"knowledgeArticlePublications" p JOIN articles a ON a.id=p."articleId" AND a."ownerId"=p."ownerId" JOIN "knowledgeArticleRevisions" r ON r.id=p."revisionId" AND r."articleId"=a.id AND r."ownerId"=a."ownerId" JOIN "customerCompanies" c ON c.id=p."companyId" AND c."ownerId"=p."ownerId"'
    : 'articles a';
  const title = client ? 'r.title' : 'a.title',
    category = client ? 'r.category' : 'a.category',
    body = client ? 'r.body' : 'a.body';
  const selection = client
    ? 'a.id,r.title,r.category,left(r.body,320) AS body,0 AS version,r.revision AS "contentRevision",\'approved\' AS "reviewState",false AS archived,p."createdAt",p."createdAt" AS "updatedAt",true AS published'
    : fields.replace('a.body', 'left(a.body,320) AS body') +
      ',EXISTS(SELECT 1 FROM "knowledgeArticlePublications" shared WHERE shared."ownerId"=a."ownerId" AND shared."articleId"=a.id AND shared.active) AS published';
  const rows = (
    await tx.query<KnowledgeArticle>(
      `SELECT ${selection} FROM ${source} WHERE a."ownerId"=$1 AND ($2::int IS NULL OR a.id<$2) AND ($3='' OR ${category}=$3)
   AND ($4='' OR position(lower($4) IN lower(${title} || ' ' || ${body}))>0 OR EXISTS(SELECT 1 FROM unnest($5::text[]) token WHERE position(token IN lower(${title} || ' ' || ${body}))>0))
   ${client ? 'AND NOT a.archived AND p.active AND p."companyId"=$6 AND c."organizationId"=$7 AND ($8::boolean OR NOT a.archived) AND ($9=\'all\' OR $9=\'approved\')' : 'AND ($8::boolean OR NOT a.archived) AND ($9=\'all\' OR a."reviewState"=$9) AND $6::text IS NULL AND EXISTS(SELECT 1 FROM organizations o WHERE o."ownerId"=$1 AND o.id=$7)'} ORDER BY a.id DESC LIMIT $10`,
      [
        fresh.ownerId,
        query.cursor,
        query.category,
        query.q,
        tokens,
        client ? fresh.member.customerCompanyId : null,
        fresh.organizationId,
        query.includeArchived,
        query.state,
        query.limit + 1,
      ],
    )
  ).rows;
  return { items: rows.slice(0, query.limit), nextCursor: rows.length > query.limit ? rows[query.limit - 1].id : null };
}
export async function listKnowledge(
  access: AccessContext,
  input: z.input<typeof knowledgeSearchSchema>,
  database: Database = db(),
): Promise<KnowledgePage> {
  const query = knowledgeSearchSchema.parse(input);
  return database.transaction(async tx => {
    const fresh = await lockAccess(tx, access);
    await requireKnowledgeEnabled(tx, fresh.ownerId);
    return knowledgePageInTransaction(tx, fresh, query);
  });
}
export async function getKnowledge(
  access: AccessContext,
  id: number,
  cursor: number | null = null,
  database: Database = db(),
): Promise<KnowledgeDetail> {
  return database.transaction(async tx => {
    const fresh = await lockAccess(tx, access);
    await requireKnowledgeEnabled(tx, fresh.ownerId);
    if (fresh.role === 'client') {
      const article = (
        await tx.query<KnowledgeArticle>(
          `SELECT a.id,r.title,r.category,r.body,0 AS version,r.revision AS "contentRevision",'approved' AS "reviewState",false AS archived,p."createdAt",p."createdAt" AS "updatedAt",true AS published FROM "knowledgeArticlePublications" p JOIN articles a ON a.id=p."articleId" AND a."ownerId"=p."ownerId" JOIN "knowledgeArticleRevisions" r ON r.id=p."revisionId" AND r."articleId"=a.id AND r."ownerId"=a."ownerId" JOIN "customerCompanies" c ON c.id=p."companyId" AND c."ownerId"=p."ownerId" AND c."organizationId"=$4 WHERE a.id=$1 AND a."ownerId"=$2 AND p."companyId"=$3 AND p.active AND NOT a.archived`,
          [id, fresh.ownerId, fresh.member.customerCompanyId, fresh.organizationId],
        )
      ).rows[0];
      if (!article) throw new ApiError(404, 'El artículo no está disponible para tu empresa.');
      return { article, revisions: [], reviews: [], publications: [], reader: 'client', historyNextCursor: null };
    }
    requireStaff(fresh);
    const row = (await tx.query<ArticleRow>('SELECT * FROM articles WHERE id=$1 AND "ownerId"=$2', [id, fresh.ownerId]))
      .rows[0];
    if (!row) throw new ApiError(404, 'El artículo no existe.');
    const revisions = (
      await tx.query<KnowledgeRevision>(
        `SELECT r.id,r."articleId",r.revision,r.title,r.category,r.body,r."changeNote",r.origin,r."createdByMemberId",r."createdAt",EXISTS(SELECT 1 FROM "knowledgeArticleReviews" v WHERE v."revisionId"=r.id AND v."ownerId"=r."ownerId" AND v.status='approved') AS approved FROM "knowledgeArticleRevisions" r WHERE r."articleId"=$1 AND r."ownerId"=$2 AND ($3::int IS NULL OR r.revision<$3) ORDER BY r.revision DESC LIMIT 21`,
        [id, fresh.ownerId, cursor],
      )
    ).rows;
    const reviews = (
      await tx.query<KnowledgeReview>(
        'SELECT id,"revisionId",status,note,"requestedByMemberId","reviewerMemberId","requestedAt","decidedAt" FROM "knowledgeArticleReviews" WHERE "articleId"=$1 AND "ownerId"=$2 ORDER BY "requestedAt" DESC,id DESC LIMIT 100',
        [id, fresh.ownerId],
      )
    ).rows;
    const publications = (
      await tx.query<KnowledgePublication>(
        'SELECT p.id,p."companyId",c.name AS "companyName",p."revisionId",r.revision,p.active,p."createdAt",p."revokedAt" FROM "knowledgeArticlePublications" p JOIN "customerCompanies" c ON c.id=p."companyId" AND c."ownerId"=p."ownerId" JOIN "knowledgeArticleRevisions" r ON r.id=p."revisionId" AND r."ownerId"=p."ownerId" WHERE p."articleId"=$1 AND p."ownerId"=$2 ORDER BY p.active DESC,p."createdAt" DESC,p.id DESC LIMIT 200',
        [id, fresh.ownerId],
      )
    ).rows;
    return {
      article: articleView(row),
      revisions: revisions.slice(0, 20),
      reviews,
      publications,
      reader: 'staff',
      historyNextCursor: revisions.length > 20 ? revisions[19].revision : null,
    };
  });
}
export async function createKnowledge(
  access: AccessContext,
  input: z.output<typeof knowledgeCreateSchema>,
  database: Database = db(),
) {
  return operation(
    access,
    input.operationId,
    'knowledge_create',
    input,
    false,
    async (tx, fresh) => {
      const now = new Date().toISOString(),
        row = (
          await tx.query<ArticleRow>(
            'INSERT INTO articles ("ownerId",title,category,body,published,"createdAt","updatedAt",version,"contentRevision","reviewState") VALUES ($1,$2,$3,$4,false,$5,$5,1,1,\'draft\') RETURNING *',
            [fresh.ownerId, input.title, input.category, input.body, now],
          )
        ).rows[0];
      const revisionId = await revision(tx, fresh, row, 'edit', input.changeNote);
      await audit(tx, fresh, row.id, 'created', { revisionId, revision: 1 });
      return { article: articleView(row) };
    },
    database,
  );
}
export async function updateKnowledge(
  access: AccessContext,
  id: number,
  input: z.output<typeof knowledgePatchSchema>,
  database: Database = db(),
) {
  return database.transaction(async tx => {
    const fresh = requireStaff(await lockAccess(tx, access));
    await requireKnowledgeEnabled(tx, fresh.ownerId);
    const old = await articleLock(tx, fresh, id, input.expectedVersion),
      changed = old.title !== input.title || old.category !== input.category || old.body !== input.body;
    if (input.archived !== undefined) requireAdmin(fresh);
    if (!changed && (input.archived === undefined || old.archived === input.archived))
      return { article: articleView(old) };
    if (changed)
      await tx.query(
        'UPDATE "knowledgeArticleReviews" SET status=\'superseded\',"decidedAt"=$1 WHERE "articleId"=$2 AND "ownerId"=$3 AND status=\'pending\'',
        [new Date().toISOString(), id, fresh.ownerId],
      );
    if (changed && old.contentRevision === 0)
      await revision(tx, fresh, old, 'legacy', 'Estado conservado antes de la primera edición con versiones.');
    const row = (
      await tx.query<ArticleRow>(
        'UPDATE articles SET title=$1,category=$2,body=$3,version=version+1,"contentRevision"="contentRevision"+$4,"reviewState"=CASE WHEN $4=1 THEN \'draft\' ELSE "reviewState" END,archived=$5,"updatedAt"=$6 WHERE id=$7 AND "ownerId"=$8 RETURNING *',
        [
          input.title,
          input.category,
          input.body,
          changed ? 1 : 0,
          input.archived ?? old.archived,
          new Date().toISOString(),
          id,
          fresh.ownerId,
        ],
      )
    ).rows[0];
    const revisionId = changed ? await revision(tx, fresh, row, 'edit', input.changeNote) : null;
    await audit(tx, fresh, id, 'updated', {
      fromVersion: old.version,
      toVersion: row.version,
      revisionId,
      archived: row.archived,
    });
    return { article: articleView(row) };
  });
}
export async function reviewKnowledge(
  access: AccessContext,
  id: number,
  input: z.output<typeof knowledgeReviewSchema>,
  database: Database = db(),
) {
  return operation(
    access,
    input.operationId,
    `knowledge_review:${id}`,
    input,
    input.action !== 'request',
    async (tx, fresh) => {
      const old = await articleLock(tx, fresh, id, input.expectedVersion);
      if (old.archived) throw new ApiError(409, 'Reactiva el artículo antes de revisarlo.');
      const revisionId = await revision(tx, fresh, old, old.contentRevision === 0 ? 'legacy' : 'edit');
      const pending = (
        await tx.query<{ id: string }>(
          'SELECT id FROM "knowledgeArticleReviews" WHERE "ownerId"=$1 AND "revisionId"=$2 AND status=\'pending\' FOR UPDATE',
          [fresh.ownerId, revisionId],
        )
      ).rows[0];
      if (input.action === 'request') {
        if (pending) throw new ApiError(409, 'Esta versión ya está en revisión.');
        if (old.reviewState === 'approved')
          throw new ApiError(409, 'Esta versión ya está aprobada. Edita el contenido para solicitar otra revisión.');
        await tx.query(
          'INSERT INTO "knowledgeArticleReviews" (id,"ownerId","articleId","revisionId",status,note,"requestedByMemberId","requestedAt") VALUES ($1,$2,$3,$4,\'pending\',$5,$6,$7)',
          [randomUUID(), fresh.ownerId, id, revisionId, input.note, fresh.member.id, new Date().toISOString()],
        );
      } else {
        if (!pending) throw new ApiError(409, 'Solicita primero la revisión de esta versión.');
        await tx.query(
          'UPDATE "knowledgeArticleReviews" SET status=$1,note=$2,"reviewerMemberId"=$3,"decidedAt"=$4 WHERE id=$5',
          [
            input.action === 'approve' ? 'approved' : 'changes',
            input.note,
            fresh.member.id,
            new Date().toISOString(),
            pending.id,
          ],
        );
      }
      const state = input.action === 'request' ? 'review' : input.action === 'approve' ? 'approved' : 'changes';
      const row = (
        await tx.query<ArticleRow>(
          'UPDATE articles SET version=version+1,"reviewState"=$1,"updatedAt"=$2 WHERE id=$3 AND "ownerId"=$4 RETURNING *',
          [state, new Date().toISOString(), id, fresh.ownerId],
        )
      ).rows[0];
      await audit(tx, fresh, id, `review_${input.action}`, { revisionId, note: input.note });
      return { article: articleView(row), revisionId };
    },
    database,
  );
}
export async function publishKnowledge(
  access: AccessContext,
  id: number,
  input: z.output<typeof knowledgePublicationSchema>,
  database: Database = db(),
) {
  return operation(
    access,
    input.operationId,
    `knowledge_publications:${id}`,
    input,
    true,
    async (tx, fresh) => {
      const old = await articleLock(tx, fresh, id, input.expectedVersion);
      if (old.archived && input.companyIds.length) throw new ApiError(409, 'Reactiva el artículo antes de publicarlo.');
      const approved = (
        await tx.query(
          'SELECT r.id FROM "knowledgeArticleRevisions" r WHERE r.id=$1 AND r."articleId"=$2 AND r."ownerId"=$3 AND EXISTS(SELECT 1 FROM "knowledgeArticleReviews" v WHERE v."revisionId"=r.id AND v."ownerId"=r."ownerId" AND v.status=\'approved\')',
          [input.revisionId, id, fresh.ownerId],
        )
      ).rows[0];
      if (!approved) throw new ApiError(400, 'Selecciona una versión aprobada del artículo.');
      if (
        input.companyIds.length &&
        (
          await tx.query(
            'SELECT id FROM "customerCompanies" WHERE id=ANY($1::text[]) AND "ownerId"=$2 AND "organizationId"=$3 FOR SHARE',
            [input.companyIds, fresh.ownerId, fresh.organizationId],
          )
        ).rows.length !== input.companyIds.length
      )
        throw new ApiError(400, 'Selecciona empresas de este espacio.');
      const now = new Date().toISOString();
      await tx.query(
        'UPDATE "knowledgeArticlePublications" SET active=false,"revokedAt"=$1 WHERE "ownerId"=$2 AND "articleId"=$3 AND active AND (NOT("companyId"=ANY($4::text[])) OR "revisionId"<>$5)',
        [now, fresh.ownerId, id, input.companyIds, input.revisionId],
      );
      for (const companyId of input.companyIds)
        await tx.query(
          'INSERT INTO "knowledgeArticlePublications" (id,"ownerId","articleId","revisionId","companyId","publishedByMemberId","createdAt") SELECT $1,$2,$3,$4,$5,$6,$7 WHERE NOT EXISTS(SELECT 1 FROM "knowledgeArticlePublications" WHERE "ownerId"=$2 AND "articleId"=$3 AND "companyId"=$5 AND active)',
          [randomUUID(), fresh.ownerId, id, input.revisionId, companyId, fresh.member.id, now],
        );
      const row = (
        await tx.query<ArticleRow>(
          'UPDATE articles SET version=version+1,published=$1,"updatedAt"=$2 WHERE id=$3 AND "ownerId"=$4 RETURNING *',
          [input.companyIds.length > 0, now, id, fresh.ownerId],
        )
      ).rows[0];
      await audit(tx, fresh, id, 'publication_changed', { revisionId: input.revisionId, companyIds: input.companyIds });
      return { article: articleView(row) };
    },
    database,
  );
}
/** Safe compatibility feed: clients receive only their explicitly published immutable revisions. */
export async function knowledgeWorkspaceArticles(access: AccessContext, database: Database = db()) {
  return database.transaction(async tx => {
    const fresh = await lockAccess(tx, access),
      enabled = await knowledgeEnabledInTransaction(tx, fresh.ownerId);
    if (enabled)
      return (await knowledgePageInTransaction(tx, fresh, knowledgeSearchSchema.parse({ limit: 50 }))).items.map(
        article => ({ ...article, published: Boolean(article.published) }),
      );
    if (fresh.role === 'client') return [];
    requireStaff(fresh);
    // Compatibility library remains internal and read-only while evolution is paused; do not read new columns before migration 0011.
    return (
      await tx.query(
        'SELECT id,title,category,body,false AS published,"createdAt","updatedAt" FROM articles WHERE "ownerId"=$1 ORDER BY "updatedAt" DESC,id DESC LIMIT 50',
        [fresh.ownerId],
      )
    ).rows;
  });
}
/** Read-only compatibility endpoints never grant access to clients or accept the old published flag. */
export async function listLegacyKnowledge(
  access: AccessContext,
  input: z.input<typeof knowledgeSearchSchema>,
  database: Database = db(),
): Promise<KnowledgePage> {
  const query = knowledgeSearchSchema.parse(input);
  return database.transaction(async tx => {
    const fresh = requireStaff(await lockAccess(tx, access));
    const rows = (
      await tx.query<KnowledgeArticle>(
        'SELECT id,title,category,left(body,320) AS body,false AS published,"createdAt","updatedAt",0 AS version,0 AS "contentRevision",\'draft\' AS "reviewState",false AS archived FROM articles WHERE "ownerId"=$1 AND ($2::int IS NULL OR id<$2) AND ($3=\'\' OR position(lower($3) IN lower(title || \' \' || body))>0) ORDER BY id DESC LIMIT $4',
        [fresh.ownerId, query.cursor, query.q, query.limit + 1],
      )
    ).rows;
    return {
      items: rows.slice(0, query.limit),
      nextCursor: rows.length > query.limit ? rows[query.limit - 1].id : null,
    };
  });
}
export async function getLegacyKnowledge(
  access: AccessContext,
  id: number,
  database: Database = db(),
): Promise<KnowledgeDetail> {
  return database.transaction(async tx => {
    const fresh = requireStaff(await lockAccess(tx, access)),
      article = (
        await tx.query<KnowledgeArticle>(
          'SELECT id,title,category,body,false AS published,"createdAt","updatedAt",0 AS version,0 AS "contentRevision",\'draft\' AS "reviewState",false AS archived FROM articles WHERE id=$1 AND "ownerId"=$2',
          [id, fresh.ownerId],
        )
      ).rows[0];
    if (!article) throw new ApiError(404, 'El artículo no existe.');
    return { article, revisions: [], reviews: [], publications: [], reader: 'staff', historyNextCursor: null };
  });
}
export { operation as runKnowledgeOperation };
