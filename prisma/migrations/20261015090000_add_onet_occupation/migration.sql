-- CreateTable
CREATE TABLE "OnetOccupation" (
    "id" UUID NOT NULL,
    "datasetVersionId" UUID NOT NULL,
    "onetCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnetOccupation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OnetOccupation_datasetVersionId_onetCode_key" ON "OnetOccupation"("datasetVersionId", "onetCode");

-- CreateIndex
CREATE INDEX "OnetOccupation_datasetVersionId_title_idx" ON "OnetOccupation"("datasetVersionId", "title");

-- AddForeignKey
ALTER TABLE "OnetOccupation" ADD CONSTRAINT "OnetOccupation_datasetVersionId_fkey" FOREIGN KEY ("datasetVersionId") REFERENCES "DatasetVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
