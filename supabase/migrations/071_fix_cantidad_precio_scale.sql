-- Migration 071: Corregir scale de cantidad y precio_unitario (pero no importe).
--
-- Después de las migraciones 067 y 069 (scale round 1 + undo double-apply),
-- cantidad × precio = importe = imp_total del header, matemáticamente
-- consistente. Pero los valores absolutos estaban en escala incorrecta:
--   cantidad: 100x más grande de lo real (ej: 1420 en lugar de 14.20)
--   precio:   100x más chico de lo real (ej: 800 en lugar de 80000)
--
-- Esta migración divide cantidad por 100 y multiplica precio por 100.
-- El producto se mantiene, así que importe no se toca.
--
-- ⚠ IMPORTANTE: correr EXACTAMENTE UNA VEZ. Si ya se corrió, no hacer de nuevo.
-- Verificación rápida post-migración: factura 4329 (viandas mes enero) debe
-- tener cantidad=14.20 y precio_unitario=80000.

BEGIN;

UPDATE factura_emitida_detalle
SET cantidad        = cantidad / 100,
    precio_unitario = precio_unitario * 100
WHERE cantidad IS NOT NULL OR precio_unitario IS NOT NULL;

COMMIT;
