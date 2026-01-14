-- Reset embeddings because the dimension changed
TRUNCATE "OnetDutyEmbedding", "OnetEmbeddingVersion" RESTART IDENTITY CASCADE;

-- AlterTable
ALTER TABLE "OnetDutyEmbedding" ALTER COLUMN "embedding" TYPE vector(3072);
