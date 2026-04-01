-- Fix: add missing index on venta.factura_emitida_id
-- Without this index, any INSERT/DELETE on factura_emitida triggers a
-- sequential scan of 200k+ rows in venta for FK constraint checking,
-- causing statement_timeout on Supabase.

CREATE INDEX IF NOT EXISTS idx_venta_factura_emitida_id
ON venta(factura_emitida_id);
