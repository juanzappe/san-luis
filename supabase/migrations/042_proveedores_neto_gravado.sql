-- 042_proveedores_neto_gravado.sql
-- Revert get_comercial_proveedores() and get_detalle_proveedor() to use
-- imp_neto_gravado_total instead of imp_total.
--
-- The IVA paid to suppliers is recovered as tax credit (crédito fiscal),
-- so it's NOT a cost. Using imp_total inflated supplier costs ~2.4x
-- vs what the EERR shows (which correctly uses imp_neto_gravado_total
-- in get_egresos_mensual).
--
-- This makes Proveedores consistent with the EERR and Egresos views.

SET search_path = public;

-- ---------------------------------------------------------------------------
-- get_comercial_proveedores: use imp_neto_gravado_total
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
    SUM(COALESCE(fr.imp_neto_gravado_total, 0)),
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
-- get_detalle_proveedor: use imp_neto_gravado_total
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
    SUM(COALESCE(imp_neto_gravado_total, 0)),
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
