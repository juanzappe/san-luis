-- Migration 073: fix get_mostrador_heatmap — count debe ser transacciones
-- distintas, no líneas de factura.
--
-- Antes: count = COUNT(*) sobre venta_detalle (cuenta cada renglón).
-- Ahora: count = COUNT(DISTINCT v.id) (cuenta ventas).
--
-- Esto hace que monto / count = ticket promedio por transacción, coincidiendo
-- con el KPI mensual (que también usa COUNT(DISTINCT v.id)).

DROP FUNCTION IF EXISTS get_mostrador_heatmap();

CREATE OR REPLACE FUNCTION get_mostrador_heatmap()
RETURNS TABLE(
    day    int,
    hour   int,
    monto  numeric,
    count  bigint
) AS $$
    SELECT
        EXTRACT(DOW FROM v.fecha)::int,
        EXTRACT(HOUR FROM v.fecha)::int,
        SUM(COALESCE(vd.neto, 0)),
        COUNT(DISTINCT v.id)
    FROM venta v
    JOIN venta_detalle vd ON vd.venta_id = v.id
    WHERE LOWER(COALESCE(vd.producto, '')) != 'restobar'
      AND NOT COALESCE(vd.excluir_analisis, false)
    GROUP BY 1, 2
$$ LANGUAGE sql STABLE
SET statement_timeout = '30s';
