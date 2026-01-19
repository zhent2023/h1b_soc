-- Create enum for transcript status
CREATE TYPE "TranscriptStatus" AS ENUM (
  'CREATED',
  'UPLOADED',
  'PARSING',
  'NEEDS_REVIEW',
  'READY',
  'FAILED'
);

-- Skill catalog for SKA embeddings
CREATE TABLE "SkillCatalog" (
  "id" UUID NOT NULL,
  "datasetVersionId" UUID NOT NULL,
  "skillId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "taxonomyType" TEXT NOT NULL,
  "embedding" vector(3072) NOT NULL,
  "embeddingModelId" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SkillCatalog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SkillCatalog_datasetVersionId_skillId_key" ON "SkillCatalog"("datasetVersionId", "skillId");
CREATE INDEX "SkillCatalog_datasetVersionId_idx" ON "SkillCatalog"("datasetVersionId");

ALTER TABLE "SkillCatalog" ADD CONSTRAINT "SkillCatalog_datasetVersionId_fkey"
  FOREIGN KEY ("datasetVersionId") REFERENCES "DatasetVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Occupation SKA requirements
CREATE TABLE "OccupationSkaRequirement" (
  "id" UUID NOT NULL,
  "datasetVersionId" UUID NOT NULL,
  "onetCode" TEXT NOT NULL,
  "skillId" TEXT NOT NULL,
  "importance" DOUBLE PRECISION,
  "level" DOUBLE PRECISION,
  "reqWeight" DOUBLE PRECISION NOT NULL,
  CONSTRAINT "OccupationSkaRequirement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OccupationSkaRequirement_datasetVersionId_onetCode_skillId_key"
  ON "OccupationSkaRequirement"("datasetVersionId", "onetCode", "skillId");
CREATE INDEX "OccupationSkaRequirement_datasetVersionId_onetCode_idx"
  ON "OccupationSkaRequirement"("datasetVersionId", "onetCode");
CREATE INDEX "OccupationSkaRequirement_datasetVersionId_skillId_idx"
  ON "OccupationSkaRequirement"("datasetVersionId", "skillId");

ALTER TABLE "OccupationSkaRequirement" ADD CONSTRAINT "OccupationSkaRequirement_datasetVersionId_fkey"
  FOREIGN KEY ("datasetVersionId") REFERENCES "DatasetVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Course embedding cache (content-addressable)
CREATE TABLE "CourseEmbeddingCache" (
  "courseTextHash" TEXT NOT NULL,
  "titleRaw" TEXT NOT NULL,
  "embedding" vector(3072) NOT NULL,
  "embeddingModelId" TEXT NOT NULL,
  "textPolicy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CourseEmbeddingCache_pkey" PRIMARY KEY ("courseTextHash")
);

-- Transcript root
CREATE TABLE "Transcript" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "status" "TranscriptStatus" NOT NULL DEFAULT 'CREATED',
  "sourceFileHash" TEXT,
  "parserProvider" TEXT,
  "parserVersion" TEXT,
  "parseConfidence" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Transcript_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Transcript_userId_createdAt_idx" ON "Transcript"("userId", "createdAt");

ALTER TABLE "Transcript" ADD CONSTRAINT "Transcript_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Transcript document metadata
CREATE TABLE "TranscriptDocument" (
  "transcriptId" UUID NOT NULL,
  "storageUrl" TEXT,
  "deletedAt" TIMESTAMP(3),
  "pageCount" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TranscriptDocument_pkey" PRIMARY KEY ("transcriptId")
);

ALTER TABLE "TranscriptDocument" ADD CONSTRAINT "TranscriptDocument_transcriptId_fkey"
  FOREIGN KEY ("transcriptId") REFERENCES "Transcript"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Transcript courses
CREATE TABLE "TranscriptCourse" (
  "transcriptId" UUID NOT NULL,
  "courseKey" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "credits" DOUBLE PRECISION,
  "grade" TEXT,
  "rawLine" TEXT,
  "isUserEdited" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TranscriptCourse_pkey" PRIMARY KEY ("transcriptId", "courseKey")
);

ALTER TABLE "TranscriptCourse" ADD CONSTRAINT "TranscriptCourse_transcriptId_fkey"
  FOREIGN KEY ("transcriptId") REFERENCES "Transcript"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Transcript SKA evidence
CREATE TABLE "TranscriptInferredSka" (
  "transcriptId" UUID NOT NULL,
  "courseKey" TEXT NOT NULL,
  "skillId" TEXT NOT NULL,
  "matchScore" DOUBLE PRECISION NOT NULL,
  "skillWeight" DOUBLE PRECISION NOT NULL,
  "embeddingModelId" TEXT NOT NULL,
  "datasetVersionId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TranscriptInferredSka_pkey" PRIMARY KEY ("transcriptId", "courseKey", "skillId", "embeddingModelId", "datasetVersionId")
);

CREATE INDEX "TranscriptInferredSka_transcriptId_skillId_idx" ON "TranscriptInferredSka"("transcriptId", "skillId");

ALTER TABLE "TranscriptInferredSka" ADD CONSTRAINT "TranscriptInferredSka_transcriptId_courseKey_fkey"
  FOREIGN KEY ("transcriptId", "courseKey") REFERENCES "TranscriptCourse"("transcriptId", "courseKey") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TranscriptInferredSka" ADD CONSTRAINT "TranscriptInferredSka_datasetVersionId_fkey"
  FOREIGN KEY ("datasetVersionId") REFERENCES "DatasetVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
