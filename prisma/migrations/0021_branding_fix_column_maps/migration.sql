-- Drop the mixed-case duplicate column accidentally created by migration 0020.
-- The real invoicePdfTemplateId data lives in the lowercase column "invoicepdftemplateid"
-- which was created by the original branding table setup.
ALTER TABLE "branding_settings"
  DROP COLUMN IF EXISTS "invoicePdfTemplateId";
