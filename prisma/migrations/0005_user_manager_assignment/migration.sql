-- Add MANAGER to UserRole enum
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'MANAGER';

-- Add manager assignment support for users
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "managerId" TEXT;

-- Tenant-scoped indexes for manager assignment queries
CREATE INDEX IF NOT EXISTS "users_tenantId_role_idx" ON "users"("tenantId", "role");
CREATE INDEX IF NOT EXISTS "users_tenantId_managerId_idx" ON "users"("tenantId", "managerId");

-- Self-reference to user manager
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_managerId_fkey'
  ) THEN
    ALTER TABLE "users"
    ADD CONSTRAINT "users_managerId_fkey"
    FOREIGN KEY ("managerId") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
