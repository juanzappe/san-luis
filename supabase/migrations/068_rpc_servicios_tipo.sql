-- Migration 068: RPCs for "Desglose por Tipo de Servicio".
--
-- Usa la clasificación exclusiva de 6 categorías (migración 067). Convenio
-- marco es una categoría más; no hace falta flag ortogonal.
--
-- Asigna el imp_neto_gravado_total del header a cada línea en proporción a
-- detalle.importe, así los totales calzan con el resto de la página.
--
-- Notas de crédito (tipo_comprobante 3, 8, 203) descuentan — signo -1.
--
-- Se DROP+CREATE porque cambia la forma de retorno vs. corridas anteriores.

DROP FUNCTION IF EXISTS get_servicios_tipo_mensual();
DROP FUNCTION IF EXISTS get_servicios_top_descripciones(int);
DROP FUNCTION IF EXISTS get_servicios_cliente_tipo();

-- ---------------------------------------------------------------------------
-- 1) get_servicios_tipo_mensual()
--    Agregado mensual por tipo_servicio.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_servicios_tipo_mensual()
RETURNS TABLE(
    periodo       text,
    tipo_servicio text,
    monto_neto    numeric,
    cantidad      numeric,
    lineas        bigint
) AS $$
    WITH importe_por_factura AS (
        SELECT fed.factura_id, SUM(fed.importe) AS sum_importe
        FROM factura_emitida_detalle fed
        GROUP BY 1
    ),
    detalle_alloc AS (
        SELECT
            TO_CHAR(fe.fecha_emision, 'YYYY-MM')    AS periodo,
            COALESCE(fed.tipo_servicio, 'otros')    AS tipo_servicio,
            COALESCE(fed.cantidad, 0)               AS cantidad,
            CASE
                WHEN COALESCE(ipf.sum_importe, 0) > 0
                THEN COALESCE(fed.importe, 0) * COALESCE(fe.imp_neto_gravado_total, 0) / ipf.sum_importe
                ELSE 0
            END AS monto_neto,
            CASE WHEN fe.tipo_comprobante IN (3, 8, 203) THEN -1 ELSE 1 END AS signo
        FROM factura_emitida fe
        JOIN factura_emitida_detalle fed ON fed.factura_id = fe.id
        LEFT JOIN importe_por_factura ipf ON ipf.factura_id = fe.id
        WHERE fe.punto_venta = 6
    )
    SELECT
        periodo,
        tipo_servicio,
        SUM(signo * monto_neto) AS monto_neto,
        SUM(signo * cantidad)   AS cantidad,
        COUNT(*)                AS lineas
    FROM detalle_alloc
    GROUP BY 1, 2
    ORDER BY 1, 2
$$ LANGUAGE sql STABLE SET statement_timeout = '30s';

-- ---------------------------------------------------------------------------
-- 2) get_servicios_top_descripciones(p_limit, p_tipo)
--    Top descripciones con cantidad total. Filtro opcional por tipo_servicio
--    (útil para la sección "Renglones más pedidos" que filtra a convenio_marco).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_servicios_top_descripciones(
    p_limit int DEFAULT 25,
    p_tipo  text DEFAULT NULL
)
RETURNS TABLE(
    descripcion   text,
    tipo_servicio text,
    monto_neto    numeric,
    cantidad      numeric,
    lineas        bigint,
    clientes      bigint
) AS $$
    WITH importe_por_factura AS (
        SELECT fed.factura_id, SUM(fed.importe) AS sum_importe
        FROM factura_emitida_detalle fed
        GROUP BY 1
    ),
    detalle_alloc AS (
        SELECT
            fed.descripcion,
            COALESCE(fed.tipo_servicio, 'otros')  AS tipo_servicio,
            COALESCE(fed.cantidad, 0)             AS cantidad,
            fe.nro_doc_receptor,
            CASE
                WHEN COALESCE(ipf.sum_importe, 0) > 0
                THEN COALESCE(fed.importe, 0) * COALESCE(fe.imp_neto_gravado_total, 0) / ipf.sum_importe
                ELSE 0
            END AS monto_neto,
            CASE WHEN fe.tipo_comprobante IN (3, 8, 203) THEN -1 ELSE 1 END AS signo
        FROM factura_emitida fe
        JOIN factura_emitida_detalle fed ON fed.factura_id = fe.id
        LEFT JOIN importe_por_factura ipf ON ipf.factura_id = fe.id
        WHERE fe.punto_venta = 6
          AND fed.descripcion IS NOT NULL
          AND LENGTH(TRIM(fed.descripcion)) > 0
    )
    SELECT
        descripcion,
        tipo_servicio,
        SUM(signo * monto_neto) AS monto_neto,
        SUM(signo * cantidad)   AS cantidad,
        COUNT(*)                AS lineas,
        COUNT(DISTINCT nro_doc_receptor) AS clientes
    FROM detalle_alloc
    WHERE p_tipo IS NULL OR tipo_servicio = p_tipo
    GROUP BY 1, 2
    ORDER BY monto_neto DESC
    LIMIT p_limit
$$ LANGUAGE sql STABLE SET statement_timeout = '30s';

-- ---------------------------------------------------------------------------
-- 3) get_servicios_cliente_tipo()
--    Crosstab cliente × tipo_servicio.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_servicios_cliente_tipo()
RETURNS TABLE(
    cuit          text,
    nombre        text,
    tipo_servicio text,
    monto_neto    numeric,
    lineas        bigint
) AS $$
    WITH importe_por_factura AS (
        SELECT fed.factura_id, SUM(fed.importe) AS sum_importe
        FROM factura_emitida_detalle fed
        GROUP BY 1
    ),
    detalle_alloc AS (
        SELECT
            COALESCE(fe.nro_doc_receptor, 'SIN_CUIT') AS cuit,
            COALESCE(fed.tipo_servicio, 'otros')      AS tipo_servicio,
            CASE
                WHEN COALESCE(ipf.sum_importe, 0) > 0
                THEN COALESCE(fed.importe, 0) * COALESCE(fe.imp_neto_gravado_total, 0) / ipf.sum_importe
                ELSE 0
            END AS monto_neto,
            CASE WHEN fe.tipo_comprobante IN (3, 8, 203) THEN -1 ELSE 1 END AS signo
        FROM factura_emitida fe
        JOIN factura_emitida_detalle fed ON fed.factura_id = fe.id
        LEFT JOIN importe_por_factura ipf ON ipf.factura_id = fe.id
        WHERE fe.punto_venta = 6
    )
    SELECT
        da.cuit,
        COALESCE(c.razon_social, da.cuit) AS nombre,
        da.tipo_servicio,
        SUM(da.signo * da.monto_neto) AS monto_neto,
        COUNT(*) AS lineas
    FROM detalle_alloc da
    LEFT JOIN cliente c ON c.cuit = da.cuit
    GROUP BY 1, 2, 3
    ORDER BY da.cuit, da.tipo_servicio
$$ LANGUAGE sql STABLE SET statement_timeout = '30s';
