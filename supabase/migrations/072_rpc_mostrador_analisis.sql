-- Migration 072: 3 RPCs nuevas para la página de Mostrador.
--
--   1. get_mostrador_producto_mensual(p_top, p_meses)
--      Top N productos por monto total + breakdown mensual. Usado para el
--      stacked area 100% "Mix de productos por mes".
--
--   2. get_mostrador_producto_tendencia(p_limit)
--      Productos en caída: compara últimas 4 semanas vs 4 semanas previas.
--      Devuelve delta % de cantidad.
--
--   3. get_mostrador_diario_mtd()
--      Serie diaria acumulada para MTD (mes actual), mismo tramo del mes
--      anterior y mismo tramo del año pasado.
--
-- Todas excluyen Restobar y registros con excluir_analisis=true (mismo filtro
-- que get_mostrador_mensual).

DROP FUNCTION IF EXISTS get_mostrador_producto_mensual(int, int);
DROP FUNCTION IF EXISTS get_mostrador_producto_tendencia(int);
DROP FUNCTION IF EXISTS get_mostrador_diario_mtd();

-- ---------------------------------------------------------------------------
-- 1) get_mostrador_producto_mensual(p_top, p_meses)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_mostrador_producto_mensual(
    p_top    int DEFAULT 8,
    p_meses  int DEFAULT 24
)
RETURNS TABLE(
    periodo    text,
    producto   text,
    monto      numeric,
    cantidad   numeric
) AS $$
    WITH cutoff AS (
        SELECT DATE_TRUNC('month', CURRENT_DATE)::date - (p_meses * INTERVAL '1 month') AS desde
    ),
    ventas_filtradas AS (
        SELECT
            TO_CHAR(v.fecha, 'YYYY-MM') AS periodo,
            vd.producto,
            vd.neto,
            vd.cantidad
        FROM venta v
        JOIN venta_detalle vd ON vd.venta_id = v.id
        CROSS JOIN cutoff
        WHERE v.fecha >= cutoff.desde
          AND vd.producto IS NOT NULL
          AND LOWER(vd.producto) NOT IN ('restobar', '')
          AND COALESCE(vd.precio_unitario, 0) >= 100
          AND NOT COALESCE(vd.excluir_analisis, false)
    ),
    top_productos AS (
        SELECT producto
        FROM ventas_filtradas
        GROUP BY 1
        ORDER BY SUM(COALESCE(neto, 0)) DESC
        LIMIT p_top
    )
    SELECT
        vf.periodo,
        CASE WHEN tp.producto IS NOT NULL THEN vf.producto ELSE 'Resto' END AS producto,
        SUM(COALESCE(vf.neto, 0)),
        SUM(COALESCE(vf.cantidad, 0))
    FROM ventas_filtradas vf
    LEFT JOIN top_productos tp ON tp.producto = vf.producto
    GROUP BY 1, 2
    ORDER BY 1, 2
$$ LANGUAGE sql STABLE SET statement_timeout = '30s';

-- ---------------------------------------------------------------------------
-- 2) get_mostrador_producto_tendencia(p_limit)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_mostrador_producto_tendencia(
    p_limit int DEFAULT 20
)
RETURNS TABLE(
    producto        text,
    cant_reciente   numeric,
    cant_previa     numeric,
    delta_pct       numeric,
    monto_reciente  numeric
) AS $$
    WITH hoy AS (
        SELECT CURRENT_DATE AS d
    ),
    ventanas AS (
        SELECT
            vd.producto,
            COALESCE(vd.cantidad, 0) AS cantidad,
            COALESCE(vd.neto, 0)     AS neto,
            CASE
                WHEN v.fecha >= (SELECT d FROM hoy) - INTERVAL '28 days'  THEN 'reciente'
                WHEN v.fecha >= (SELECT d FROM hoy) - INTERVAL '56 days'
                 AND v.fecha <  (SELECT d FROM hoy) - INTERVAL '28 days' THEN 'previa'
                ELSE NULL
            END AS ventana
        FROM venta v
        JOIN venta_detalle vd ON vd.venta_id = v.id
        WHERE v.fecha >= (SELECT d FROM hoy) - INTERVAL '56 days'
          AND vd.producto IS NOT NULL
          AND LOWER(vd.producto) NOT IN ('restobar', '')
          AND COALESCE(vd.precio_unitario, 0) >= 100
          AND NOT COALESCE(vd.excluir_analisis, false)
    ),
    agg AS (
        SELECT
            producto,
            SUM(CASE WHEN ventana = 'reciente' THEN cantidad ELSE 0 END) AS cant_reciente,
            SUM(CASE WHEN ventana = 'previa'   THEN cantidad ELSE 0 END) AS cant_previa,
            SUM(CASE WHEN ventana = 'reciente' THEN neto     ELSE 0 END) AS monto_reciente
        FROM ventanas
        WHERE ventana IS NOT NULL
        GROUP BY 1
    )
    SELECT
        producto,
        cant_reciente,
        cant_previa,
        CASE
          WHEN cant_previa > 0 THEN ROUND(((cant_reciente - cant_previa) / cant_previa * 100)::numeric, 1)
          ELSE NULL
        END AS delta_pct,
        monto_reciente
    FROM agg
    -- Filtro mínimo: que haya vendido al menos 5 unidades en alguna ventana
    -- (sino cualquier producto ultra-marginal aparece con -100%).
    WHERE cant_previa >= 5 OR cant_reciente >= 5
    ORDER BY delta_pct ASC NULLS LAST
    LIMIT p_limit
$$ LANGUAGE sql STABLE SET statement_timeout = '30s';

-- ---------------------------------------------------------------------------
-- 3) get_mostrador_diario_mtd()
--    Tres series diarias: mes actual, mes anterior y mismo mes año anterior,
--    todas expresadas como "día del mes" para superponer en un line chart.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_mostrador_diario_mtd()
RETURNS TABLE(
    serie    text,    -- 'actual' | 'mes_anterior' | 'año_anterior'
    dia_mes  int,
    monto    numeric,
    acumulado numeric
) AS $$
    WITH hoy AS (
        SELECT CURRENT_DATE AS d
    ),
    rangos AS (
        SELECT
            DATE_TRUNC('month', d)::date                                        AS actual_ini,
            d                                                                   AS actual_fin,
            DATE_TRUNC('month', d - INTERVAL '1 month')::date                   AS ma_ini,
            (DATE_TRUNC('month', d - INTERVAL '1 month')::date + EXTRACT(DAY FROM d)::int - 1)::date AS ma_fin,
            DATE_TRUNC('month', d - INTERVAL '1 year')::date                    AS aa_ini,
            (DATE_TRUNC('month', d - INTERVAL '1 year')::date + EXTRACT(DAY FROM d)::int - 1)::date  AS aa_fin
        FROM hoy
    ),
    ventas_diarias AS (
        SELECT
            v.fecha::date AS fecha,
            SUM(COALESCE(vd.neto, 0)) AS monto
        FROM venta v
        JOIN venta_detalle vd ON vd.venta_id = v.id
        CROSS JOIN rangos r
        WHERE LOWER(COALESCE(vd.producto, '')) NOT IN ('restobar', '')
          AND NOT COALESCE(vd.excluir_analisis, false)
          AND (
                (v.fecha >= r.actual_ini AND v.fecha <= r.actual_fin)
             OR (v.fecha >= r.ma_ini     AND v.fecha <= r.ma_fin)
             OR (v.fecha >= r.aa_ini     AND v.fecha <= r.aa_fin)
          )
        GROUP BY 1
    ),
    etiquetadas AS (
        SELECT
            CASE
                WHEN vd.fecha >= r.actual_ini AND vd.fecha <= r.actual_fin THEN 'actual'
                WHEN vd.fecha >= r.ma_ini     AND vd.fecha <= r.ma_fin     THEN 'mes_anterior'
                WHEN vd.fecha >= r.aa_ini     AND vd.fecha <= r.aa_fin     THEN 'año_anterior'
            END AS serie,
            EXTRACT(DAY FROM vd.fecha)::int AS dia_mes,
            vd.monto
        FROM ventas_diarias vd
        CROSS JOIN rangos r
    )
    SELECT
        serie,
        dia_mes,
        monto,
        SUM(monto) OVER (PARTITION BY serie ORDER BY dia_mes) AS acumulado
    FROM etiquetadas
    WHERE serie IS NOT NULL
    ORDER BY serie, dia_mes
$$ LANGUAGE sql STABLE SET statement_timeout = '30s';
