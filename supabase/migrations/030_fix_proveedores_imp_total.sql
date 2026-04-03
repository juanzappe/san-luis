-- 030_fix_proveedores_imp_total.sql
-- Fix: get_comercial_proveedores() y get_detalle_proveedor() usaban
-- imp_neto_gravado_total (base imponible neta, sin IVA ni otros tributos),
-- lo que subestimaba el total de compras frente a imp_total.
--
-- imp_neto_gravado_total ≈ base gravada (≈41% del total en este dataset)
-- imp_total = imp_neto_gravado + IVA + otros_tributos + no_gravado + exentas
--           = monto real de la factura — lo que coincide con SUM(imp_total)
--
-- Verificación (ejecutar en Supabase SQL Editor para los últimos 12 meses):
--   SELECT
--     SUM(COALESCE(imp_neto_gravado_total,0)) AS neto_gravado,
--     SUM(COALESCE(imp_total,0))              AS total_factura
--   FROM factura_recibida
--   WHERE fecha_emision >= (CURRENT_DATE - INTERVAL '12 months')
--     AND tipo_comprobante NOT IN (3, 8, 203);
-- Esperar: neto_gravado ≈ $584M, total_factura ≈ $1.410M

SET search_path = public;

-- ---------------------------------------------------------------------------
-- get_comercial_proveedores: usa imp_total en lugar de imp_neto_gravado_total
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_comercial_proveedores()
RETURNS TABLE(
  periodo          text,
  cuit             text,
  denominacion     text,
  total_neto       numeric,
  cantidad         bigint,
  tipo_comprobante int,
  tipo_costo       text,
  categoria_egreso text
) AS $$
  SELECT
    TO_CHAR(fr.fecha_emision, 'YYYY-MM'),
    COALESCE(fr.nro_doc_emisor, 'SIN_CUIT'),
    COALESCE(fr.denominacion_emisor, 'Sin nombre'),
    SUM(COALESCE(fr.imp_total, 0)),
    COUNT(*),
    fr.tipo_comprobante::int,
    COALESCE(p.tipo_costo, 'Sin clasificar'),
    COALESCE(p.categoria_egreso, 'Sin clasificar')
  FROM factura_recibida fr
  LEFT JOIN proveedor p ON p.cuit = fr.nro_doc_emisor
  GROUP BY 1, 2, 3, 6, 7, 8
$$ LANGUAGE sql STABLE
SET statement_timeout = '30s';

-- ---------------------------------------------------------------------------
-- get_detalle_proveedor: ídem, usa imp_total
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_detalle_proveedor(p_cuit text)
RETURNS TABLE(
  periodo                text,
  total_neto             numeric,
  cantidad               bigint,
  tipo_comprobante       int,
  primera_fecha          date,
  ultima_fecha           date,
  cant_fechas_distintas  bigint
) AS $$
  SELECT
    TO_CHAR(fecha_emision, 'YYYY-MM'),
    SUM(COALESCE(imp_total, 0)),
    COUNT(*),
    tipo_comprobante::int,
    MIN(fecha_emision),
    MAX(fecha_emision),
    COUNT(DISTINCT fecha_emision)
  FROM factura_recibida
  WHERE nro_doc_emisor = p_cuit
  GROUP BY 1, 4
$$ LANGUAGE sql STABLE
SET statement_timeout = '30s';
