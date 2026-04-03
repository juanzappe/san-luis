-- Fix: Impuesto al Cheque — extender patrón para cubrir variante Santander
-- Provincia: "IMPUESTO CREDITO -LEY 25413"  → matchea '%25413%'
-- Santander: "Impuesto ley 25.413 debito 0,6%" → matchea '%25.413%'
-- La condición anterior '%LEY 25413%' no matcheaba la variante con punto (25.413).

CREATE OR REPLACE FUNCTION get_cheque_mensual()
RETURNS TABLE(periodo text, importe_cheque numeric)
AS $$
  -- Banco: actual LEY 25413 debits — cubre Provincia (25413) y Santander (25.413)
  SELECT
    TO_CHAR(fecha, 'YYYY-MM'),
    SUM(ABS(importe))
  FROM movimiento_bancario
  WHERE (concepto ILIKE '%25413%' OR concepto ILIKE '%25.413%')
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
