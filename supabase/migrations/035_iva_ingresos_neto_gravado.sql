-- Add neto_gravado column to get_iva_ingresos_mensual.
-- Used as base for IIBB (4.5%) and Seg. e Hig. (1%) calculations.

CREATE OR REPLACE FUNCTION get_iva_ingresos_mensual()
RETURNS TABLE(periodo text, iva_debito numeric, iva_credito numeric, ingresos numeric, neto_gravado numeric)
AS $$
  SELECT
    TO_CHAR(fecha_emision, 'YYYY-MM'),
    SUM(CASE WHEN tipo_comprobante IN (3,8,203) THEN -total_iva ELSE total_iva END),
    0::numeric,
    SUM(CASE WHEN tipo_comprobante IN (3,8,203) THEN -imp_total ELSE imp_total END),
    SUM(CASE WHEN tipo_comprobante IN (3,8,203) THEN -imp_neto_gravado_total ELSE imp_neto_gravado_total END)
  FROM factura_emitida
  GROUP BY 1

  UNION ALL

  SELECT
    TO_CHAR(fecha_emision, 'YYYY-MM'),
    0::numeric,
    SUM(CASE WHEN tipo_comprobante IN (3,8,203) THEN -total_iva ELSE total_iva END),
    0::numeric,
    0::numeric
  FROM factura_recibida
  GROUP BY 1
$$ LANGUAGE sql STABLE
SET statement_timeout = '30s';
