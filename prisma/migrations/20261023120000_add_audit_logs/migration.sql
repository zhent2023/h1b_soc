-- Audit log for per-account operations
DO $$ BEGIN
  CREATE TYPE "AuditActorType" AS ENUM ('USER', 'ACCESS_USER', 'PUBLIC', 'UNKNOWN');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "AuditLog" (
  "id" UUID NOT NULL,
  "actorType" "AuditActorType" NOT NULL,
  "actorUserId" UUID,
  "actorAccessUserId" UUID,
  "actorEmail" TEXT,
  "action" TEXT NOT NULL,
  "resource" TEXT,
  "resourceId" TEXT,
  "method" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "statusCode" INTEGER NOT NULL,
  "success" BOOLEAN NOT NULL DEFAULT false,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "requestId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AuditLog"
  ADD CONSTRAINT "AuditLog_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AuditLog"
  ADD CONSTRAINT "AuditLog_actorAccessUserId_fkey"
  FOREIGN KEY ("actorAccessUserId") REFERENCES "AccessUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_actorAccessUserId_createdAt_idx" ON "AuditLog"("actorAccessUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_actorEmail_createdAt_idx" ON "AuditLog"("actorEmail", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
