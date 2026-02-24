-- Add lead/request linkage for polymorphic attachments
ALTER TABLE "attachments" ADD COLUMN "leadId" TEXT;

-- Request attachment indexes
CREATE INDEX "attachments_leadId_idx" ON "attachments"("leadId");
CREATE INDEX "attachments_leadId_createdAt_idx" ON "attachments"("leadId", "createdAt");

-- Enforce referential integrity to leads (requests)
ALTER TABLE "attachments"
ADD CONSTRAINT "attachments_leadId_fkey"
FOREIGN KEY ("leadId") REFERENCES "leads"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
