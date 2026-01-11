-- CreateTable
CREATE TABLE "DatasetVersion" (
    "id" UUID NOT NULL,
    "datasetName" TEXT NOT NULL,
    "versionLabel" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DatasetVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessUser" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccessUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OflcArea" (
    "id" UUID NOT NULL,
    "datasetVersionId" UUID NOT NULL,
    "areaCode" TEXT NOT NULL,
    "areaName" TEXT NOT NULL,
    "stateAb" TEXT,

    CONSTRAINT "OflcArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OflcAreaCounty" (
    "id" UUID NOT NULL,
    "datasetVersionId" UUID NOT NULL,
    "areaCode" TEXT NOT NULL,
    "countyFips" TEXT NOT NULL,
    "stateAb" TEXT NOT NULL,
    "countyTownName" TEXT NOT NULL,
    "countyTownNameNorm" TEXT NOT NULL,
    "matchKind" TEXT NOT NULL,

    CONSTRAINT "OflcAreaCounty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WageRate" (
    "id" UUID NOT NULL,
    "datasetVersionId" UUID NOT NULL,
    "wageYear" TEXT NOT NULL,
    "isAcwia" BOOLEAN NOT NULL DEFAULT false,
    "areaCode" TEXT NOT NULL,
    "socCode" TEXT NOT NULL,
    "l1Annual" INTEGER NOT NULL,
    "l1Hourly" INTEGER,
    "hasDataQualityIssue" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "WageRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocTitle" (
    "id" UUID NOT NULL,
    "datasetVersionId" UUID NOT NULL,
    "socCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocTitle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnetSocMap" (
    "id" UUID NOT NULL,
    "datasetVersionId" UUID NOT NULL,
    "onetCode" TEXT NOT NULL,
    "socCode" TEXT NOT NULL,

    CONSTRAINT "OnetSocMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnetDuty" (
    "id" UUID NOT NULL,
    "datasetVersionId" UUID NOT NULL,
    "onetCode" TEXT NOT NULL,
    "dutyText" TEXT NOT NULL,
    "dutyTextNorm" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnetDuty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeoCounty" (
    "id" UUID NOT NULL,
    "datasetVersionId" UUID NOT NULL,
    "countyFips" TEXT NOT NULL,
    "stateAb" TEXT NOT NULL,
    "countyName" TEXT NOT NULL,
    "countyNameNorm" TEXT NOT NULL,

    CONSTRAINT "GeoCounty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeoCbsa" (
    "id" UUID NOT NULL,
    "datasetVersionId" UUID NOT NULL,
    "cbsaCode" TEXT NOT NULL,
    "cbsaName" TEXT NOT NULL,
    "isMetropolitan" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "GeoCbsa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeoCountyToCbsa" (
    "id" UUID NOT NULL,
    "datasetVersionId" UUID NOT NULL,
    "countyFips" TEXT NOT NULL,
    "cbsaCode" TEXT NOT NULL,

    CONSTRAINT "GeoCountyToCbsa_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DatasetVersion_datasetName_idx" ON "DatasetVersion"("datasetName");

-- CreateIndex
CREATE INDEX "AccessUser_isActive_idx" ON "AccessUser"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "AccessUser_email_key" ON "AccessUser"("email");

-- CreateIndex
CREATE INDEX "OflcArea_datasetVersionId_areaName_idx" ON "OflcArea"("datasetVersionId", "areaName");

-- CreateIndex
CREATE UNIQUE INDEX "OflcArea_datasetVersionId_areaCode_key" ON "OflcArea"("datasetVersionId", "areaCode");

-- CreateIndex
CREATE INDEX "OflcAreaCounty_datasetVersionId_countyFips_idx" ON "OflcAreaCounty"("datasetVersionId", "countyFips");

-- CreateIndex
CREATE INDEX "OflcAreaCounty_datasetVersionId_stateAb_countyTownNameNorm__idx" ON "OflcAreaCounty"("datasetVersionId", "stateAb", "countyTownNameNorm", "matchKind");

-- CreateIndex
CREATE INDEX "WageRate_datasetVersionId_wageYear_isAcwia_socCode_l1Annual_idx" ON "WageRate"("datasetVersionId", "wageYear", "isAcwia", "socCode", "l1Annual");

-- CreateIndex
CREATE UNIQUE INDEX "WageRate_datasetVersionId_wageYear_isAcwia_areaCode_socCode_key" ON "WageRate"("datasetVersionId", "wageYear", "isAcwia", "areaCode", "socCode");

-- CreateIndex
CREATE INDEX "SocTitle_socCode_idx" ON "SocTitle"("socCode");

-- CreateIndex
CREATE UNIQUE INDEX "SocTitle_datasetVersionId_socCode_key" ON "SocTitle"("datasetVersionId", "socCode");

-- CreateIndex
CREATE INDEX "OnetSocMap_datasetVersionId_socCode_idx" ON "OnetSocMap"("datasetVersionId", "socCode");

-- CreateIndex
CREATE UNIQUE INDEX "OnetSocMap_datasetVersionId_onetCode_socCode_key" ON "OnetSocMap"("datasetVersionId", "onetCode", "socCode");

-- CreateIndex
CREATE INDEX "OnetDuty_datasetVersionId_onetCode_idx" ON "OnetDuty"("datasetVersionId", "onetCode");

-- CreateIndex
CREATE INDEX "GeoCounty_datasetVersionId_stateAb_countyNameNorm_idx" ON "GeoCounty"("datasetVersionId", "stateAb", "countyNameNorm");

-- CreateIndex
CREATE UNIQUE INDEX "GeoCounty_datasetVersionId_countyFips_key" ON "GeoCounty"("datasetVersionId", "countyFips");

-- CreateIndex
CREATE UNIQUE INDEX "GeoCbsa_datasetVersionId_cbsaCode_key" ON "GeoCbsa"("datasetVersionId", "cbsaCode");

-- CreateIndex
CREATE INDEX "GeoCountyToCbsa_datasetVersionId_cbsaCode_idx" ON "GeoCountyToCbsa"("datasetVersionId", "cbsaCode");

-- CreateIndex
CREATE UNIQUE INDEX "GeoCountyToCbsa_datasetVersionId_countyFips_cbsaCode_key" ON "GeoCountyToCbsa"("datasetVersionId", "countyFips", "cbsaCode");

-- AddForeignKey
ALTER TABLE "OflcArea" ADD CONSTRAINT "OflcArea_datasetVersionId_fkey" FOREIGN KEY ("datasetVersionId") REFERENCES "DatasetVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OflcAreaCounty" ADD CONSTRAINT "OflcAreaCounty_datasetVersionId_fkey" FOREIGN KEY ("datasetVersionId") REFERENCES "DatasetVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OflcAreaCounty" ADD CONSTRAINT "OflcAreaCounty_datasetVersionId_areaCode_fkey" FOREIGN KEY ("datasetVersionId", "areaCode") REFERENCES "OflcArea"("datasetVersionId", "areaCode") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WageRate" ADD CONSTRAINT "WageRate_datasetVersionId_fkey" FOREIGN KEY ("datasetVersionId") REFERENCES "DatasetVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WageRate" ADD CONSTRAINT "WageRate_datasetVersionId_areaCode_fkey" FOREIGN KEY ("datasetVersionId", "areaCode") REFERENCES "OflcArea"("datasetVersionId", "areaCode") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WageRate" ADD CONSTRAINT "WageRate_datasetVersionId_socCode_fkey" FOREIGN KEY ("datasetVersionId", "socCode") REFERENCES "SocTitle"("datasetVersionId", "socCode") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocTitle" ADD CONSTRAINT "SocTitle_datasetVersionId_fkey" FOREIGN KEY ("datasetVersionId") REFERENCES "DatasetVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnetSocMap" ADD CONSTRAINT "OnetSocMap_datasetVersionId_fkey" FOREIGN KEY ("datasetVersionId") REFERENCES "DatasetVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnetSocMap" ADD CONSTRAINT "OnetSocMap_datasetVersionId_socCode_fkey" FOREIGN KEY ("datasetVersionId", "socCode") REFERENCES "SocTitle"("datasetVersionId", "socCode") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnetDuty" ADD CONSTRAINT "OnetDuty_datasetVersionId_fkey" FOREIGN KEY ("datasetVersionId") REFERENCES "DatasetVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoCounty" ADD CONSTRAINT "GeoCounty_datasetVersionId_fkey" FOREIGN KEY ("datasetVersionId") REFERENCES "DatasetVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoCbsa" ADD CONSTRAINT "GeoCbsa_datasetVersionId_fkey" FOREIGN KEY ("datasetVersionId") REFERENCES "DatasetVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoCountyToCbsa" ADD CONSTRAINT "GeoCountyToCbsa_datasetVersionId_fkey" FOREIGN KEY ("datasetVersionId") REFERENCES "DatasetVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoCountyToCbsa" ADD CONSTRAINT "GeoCountyToCbsa_datasetVersionId_countyFips_fkey" FOREIGN KEY ("datasetVersionId", "countyFips") REFERENCES "GeoCounty"("datasetVersionId", "countyFips") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoCountyToCbsa" ADD CONSTRAINT "GeoCountyToCbsa_datasetVersionId_cbsaCode_fkey" FOREIGN KEY ("datasetVersionId", "cbsaCode") REFERENCES "GeoCbsa"("datasetVersionId", "cbsaCode") ON DELETE CASCADE ON UPDATE CASCADE;


-- CustomIndex
CREATE UNIQUE INDEX "DatasetVersion_datasetName_active_key" ON "DatasetVersion"("datasetName") WHERE "isActive" = true;
