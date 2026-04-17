-- Migration 075: Restobar — misma redefinición que Mostrador (mig 073 + 074).
--
-- Cambios:
--   - get_restobar_mensual: agrega dias_con_venta (para facturación diaria).
--   - get_restobar_heatmap: count ahora es COUNT(DISTINCT v.id) (ventas
--     distintas), no COUNT(*) sobre venta_detalle (líneas).
--   - get_restobar_ticket_por_dow: nuevo RPC, promedia tickets diarios por DOW.
--
-- Todos filtran producto = 'restobar' y excluir_analisis=true.

DROP FUNCTION IF EXISTS get_restobar_mensual();
DROP FUNCTION IF EXISTS get_restobar_heatmap();
DROP FUNCTION IF EXISTS get_restobar_ticket_por_dow();

-- ---------------------------------------------------------------------------
-- 1) get_restobar_mensual (+ dias_con_venta)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_restobar_mensual()
RETURNS TABLE(
    periodo         text,
    monto           numeric,
    cantidad        numeric,
    tx_count        bigint,
    dias_con_venta  bigint
) AS $$
    SELECT
        TO_CHAR(v.fecha, 'YYYY-MM')        AS periodo,
        SUM(COALESCE(vd.neto, 0))          AS monto,
        SUM(COALESCE(vd.cantidad, 0))      AS cantidad,
        COUNT(DISTINCT v.id)                AS tx_count,
        COUNT(DISTINCT v.fecha::date)      AS dias_con_venta
    FROM venta v
    JOIN venta_detalle vd ON vd.venta_id = v.id
    WHERE LOWER(COALESCE(vd.producto, '')) = 'restobar'
      AND NOT COALESCE(vd.excluir_analisis, false)
    GROUP BY 1
    ORDER BY 1
$$ LANGUAGE sql STABLE SET statement_timeout = '30s';

-- ---------------------------------------------------------------------------
-- 2) get_restobar_heatmap — count = ventas distintas, no líneas
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_restobar_heatmap()
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
    WHERE LOWER(COALESCE(vd.producto, '')) = 'restobar'
      AND NOT COALESCE(vd.excluir_analisis, false)
    GROUP BY 1, 2
$$ LANGUAGE sql STABLE SET statement_timeout = '30s';

-- ---------------------------------------------------------------------------
-- 3) get_restobar_ticket_por_dow
--    Promedio del ticket diario agrupado por día de la semana.
--    Por cada fecha: ticket_dia = monto_dia / tx_dia.
--    Después: AVG(ticket_dia) por DOW.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_restobar_ticket_por_dow()
RETURNS TABLE(
    dow              int,
    ticket_promedio  numeric,
    dias_con_venta   bigint,
    ventas_totales   bigint
) AS $$
    WITH por_dia AS (
        SELECT
            v.fecha::date                     AS fecha,
            EXTRACT(DOW FROM v.fecha)::int    AS dow,
            SUM(COALESCE(vd.neto, 0))         AS monto_dia,
            COUNT(DISTINCT v.id)               AS tx_dia
        FROM venta v
        JOIN venta_detalle vd ON vd.venta_id = v.id
        WHERE LOWER(COALESCE(vd.producto, '')) = 'restobar'
          AND NOT COALESCE(vd.excluir_analisis, false)
        GROUP BY 1, 2
    )
    SELECT
        dow,
        AVG(monto_dia / NULLIF(tx_dia, 0))    AS ticket_promedio,
        COUNT(*)                              AS dias_con_venta,
        SUM(tx_dia)                           AS ventas_totales
    FROM por_dia
    WHERE tx_dia > 0
    GROUP BY dow
    ORDER BY dow
$$ LANGUAGE sql STABLE SET statement_timeout = '30s';
