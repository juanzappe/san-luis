-- Migration 015: RPCs para la página Mostrador reestructurada
-- Reemplaza la carga de 170k+ filas de venta_detalle con agregaciones server-side

-- Índice para búsquedas por producto (case-insensitive)
CREATE INDEX IF NOT EXISTS idx_venta_detalle_producto_lower
    ON venta_detalle (LOWER(producto));

-- ---------------------------------------------------------------------------
-- 1. Mensual: monto, cantidad, transacciones — Secciones 1, 2, 3
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_mostrador_mensual()
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
    WHERE LOWER(COALESCE(vd.producto, '')) != 'restobar'
    GROUP BY 1
    ORDER BY 1
$$ LANGUAGE sql STABLE
SET statement_timeout = '30s';

-- ---------------------------------------------------------------------------
-- 2. Heatmap: día × hora — Sección 4
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_mostrador_heatmap()
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
    WHERE LOWER(COALESCE(vd.producto, '')) != 'restobar'
    GROUP BY 1, 2
$$ LANGUAGE sql STABLE
SET statement_timeout = '30s';

-- ---------------------------------------------------------------------------
-- 3. Lista de productos únicos para autocomplete — Sección 5
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_mostrador_productos_lista()
RETURNS TABLE(producto text) AS $$
    SELECT DISTINCT vd.producto
    FROM venta_detalle vd
    WHERE vd.producto IS NOT NULL
      AND LOWER(vd.producto) != 'restobar'
    ORDER BY 1
$$ LANGUAGE sql STABLE
SET statement_timeout = '30s';

-- ---------------------------------------------------------------------------
-- 4. Evolución semanal de un producto — Sección 5
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_mostrador_producto_semanal(p_producto text)
RETURNS TABLE(
    semana          text,
    semana_inicio   date,
    cantidad        numeric,
    monto           numeric
) AS $$
    SELECT
        TO_CHAR(DATE_TRUNC('week', v.fecha), 'IYYY-"W"IW'),
        DATE_TRUNC('week', v.fecha)::date,
        SUM(COALESCE(vd.cantidad, 0)),
        SUM(COALESCE(vd.neto, 0))
    FROM venta v
    JOIN venta_detalle vd ON vd.venta_id = v.id
    WHERE LOWER(vd.producto) = LOWER(p_producto)
      AND v.fecha >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '3 months'
    GROUP BY 1, 2
    ORDER BY 2
$$ LANGUAGE sql STABLE
SET statement_timeout = '30s';

-- ---------------------------------------------------------------------------
-- 5. Ranking de productos por mes — Sección 6
-- ---------------------------------------------------------------------------
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
            vd.cantidad,
            vd.neto,
            v.fecha::date AS dia
        FROM venta v
        JOIN venta_detalle vd ON vd.venta_id = v.id
        WHERE TO_CHAR(v.fecha, 'YYYY-MM') = p_periodo
          AND LOWER(COALESCE(vd.producto, '')) != 'restobar'
    )
    SELECT
        producto,
        SUM(cantidad),
        SUM(neto),
        COUNT(DISTINCT dia),
        CASE WHEN COUNT(DISTINCT dia) > 0
             THEN ROUND(SUM(cantidad) / COUNT(DISTINCT dia), 1)
             ELSE 0 END
    FROM detalles
    WHERE producto IS NOT NULL
    GROUP BY 1
    ORDER BY SUM(cantidad) DESC
$$ LANGUAGE sql STABLE
SET statement_timeout = '30s';
