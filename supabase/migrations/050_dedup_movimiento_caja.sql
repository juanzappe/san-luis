-- 050_dedup_movimiento_caja.sql
-- Remove duplicate rows from movimiento_caja (mainly March 2026).
-- Keeps the row with the lowest id for each (fecha, importe, condicion_pago, tipo) group.

DELETE FROM movimiento_caja a
USING movimiento_caja b
WHERE a.id > b.id
  AND a.fecha = b.fecha
  AND a.importe = b.importe
  AND COALESCE(a.condicion_pago, '') = COALESCE(b.condicion_pago, '')
  AND COALESCE(a.tipo, '') = COALESCE(b.tipo, '')
  AND COALESCE(a.documento, '') = COALESCE(b.documento, '')
  AND COALESCE(a.punto_venta, 0) = COALESCE(b.punto_venta, 0)
  AND COALESCE(a.numero, 0) = COALESCE(b.numero, 0);

-- Add a unique index to prevent future duplicates at the DB level.
-- Uses all business-key columns that together identify a unique POS transaction.
CREATE UNIQUE INDEX IF NOT EXISTS uq_movimiento_caja_natural_key
  ON movimiento_caja (
    fecha,
    COALESCE(condicion_pago, ''),
    COALESCE(documento, ''),
    COALESCE(punto_venta, 0),
    COALESCE(numero, 0),
    importe,
    COALESCE(tipo, '')
  );
