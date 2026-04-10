-- Add invoicePdfTemplateId column to branding_settings
-- (was in the Zod schema but missing from the original migration)
ALTER TABLE "branding_settings"
  ADD COLUMN IF NOT EXISTS "invoicePdfTemplateId" TEXT;
