-- Alter hourly wages to decimal with cents precision
ALTER TABLE "WageRate"
  ALTER COLUMN "l1Hourly" TYPE DECIMAL(10,2) USING "l1Hourly"::decimal(10,2),
  ALTER COLUMN "l2Hourly" TYPE DECIMAL(10,2) USING "l2Hourly"::decimal(10,2),
  ALTER COLUMN "l3Hourly" TYPE DECIMAL(10,2) USING "l3Hourly"::decimal(10,2),
  ALTER COLUMN "l4Hourly" TYPE DECIMAL(10,2) USING "l4Hourly"::decimal(10,2);

-- Preserve duty order for display
ALTER TABLE "OnetDuty" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "OnetDuty_datasetVersionId_onetCode_sortOrder_idx"
  ON "OnetDuty"("datasetVersionId", "onetCode", "sortOrder");
