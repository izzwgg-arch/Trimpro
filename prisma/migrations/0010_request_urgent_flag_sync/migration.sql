-- Add DB-backed urgent fields for request (Lead) records.

ALTER TABLE "leads"
  ADD COLUMN IF NOT EXISTS "isUrgent" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "urgentAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "urgentByUserId" TEXT;

CREATE INDEX IF NOT EXISTS "leads_tenantId_isUrgent_idx"
  ON "leads" ("tenantId", "isUrgent");

DO $$ BEGIN
  ALTER TABLE "leads"
    ADD CONSTRAINT "leads_urgentByUserId_fkey"
    FOREIGN KEY ("urgentByUserId")
    REFERENCES "users"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
