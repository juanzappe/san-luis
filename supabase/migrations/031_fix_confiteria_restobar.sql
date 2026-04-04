-- Fix: reclassify "CONFITERIA" records as "restobar"
-- Since Sep 2025, some restobar sales were recorded with producto='CONFITERIA'
-- in the POS system. These are all restobar sales and should be classified as such.
UPDATE venta_detalle
SET producto = 'restobar',
    updated_at = now()
WHERE LOWER(producto) = 'confiteria';
