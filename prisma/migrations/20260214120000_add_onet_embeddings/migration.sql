-- CreateExtension
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable
CREATE TABLE "OnetEmbeddingVersion" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "outputDim" INTEGER NOT NULL,
    "onetDatasetVersionId" UUID NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "metaJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnetEmbeddingVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnetDutyEmbedding" (
    "id" UUID NOT NULL,
    "embeddingVersionId" UUID NOT NULL,
    "onetCode" TEXT NOT NULL,
    "contentText" TEXT NOT NULL,
    "embedding" vector(768) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnetDutyEmbedding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OnetEmbeddingVersion_onetDatasetVersionId_idx" ON "OnetEmbeddingVersion"("onetDatasetVersionId");

-- CreateIndex
CREATE INDEX "OnetEmbeddingVersion_isActive_idx" ON "OnetEmbeddingVersion"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "OnetEmbeddingVersion_single_active_idx" ON "OnetEmbeddingVersion"("isActive") WHERE "isActive" = true;

-- CreateIndex
CREATE UNIQUE INDEX "OnetDutyEmbedding_embeddingVersionId_onetCode_key" ON "OnetDutyEmbedding"("embeddingVersionId", "onetCode");

-- CreateIndex
CREATE INDEX "OnetDutyEmbedding_embeddingVersionId_idx" ON "OnetDutyEmbedding"("embeddingVersionId");

-- AddForeignKey
ALTER TABLE "OnetEmbeddingVersion" ADD CONSTRAINT "OnetEmbeddingVersion_onetDatasetVersionId_fkey" FOREIGN KEY ("onetDatasetVersionId") REFERENCES "DatasetVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnetDutyEmbedding" ADD CONSTRAINT "OnetDutyEmbedding_embeddingVersionId_fkey" FOREIGN KEY ("embeddingVersionId") REFERENCES "OnetEmbeddingVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
