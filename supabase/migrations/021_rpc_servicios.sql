-- ---------------------------------------------------------------------------
-- RPCs for Servicios page — replaces client-side fetch that hits 1000-row limit
-- ---------------------------------------------------------------------------

-- 1. Monthly aggregation: público vs privado split
CREATE OR REPLACE FUNCTION get_servicios_mensual()
RETURNS TABLE(
    periodo   text,
    publico   numeric,
    privado   numeric,
    total     numeric,
    tx_count  bigint
) AS $$
    SELECT
        TO_CHAR(fe.fecha_emision, 'YYYY-MM') AS periodo,
        SUM(CASE
            WHEN LOWER(COALESCE(c.tipo_entidad, '')) LIKE '%público%'
              OR LOWER(COALESCE(c.tipo_entidad, '')) LIKE '%publico%'
            THEN CASE WHEN fe.tipo_comprobante IN (3, 8, 203)
                      THEN -COALESCE(fe.imp_neto_gravado_total, 0)
                      ELSE  COALESCE(fe.imp_neto_gravado_total, 0) END
            ELSE 0 END) AS publico,
        SUM(CASE
            WHEN NOT (LOWER(COALESCE(c.tipo_entidad, '')) LIKE '%público%'
                   OR LOWER(COALESCE(c.tipo_entidad, '')) LIKE '%publico%')
            THEN CASE WHEN fe.tipo_comprobante IN (3, 8, 203)
                      THEN -COALESCE(fe.imp_neto_gravado_total, 0)
                      ELSE  COALESCE(fe.imp_neto_gravado_total, 0) END
            ELSE 0 END) AS privado,
        SUM(CASE WHEN fe.tipo_comprobante IN (3, 8, 203)
                 THEN -COALESCE(fe.imp_neto_gravado_total, 0)
                 ELSE  COALESCE(fe.imp_neto_gravado_total, 0) END) AS total,
        COUNT(*)
    FROM factura_emitida fe
    LEFT JOIN cliente c ON c.cuit = fe.nro_doc_receptor
    WHERE fe.punto_venta = 6
    GROUP BY 1
    ORDER BY 1
$$ LANGUAGE sql STABLE
SET statement_timeout = '30s';

-- 2. Client aggregation with monthly breakdown (JSONB)
CREATE OR REPLACE FUNCTION get_servicios_clientes()
RETURNS TABLE(
    cuit            text,
    nombre          text,
    tipo_entidad    text,
    clasificacion   text,
    monto           numeric,
    cant_facturas   bigint,
    detalle_mensual jsonb
) AS $$
    WITH factura_signed AS (
        SELECT
            fe.nro_doc_receptor AS cuit,
            TO_CHAR(fe.fecha_emision, 'YYYY-MM') AS periodo,
            CASE WHEN fe.tipo_comprobante IN (3, 8, 203)
                 THEN -COALESCE(fe.imp_neto_gravado_total, 0)
                 ELSE  COALESCE(fe.imp_neto_gravado_total, 0) END AS monto
        FROM factura_emitida fe
        WHERE fe.punto_venta = 6
    ),
    por_cliente AS (
        SELECT
            COALESCE(fs.cuit, 'SIN_CUIT') AS cuit,
            SUM(fs.monto) AS monto,
            COUNT(*) AS cant_facturas,
            jsonb_agg(
                jsonb_build_object(
                    'periodo', fs.periodo,
                    'monto', fs.monto
                ) ORDER BY fs.periodo
            ) AS rows
        FROM factura_signed fs
        GROUP BY 1
    ),
    -- Aggregate monthly within the JSONB
    mensual_agg AS (
        SELECT
            pc.cuit,
            pc.monto,
            pc.cant_facturas,
            (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'periodo', sub.periodo,
                        'monto', sub.m,
                        'txCount', sub.c
                    ) ORDER BY sub.periodo
                )
                FROM (
                    SELECT
                        elem->>'periodo' AS periodo,
                        SUM((elem->>'monto')::numeric) AS m,
                        COUNT(*) AS c
                    FROM jsonb_array_elements(pc.rows) AS elem
                    GROUP BY 1
                ) sub
            ) AS detalle_mensual
        FROM por_cliente pc
    )
    SELECT
        ma.cuit,
        COALESCE(c.razon_social, ma.cuit)      AS nombre,
        COALESCE(c.tipo_entidad, 'Sin clasificar') AS tipo_entidad,
        COALESCE(c.clasificacion, 'Sin clasificar') AS clasificacion,
        ma.monto,
        ma.cant_facturas,
        COALESCE(ma.detalle_mensual, '[]'::jsonb)
    FROM mensual_agg ma
    LEFT JOIN cliente c ON c.cuit = ma.cuit
    ORDER BY ma.monto DESC
$$ LANGUAGE sql STABLE
SET statement_timeout = '30s';
