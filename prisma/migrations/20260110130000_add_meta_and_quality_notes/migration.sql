-- AlterTable
ALTER TABLE "DatasetVersion" ADD COLUMN "metaJson" JSONB;

-- AlterTable
ALTER TABLE "WageRate" ADD COLUMN "dataQualityNotes" JSONB;
