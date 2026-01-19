-- Ensure inferred course summary and skill evidence flag exist
ALTER TABLE "TranscriptCourse" ADD COLUMN IF NOT EXISTS "summary" TEXT;
ALTER TABLE "TranscriptCourse" ADD COLUMN IF NOT EXISTS "hasSkillEvidence" BOOLEAN;
