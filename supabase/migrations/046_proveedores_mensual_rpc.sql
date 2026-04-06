-- 046_proveedores_mensual_rpc.sql
-- New lightweight RPC that returns monthly totals for proveedores.
-- Only ~48 rows (4 years × 12 months), so it never hits the Supabase
-- 1000-row default limit that truncates get_comercial_proveedores (~7000+ rows).
--
-- Used by the Proveedores page KPI and delta calculations for accurate totals.
-- Uses the same full net formula (neto_gravado + no_gravado + exentas) from migration 045.

SET search_path = public;

CREATE OR REPLACE FUNCTION get_proveedores_mensual()
RETURNS TABLE(periodo text, total_neto numeric, cantidad bigint)
LANGUAGE sql STABLE
SET statement_timeout TO '30s'
AS $$
  SELECT
    TO_CHAR(fecha_emision, 'YYYY-MM') AS periodo,
    SUM(CASE WHEN tipo_comprobante IN (3, 8, 203)
             THEN -(COALESCE(imp_neto_gravado_total, 0) + COALESCE(imp_neto_no_gravado, 0) + COALESCE(imp_op_exentas, 0))
             ELSE   COALESCE(imp_neto_gravado_total, 0) + COALESCE(imp_neto_no_gravado, 0) + COALESCE(imp_op_exentas, 0) END) AS total_neto,
    COUNT(*) AS cantidad
  FROM factura_recibida
  GROUP BY 1
  ORDER BY 1;
$$;
