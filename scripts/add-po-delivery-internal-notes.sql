ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "internalNotes" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "deliveryAddress" TEXT;
