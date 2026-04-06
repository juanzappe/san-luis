-- 043_popular_proveedor_id.sql
-- Populate proveedor_id in factura_recibida by matching nro_doc_emisor = cuit.
-- This adds referential integrity for invoices whose supplier exists in the
-- proveedor table. Invoices from suppliers not in the table remain with
-- proveedor_id = NULL.

UPDATE factura_recibida fr
SET proveedor_id = p.id
FROM proveedor p
WHERE fr.nro_doc_emisor = p.cuit
  AND fr.proveedor_id IS NULL;
