-- Filter out anomalous sale lines where the cashier entered total amount as
-- quantity with precio_unitario = $1.  Any line with precio_unitario < 100
-- is excluded from the product ranking (quantity-based).  This does NOT affect
-- revenue totals (monto) which are correct regardless.

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
          AND COALESCE(vd.precio_unitario, 0) >= 100
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
