-- 044_proveedores_credit_notes.sql
-- Fix: handle credit note signs in SQL (same pattern as get_egresos_mensual).
--
-- Previously, get_comercial_proveedores did SUM(imp_neto_gravado_total) which
-- treats credit notes (tipo 3, 8, 203) as positive, inflating the total.
-- The frontend tried to sign-flip but caused ~50% data loss.
--
-- Now: SUM(CASE WHEN tipo IN (3,8,203) THEN -val ELSE val END)
-- Also: tipo_comprobante removed from GROUP BY and return (not needed downstream).

SET search_path = public;

-- ---------------------------------------------------------------------------
-- get_comercial_proveedores: credit notes handled in SQL
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_comercial_proveedores()
RETURNS TABLE(
  periodo          text,
  cuit             text,
  denominacion     text,
  total_neto       numeric,
  cantidad         bigint,
  tipo_costo       text,
  categoria_egreso text
) AS $$
  SELECT
    TO_CHAR(fr.fecha_emision, 'YYYY-MM'),
    COALESCE(fr.nro_doc_emisor, 'SIN_CUIT'),
    COALESCE(fr.denominacion_emisor, 'Sin nombre'),
    SUM(CASE WHEN fr.tipo_comprobante IN (3, 8, 203)
             THEN -COALESCE(fr.imp_neto_gravado_total, 0)
             ELSE  COALESCE(fr.imp_neto_gravado_total, 0) END),
    COUNT(*),
    COALESCE(p.tipo_costo, 'Sin clasificar'),
    COALESCE(p.categoria_egreso, 'Sin clasificar')
  FROM factura_recibida fr
  LEFT JOIN proveedor p ON p.cuit = fr.nro_doc_emisor
  GROUP BY 1, 2, 3, 6, 7
$$ LANGUAGE sql STABLE
SET statement_timeout = '30s';

-- ---------------------------------------------------------------------------
-- get_detalle_proveedor: credit notes handled in SQL
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_detalle_proveedor(p_cuit text)
RETURNS TABLE(
  periodo                text,
  total_neto             numeric,
  cantidad               bigint,
  primera_fecha          date,
  ultima_fecha           date,
  cant_fechas_distintas  bigint
) AS $$
  SELECT
    TO_CHAR(fecha_emision, 'YYYY-MM'),
    SUM(CASE WHEN tipo_comprobante IN (3, 8, 203)
             THEN -COALESCE(imp_neto_gravado_total, 0)
             ELSE  COALESCE(imp_neto_gravado_total, 0) END),
    COUNT(*),
    MIN(fecha_emision),
    MAX(fecha_emision),
    COUNT(DISTINCT fecha_emision)
  FROM factura_recibida
  WHERE nro_doc_emisor = p_cuit
  GROUP BY 1
$$ LANGUAGE sql STABLE
SET statement_timeout = '30s';
