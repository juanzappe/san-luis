-- 048_financieros_desglosado.sql
-- RPC to return financial expenses broken down by category per month.
--
-- Categories:
--   comisiones_bancarias — bank commissions, maintenance, stamp taxes (sellados)
--   intereses            — interest charges (overdraft, financing, late payment)
--   seguros              — insurance debits
--   comisiones_mp        — Mercado Pago platform costs (excl. supplier payments, withdrawals, cheque)
--   otros                — anything else matching the original financial pattern
--
-- IMPORTANT: Impuesto al Cheque (LEY 25413) is EXCLUDED from this breakdown.
-- It is handled separately via get_cheque_mensual() and belongs to Gastos Comerciales / Impuestos.

SET search_path = public;

CREATE OR REPLACE FUNCTION get_financieros_desglosado()
RETURNS TABLE(
  periodo text,
  comisiones_bancarias numeric,
  intereses numeric,
  seguros numeric,
  comisiones_mp numeric,
  otros numeric
)
LANGUAGE sql STABLE
SET statement_timeout TO '15s'
AS $$
  WITH banco AS (
    SELECT
      TO_CHAR(fecha, 'YYYY-MM') AS periodo,
      SUM(CASE
        WHEN LOWER(COALESCE(concepto, '')) LIKE '%interes%'
        THEN COALESCE(debito, 0) ELSE 0
      END) AS intereses,
      SUM(CASE
        WHEN LOWER(COALESCE(concepto, '')) LIKE '%seguro%'
             AND LOWER(COALESCE(concepto, '')) NOT LIKE '%interes%'
        THEN COALESCE(debito, 0) ELSE 0
      END) AS seguros,
      SUM(CASE
        WHEN LOWER(COALESCE(concepto, '')) LIKE '%interes%' THEN 0
        WHEN LOWER(COALESCE(concepto, '')) LIKE '%seguro%' THEN 0
        WHEN LOWER(COALESCE(concepto, '')) LIKE ANY(ARRAY[
          '%comision%', '%mantenimiento%', '%sellado%'
        ]) THEN COALESCE(debito, 0)
        ELSE 0
      END) AS comisiones_bancarias,
      SUM(CASE
        WHEN LOWER(COALESCE(concepto, '')) LIKE '%interes%' THEN 0
        WHEN LOWER(COALESCE(concepto, '')) LIKE '%seguro%' THEN 0
        WHEN LOWER(COALESCE(concepto, '')) LIKE ANY(ARRAY[
          '%comision%', '%mantenimiento%', '%sellado%'
        ]) THEN 0
        ELSE COALESCE(debito, 0)
      END) AS otros
    FROM movimiento_bancario
    WHERE COALESCE(debito, 0) > 0
      -- Match the same patterns as the original fin CTE
      AND LOWER(COALESCE(concepto, '')) LIKE ANY(ARRAY[
        '%comision%', '%interes%', '%mantenimiento%', '%seguro%', '%sellado%'
      ])
      -- EXCLUDE Impuesto al Cheque (LEY 25413) — handled by get_cheque_mensual()
      AND COALESCE(concepto, '') NOT ILIKE '%25413%'
      AND COALESCE(concepto, '') NOT ILIKE '%25.413%'
      -- EXCLUDE generic "impuesto s/debito" and "impuesto s/credito" which are Imp al Cheque
      AND LOWER(COALESCE(concepto, '')) NOT LIKE '%impuesto s/deb%'
      AND LOWER(COALESCE(concepto, '')) NOT LIKE '%impuesto s/cred%'
    GROUP BY 1
  ),
  mp AS (
    SELECT
      TO_CHAR(fecha, 'YYYY-MM') AS periodo,
      SUM(ABS(COALESCE(importe, 0))) AS comisiones_mp
    FROM movimiento_mp
    WHERE COALESCE(importe, 0) < 0
      -- Only platform costs (commissions, withholdings, etc.)
      -- Exclude: withdrawals (internal), supplier payments, Imp al Cheque
      AND COALESCE(tipo_operacion, '') NOT ILIKE '%Retiro de dinero%'
      AND COALESCE(tipo_operacion, '') NOT IN ('Pago', 'Movimiento General')
      AND COALESCE(tipo_operacion, '') NOT ILIKE '%Créditos y Débitos%'
      AND COALESCE(tipo_operacion, '') NOT ILIKE '%Anulación%'
    GROUP BY 1
  )
  SELECT
    COALESCE(b.periodo, m.periodo),
    COALESCE(b.comisiones_bancarias, 0),
    COALESCE(b.intereses, 0),
    COALESCE(b.seguros, 0),
    COALESCE(m.comisiones_mp, 0),
    COALESCE(b.otros, 0)
  FROM banco b
  FULL OUTER JOIN mp m ON b.periodo = m.periodo
  ORDER BY 1;
$$;
