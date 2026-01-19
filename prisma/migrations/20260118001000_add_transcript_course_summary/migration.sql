-- Add inferred course summary and skill evidence flag
ALTER TABLE "TranscriptCourse" ADD COLUMN "summary" TEXT;
ALTER TABLE "TranscriptCourse" ADD COLUMN "hasSkillEvidence" BOOLEAN;
