-- AddColumn: isSubtotal to invoice_line_items
ALTER TABLE "invoice_line_items" ADD COLUMN "isSubtotal" BOOLEAN NOT NULL DEFAULT false;
