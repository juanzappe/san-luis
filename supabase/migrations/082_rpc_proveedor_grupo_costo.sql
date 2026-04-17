-- 082_rpc_proveedor_grupo_costo.sql
--
-- Extiende get_comercial_proveedores para devolver grupo_costo
-- (operativo | comercial) agregado en la migración 079. El resto del RPC
-- es idéntico a migración 045.
--
-- Nota: Postgres no permite cambiar la firma (RETURNS TABLE) con CREATE OR
-- REPLACE, hace falta DROP + CREATE.

DROP FUNCTION IF EXISTS get_comercial_proveedores();

CREATE FUNCTION get_comercial_proveedores()
RETURNS TABLE(
  periodo          text,
  cuit             text,
  denominacion     text,
  total_neto       numeric,
  cantidad         bigint,
  tipo_costo       text,
  categoria_egreso text,
  grupo_costo      text
) AS $$
  SELECT
    TO_CHAR(fr.fecha_emision, 'YYYY-MM'),
    COALESCE(fr.nro_doc_emisor, 'SIN_CUIT'),
    COALESCE(fr.denominacion_emisor, 'Sin nombre'),
    SUM(CASE WHEN fr.tipo_comprobante IN (3, 8, 203)
             THEN -(COALESCE(fr.imp_neto_gravado_total, 0) + COALESCE(fr.imp_neto_no_gravado, 0) + COALESCE(fr.imp_op_exentas, 0))
             ELSE   COALESCE(fr.imp_neto_gravado_total, 0) + COALESCE(fr.imp_neto_no_gravado, 0) + COALESCE(fr.imp_op_exentas, 0) END),
    COUNT(*),
    COALESCE(p.tipo_costo, 'Sin clasificar'),
    COALESCE(p.categoria_egreso, 'Sin clasificar'),
    COALESCE(p.grupo_costo, 'Sin clasificar')
  FROM factura_recibida fr
  LEFT JOIN proveedor p ON p.cuit = fr.nro_doc_emisor
  GROUP BY 1, 2, 3, 6, 7, 8
$$ LANGUAGE sql STABLE
SET statement_timeout = '30s';
