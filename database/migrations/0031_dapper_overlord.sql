ALTER TABLE "product_images" ADD COLUMN "mime_type" text NOT NULL;--> statement-breakpoint
CREATE INDEX "product_images_tenant_product_idx" ON "product_images" USING btree ("tenant_id","product_id");--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_mime_type_check" CHECK ("product_images"."mime_type" IN ('image/jpeg', 'image/png', 'image/webp'));