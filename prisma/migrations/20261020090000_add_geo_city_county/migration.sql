-- CreateTable
CREATE TABLE "GeoCityCounty" (
    "id" UUID NOT NULL,
    "datasetVersionId" UUID NOT NULL,
    "stateAb" TEXT NOT NULL,
    "cityName" TEXT NOT NULL,
    "cityNameNorm" TEXT NOT NULL,
    "countyName" TEXT NOT NULL,
    "countyNameNorm" TEXT NOT NULL,
    "countyFips" TEXT,

    CONSTRAINT "GeoCityCounty_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GeoCityCounty_datasetVersionId_stateAb_cityNameNorm_countyNameNorm_key" ON "GeoCityCounty"("datasetVersionId", "stateAb", "cityNameNorm", "countyNameNorm");

-- CreateIndex
CREATE INDEX "GeoCityCounty_datasetVersionId_stateAb_cityNameNorm_idx" ON "GeoCityCounty"("datasetVersionId", "stateAb", "cityNameNorm");

-- CreateIndex
CREATE INDEX "GeoCityCounty_datasetVersionId_stateAb_countyNameNorm_idx" ON "GeoCityCounty"("datasetVersionId", "stateAb", "countyNameNorm");

-- AddForeignKey
ALTER TABLE "GeoCityCounty" ADD CONSTRAINT "GeoCityCounty_datasetVersionId_fkey" FOREIGN KEY ("datasetVersionId") REFERENCES "DatasetVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
