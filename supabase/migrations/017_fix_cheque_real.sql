-- Fix: Impuesto al Cheque — read actual debits instead of estimating 1.2%
-- The bank and MP already record the exact tax amounts as line items.
-- Banco Provincia: concepto contains "LEY 25413" (e.g. "IMPUESTO CREDITO -LEY 25413")
-- Mercado Pago: tipo_operacion contains "Créditos y Débitos"

CREATE OR REPLACE FUNCTION get_cheque_mensual()
RETURNS TABLE(periodo text, importe_cheque numeric)
AS $$
  -- Banco: actual LEY 25413 debits (excluding compensaciones)
  SELECT
    TO_CHAR(fecha, 'YYYY-MM'),
    SUM(ABS(importe))
  FROM movimiento_bancario
  WHERE concepto ILIKE '%LEY 25413%'
    AND concepto NOT ILIKE '%COMPENSACION%'
  GROUP BY 1

  UNION ALL

  -- Mercado Pago: Créditos y Débitos tax charges (excluding anulaciones)
  SELECT
    TO_CHAR(fecha, 'YYYY-MM'),
    SUM(ABS(importe))
  FROM movimiento_mp
  WHERE tipo_operacion ILIKE '%Créditos y Débitos%'
    AND tipo_operacion NOT ILIKE '%Anulación%'
  GROUP BY 1
$$ LANGUAGE sql STABLE
SET statement_timeout = '30s';
