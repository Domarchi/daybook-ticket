-- Additive only: one unique index. No data, column or constraint changes.
-- A serial number belongs to one piece of equipment per workspace, written as lib/client-equipment-model.ts
-- normalizes it (trim, single spaces, upper case). Equipment without a serial (empty) is not indexed.
-- Creating it fails, and the whole migration rolls back, if a workspace already has a repeated serial: the dry-run
-- shows that before the window.
CREATE UNIQUE INDEX "customer_assets_owner_serial" ON "customerAssets" ("ownerId",(upper(regexp_replace(btrim(serial),'\s+',' ','g')))) WHERE btrim(serial)<>'';
