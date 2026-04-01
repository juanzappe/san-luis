-- Fix: get_cheque_mensual was returning raw movement totals instead of 1.2% tax.
-- Changes:
--   1. Use SUM(ABS(importe)) instead of SUM(ABS(debito))+SUM(ABS(credito))
--      since importe is NOT NULL and captures all movements
--   2. Ensure * 0.012 multiplier is applied (1.2% = Ley 25413)
--   3. Exclude COMPENSACION DE VALORES (large clearing txns, not taxable)
--   4. Keep excluding IMPUESTO LEY 25413 (the tax itself)

CREATE OR REPLACE FUNCTION get_cheque_mensual()
RETURNS TABLE(periodo text, importe_cheque numeric)
AS $$
  SELECT
    TO_CHAR(fecha, 'YYYY-MM'),
    SUM(ABS(importe)) * 0.012
  FROM movimiento_bancario
  WHERE concepto NOT ILIKE '%IMPUESTO LEY 25413%'
    AND concepto NOT ILIKE '%COMPENSACION DE VALORES%'
  GROUP BY 1

  UNION ALL

  SELECT
    TO_CHAR(fecha, 'YYYY-MM'),
    SUM(ABS(importe)) * 0.012
  FROM movimiento_mp
  GROUP BY 1
$$ LANGUAGE sql STABLE
SET statement_timeout = '30s';
