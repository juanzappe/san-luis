-- Migration 018: RPCs para la página Restobar
-- Reemplaza la carga de todas las filas de venta_detalle con agregaciones server-side
-- Usa el índice idx_venta_detalle_producto_lower ya creado en migración 015

-- ---------------------------------------------------------------------------
-- 1. Mensual: monto, cantidad, transacciones — Secciones 1, 2, 3
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_restobar_mensual()
RETURNS TABLE(
    periodo     text,
    monto       numeric,
    cantidad    numeric,
    tx_count    bigint
) AS $$
    SELECT
        TO_CHAR(v.fecha, 'YYYY-MM'),
        SUM(COALESCE(vd.neto, 0)),
        SUM(COALESCE(vd.cantidad, 0)),
        COUNT(DISTINCT v.id)
    FROM venta v
    JOIN venta_detalle vd ON vd.venta_id = v.id
    WHERE LOWER(COALESCE(vd.producto, '')) = 'restobar'
    GROUP BY 1
    ORDER BY 1
$$ LANGUAGE sql STABLE
SET statement_timeout = '30s';

-- ---------------------------------------------------------------------------
-- 2. Heatmap: día × hora — Sección 4
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_restobar_heatmap()
RETURNS TABLE(
    day     int,
    hour    int,
    monto   numeric,
    count   bigint
) AS $$
    SELECT
        EXTRACT(DOW FROM v.fecha)::int,
        EXTRACT(HOUR FROM v.fecha)::int,
        SUM(COALESCE(vd.neto, 0)),
        COUNT(*)
    FROM venta v
    JOIN venta_detalle vd ON vd.venta_id = v.id
    WHERE LOWER(COALESCE(vd.producto, '')) = 'restobar'
    GROUP BY 1, 2
$$ LANGUAGE sql STABLE
SET statement_timeout = '30s';
