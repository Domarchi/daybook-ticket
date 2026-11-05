ALTER TABLE articles ADD COLUMN version integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE articles ADD COLUMN "contentRevision" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE articles ADD COLUMN "reviewState" text NOT NULL DEFAULT 'draft' CHECK ("reviewState" IN ('draft','review','approved','changes'));
--> statement-breakpoint
ALTER TABLE articles ADD COLUMN archived boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE TABLE "knowledgeArticleRevisions" (
 id text PRIMARY KEY,"ownerId" text NOT NULL,"articleId" integer NOT NULL REFERENCES articles(id),revision integer NOT NULL,
 title text NOT NULL,category text NOT NULL,body text NOT NULL,"changeNote" text NOT NULL DEFAULT '',origin text NOT NULL CHECK(origin IN ('legacy','edit')),
 "createdByMemberId" text REFERENCES members(id),"createdAt" text NOT NULL,UNIQUE("articleId",revision)
);
--> statement-breakpoint
CREATE INDEX knowledge_revisions_owner_article ON "knowledgeArticleRevisions" ("ownerId","articleId",revision DESC);
--> statement-breakpoint
CREATE TABLE "knowledgeArticleReviews" (
 id text PRIMARY KEY,"ownerId" text NOT NULL,"articleId" integer NOT NULL REFERENCES articles(id),"revisionId" text NOT NULL REFERENCES "knowledgeArticleRevisions"(id),
 status text NOT NULL CHECK(status IN ('pending','approved','changes','superseded')),note text NOT NULL DEFAULT '',
 "requestedByMemberId" text NOT NULL REFERENCES members(id),"reviewerMemberId" text REFERENCES members(id),"requestedAt" text NOT NULL,"decidedAt" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX knowledge_reviews_pending ON "knowledgeArticleReviews" ("revisionId") WHERE status='pending';
--> statement-breakpoint
CREATE INDEX knowledge_reviews_owner_article ON "knowledgeArticleReviews" ("ownerId","articleId","requestedAt" DESC,id DESC);
--> statement-breakpoint
CREATE TABLE "knowledgeArticlePublications" (
 id text PRIMARY KEY,"ownerId" text NOT NULL,"articleId" integer NOT NULL REFERENCES articles(id),"revisionId" text NOT NULL REFERENCES "knowledgeArticleRevisions"(id),
 "companyId" text NOT NULL REFERENCES "customerCompanies"(id),active boolean NOT NULL DEFAULT true,
 "publishedByMemberId" text NOT NULL REFERENCES members(id),"createdAt" text NOT NULL,"revokedAt" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX knowledge_publication_active ON "knowledgeArticlePublications" ("ownerId","articleId","companyId") WHERE active;
--> statement-breakpoint
CREATE INDEX knowledge_publications_company ON "knowledgeArticlePublications" ("ownerId","companyId",active,"articleId");
--> statement-breakpoint
CREATE TABLE "knowledgeEvents" (
 id text PRIMARY KEY,"ownerId" text NOT NULL,"articleId" integer NOT NULL REFERENCES articles(id),"actorMemberId" text NOT NULL REFERENCES members(id),
 action text NOT NULL,"detailJson" text NOT NULL,"createdAt" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX knowledge_events_article ON "knowledgeEvents" ("ownerId","articleId","createdAt" DESC,id DESC);
--> statement-breakpoint
CREATE TABLE "companyMonthlyReports" (
 id text PRIMARY KEY,"ownerId" text NOT NULL,"companyId" text NOT NULL REFERENCES "customerCompanies"(id),month text NOT NULL CHECK(month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
 "payloadJson" text NOT NULL,"payloadHash" text NOT NULL,"createdByMemberId" text NOT NULL REFERENCES members(id),"createdAt" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX company_reports_owner_company ON "companyMonthlyReports" ("ownerId","companyId","createdAt" DESC,id DESC);
