-- Add inferred course summary and skill evidence flag (guard for fresh databases)
ALTER TABLE IF EXISTS "TranscriptCourse" ADD COLUMN IF NOT EXISTS "summary" TEXT;
ALTER TABLE IF EXISTS "TranscriptCourse" ADD COLUMN IF NOT EXISTS "hasSkillEvidence" BOOLEAN;
