-- Fix: ranking de productos debe usar SUM(cantidad) en vez de COUNT(*)
-- y excluir RESTOBAR del listado.
-- This is a standalone re-creation to ensure the fix is applied even if
-- migration 015 was partially applied or skipped.

CREATE OR REPLACE FUNCTION get_mostrador_ranking_mensual(p_periodo text)
RETURNS TABLE(
    producto        text,
    total_cantidad  numeric,
    total_monto     numeric,
    dias_con_venta  bigint,
    promedio_diario numeric
) AS $$
    WITH detalles AS (
        SELECT
            vd.producto,
            COALESCE(vd.cantidad, 1) AS cantidad,
            COALESCE(vd.neto, 0)     AS neto,
            v.fecha::date            AS dia
        FROM venta v
        JOIN venta_detalle vd ON vd.venta_id = v.id
        WHERE TO_CHAR(v.fecha, 'YYYY-MM') = p_periodo
          AND LOWER(COALESCE(vd.producto, '')) NOT IN ('restobar', '')
    )
    SELECT
        d.producto,
        SUM(d.cantidad),
        SUM(d.neto),
        COUNT(DISTINCT d.dia),
        CASE WHEN COUNT(DISTINCT d.dia) > 0
             THEN ROUND(SUM(d.cantidad) / COUNT(DISTINCT d.dia), 1)
             ELSE 0 END
    FROM detalles d
    WHERE d.producto IS NOT NULL
    GROUP BY 1
    ORDER BY SUM(d.cantidad) DESC
$$ LANGUAGE sql STABLE
SET statement_timeout = '30s';
