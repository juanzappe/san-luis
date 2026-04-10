-- 049_flujo_fondos_4_categorias.sql
-- Rewrite get_flujo_fondos() with 4 egreso categories classified from actual
-- cash movements (movimiento_bancario + movimiento_mp), NOT from auxiliary tables.
--
-- Egreso categories (operativos):
--   pagos_sueldos            — bank debits matching salary concepts
--   pagos_impuestos          — bank debits matching tax agency concepts + MP tax payments
--   pagos_gastos_financieros — bank fees/commissions/interest/insurance/loans + MP platform costs
--   pagos_proveedores        — everything else (residual after above classifications)
--
-- No operativos (fuera de totalPagos):
--   retiros_socios           — partner withdrawals (Nadal, Zaccaro)
--
-- Excluded completely:
--   Inviu (broker) — not income or expense, excluded from all categories
--   Inter-account transfers — Provincia ↔ Santander, bank ↔ MP, ATM transfers
--
-- Filtered: periodo >= '2024-01' (excludes 2023 and earlier)

SET search_path = public;

DROP FUNCTION IF EXISTS get_flujo_fondos();

CREATE FUNCTION get_flujo_fondos()
RETURNS TABLE(
  periodo text,
  cobros_efectivo numeric,
  cobros_banco numeric,
  cobros_mp numeric,
  pagos_proveedores numeric,
  pagos_sueldos numeric,
  pagos_impuestos numeric,
  pagos_gastos_financieros numeric,
  retiros_socios numeric
)
LANGUAGE sql STABLE
SET statement_timeout TO '30s'
AS $$
  WITH meses AS (
    SELECT DISTINCT sub.p FROM (
      SELECT TO_CHAR(fecha, 'YYYY-MM') AS p FROM movimiento_caja
      UNION SELECT TO_CHAR(fecha, 'YYYY-MM') FROM movimiento_bancario
      UNION SELECT TO_CHAR(fecha, 'YYYY-MM') FROM movimiento_mp
    ) sub
    WHERE sub.p >= '2024-01'
  ),

  -- =========================================================================
  -- COBROS
  -- =========================================================================

  -- Cobros efectivo: POS cash sales
  caja AS (
    SELECT TO_CHAR(fecha, 'YYYY-MM') AS p,
      SUM(COALESCE(importe, 0)) AS efectivo
    FROM movimiento_caja
    WHERE condicion_pago = 'EFECTIVO' AND tipo = 'Venta Contado'
      AND fecha >= '2024-01-01'
    GROUP BY 1
  ),

  -- Cobros banco: credits EXCLUDING inter-account transfers and Inviu
  banco_cred AS (
    SELECT TO_CHAR(fecha, 'YYYY-MM') AS p,
      SUM(COALESCE(credito, 0)) AS cobros
    FROM movimiento_bancario
    WHERE COALESCE(credito, 0) > 0
      AND fecha >= '2024-01-01'
      -- Exclude ATM cash deposits (internal move from cash register)
      AND COALESCE(concepto, '') NOT LIKE 'CREDITO TRASPASO CAJERO AUTOM%'
      AND LOWER(COALESCE(concepto, '')) NOT LIKE '%deposito por caja%'
      AND LOWER(COALESCE(concepto, '')) NOT LIKE '%deposito de efectivo%'
      -- Exclude internal bank-to-bank transfers (Santander ↔ Provincia)
      AND COALESCE(concepto, '') NOT LIKE 'CREDITO TRANSFERENCIA I%'
      -- Exclude MP wallet → bank transfers (already counted in cobros_mp)
      AND LOWER(COALESCE(concepto, '')) NOT LIKE '%mercado pago%'
      -- Exclude transfers from own company accounts
      AND COALESCE(concepto, '') NOT LIKE '%N:NADAL Y ZACCAR%'
      -- Exclude Inviu broker movements completely
      AND LOWER(COALESCE(concepto, '')) NOT LIKE '%inviu%'
    GROUP BY 1
  ),

  -- Cobros MP: positive inflows EXCLUDING inter-account transfers
  mp_ing AS (
    SELECT TO_CHAR(fecha, 'YYYY-MM') AS p,
      SUM(COALESCE(importe, 0)) AS ing
    FROM movimiento_mp
    WHERE COALESCE(importe, 0) > 0
      AND fecha >= '2024-01-01'
      -- Exclude transfers from bank to MP wallet
      AND COALESCE(tipo_operacion, '') NOT ILIKE '%Transferencia%'
    GROUP BY 1
  ),

  -- =========================================================================
  -- EGRESOS — classified from bank movements
  -- =========================================================================

  -- All bank debits with their classification
  -- Excludes: inter-account transfers, Inviu, partner withdrawals
  banco_deb AS (
    SELECT
      TO_CHAR(fecha, 'YYYY-MM') AS p,
      COALESCE(debito, 0) AS monto,
      LOWER(COALESCE(concepto, '')) AS concepto_lower,
      COALESCE(concepto, '') AS concepto_raw
    FROM movimiento_bancario
    WHERE COALESCE(debito, 0) > 0
      AND fecha >= '2024-01-01'
      -- =====================================================================
      -- EXCLUDE inter-account transfers
      -- =====================================================================
      -- ATM self-transfers
      AND COALESCE(concepto, '') NOT LIKE 'DEBITO TRANS.CAJERO AUT%'
      -- Inter-bank transfers (Santander ↔ Provincia)
      AND COALESCE(concepto, '') NOT LIKE 'BIP DB TRANSFERENCIA%'
      -- Transfers to own company account
      AND COALESCE(concepto, '') NOT LIKE '%N:NADAL Y ZACCAR%'
      -- Transfers to MP wallet
      AND LOWER(COALESCE(concepto, '')) NOT LIKE '%mercado pago%'
      -- =====================================================================
      -- EXCLUDE Inviu broker movements completely
      -- =====================================================================
      AND LOWER(COALESCE(concepto, '')) NOT LIKE '%inviu%'
      -- =====================================================================
      -- EXCLUDE partner withdrawals (tracked separately in retiros CTE)
      -- =====================================================================
      AND COALESCE(concepto, '') NOT LIKE '%N:NADAL ANDREA%'
      AND COALESCE(concepto, '') NOT LIKE '%N:ZACCARO FABIAN%'
      AND LOWER(COALESCE(concepto, '')) NOT LIKE '%zaccaro%'
  ),

  -- Classify each bank debit into one of: sueldos, impuestos, financieros, proveedores
  banco_clasificado AS (
    SELECT
      p,
      -- SUELDOS: salary-related concepts
      SUM(CASE
        WHEN concepto_lower LIKE '%haber%'
          OR concepto_lower LIKE '%sueldo%'
          OR concepto_lower LIKE '%remuner%'
          OR concepto_lower LIKE '%aguinaldo%'
          OR concepto_lower LIKE '%vacacion%'
          OR concepto_lower LIKE '%lote haberes%'
          OR concepto_lower LIKE '%pago de haberes%'
          OR concepto_lower LIKE '%pago haberes%'
          OR concepto_raw LIKE 'DEBITO POR PAGO DE HABERES%'
          OR concepto_raw LIKE 'DEB LOTE ZACCARO FABIAN%'
        THEN monto ELSE 0
      END) AS sueldos,

      -- IMPUESTOS: tax agency payments
      SUM(CASE
        -- Already classified as sueldo → skip
        WHEN concepto_lower LIKE '%haber%'
          OR concepto_lower LIKE '%sueldo%'
          OR concepto_lower LIKE '%remuner%'
          OR concepto_lower LIKE '%aguinaldo%'
          OR concepto_lower LIKE '%vacacion%'
          OR concepto_lower LIKE '%lote haberes%'
          OR concepto_lower LIKE '%pago de haberes%'
          OR concepto_lower LIKE '%pago haberes%'
          OR concepto_raw LIKE 'DEBITO POR PAGO DE HABERES%'
          OR concepto_raw LIKE 'DEB LOTE ZACCARO FABIAN%'
        THEN 0
        -- Tax patterns
        WHEN concepto_lower LIKE '%afip%'
          OR concepto_lower LIKE '%arba%'
          OR concepto_lower LIKE '%iibb%'
          OR concepto_lower LIKE '%ganancias%'
          OR concepto_lower LIKE '%monotributo%'
          OR concepto_lower LIKE '%municipalidad%'
          OR concepto_lower LIKE '%seguridad e higiene%'
          OR concepto_lower LIKE '%ley 25413%'
          OR concepto_lower LIKE '%ley 25.413%'
          OR concepto_lower LIKE '%25413%'
          OR concepto_lower LIKE '%25.413%'
          OR concepto_lower LIKE '%f.931%'
          OR concepto_lower LIKE '%f931%'
          OR concepto_lower LIKE '%sicoss%'
          OR concepto_lower LIKE '%impuesto s/deb%'
          OR concepto_lower LIKE '%impuesto s/cred%'
          OR concepto_lower LIKE '%contribucion%patronal%'
          OR concepto_lower LIKE '%aporte%jubilat%'
          OR concepto_lower LIKE '%obra social%'
          OR concepto_lower LIKE '%sindicato%'
          OR concepto_lower LIKE '%retencion arba%'
          OR concepto_lower LIKE '%retencion iibb%'
        THEN monto ELSE 0
      END) AS impuestos,

      -- GASTOS FINANCIEROS: bank fees, commissions, interest, insurance, loans
      SUM(CASE
        -- Already classified as sueldo → skip
        WHEN concepto_lower LIKE '%haber%'
          OR concepto_lower LIKE '%sueldo%'
          OR concepto_lower LIKE '%remuner%'
          OR concepto_lower LIKE '%aguinaldo%'
          OR concepto_lower LIKE '%vacacion%'
          OR concepto_lower LIKE '%lote haberes%'
          OR concepto_lower LIKE '%pago de haberes%'
          OR concepto_lower LIKE '%pago haberes%'
          OR concepto_raw LIKE 'DEBITO POR PAGO DE HABERES%'
          OR concepto_raw LIKE 'DEB LOTE ZACCARO FABIAN%'
        THEN 0
        -- Already classified as impuesto → skip
        WHEN concepto_lower LIKE '%afip%'
          OR concepto_lower LIKE '%arba%'
          OR concepto_lower LIKE '%iibb%'
          OR concepto_lower LIKE '%ganancias%'
          OR concepto_lower LIKE '%monotributo%'
          OR concepto_lower LIKE '%municipalidad%'
          OR concepto_lower LIKE '%seguridad e higiene%'
          OR concepto_lower LIKE '%ley 25413%'
          OR concepto_lower LIKE '%ley 25.413%'
          OR concepto_lower LIKE '%25413%'
          OR concepto_lower LIKE '%25.413%'
          OR concepto_lower LIKE '%f.931%'
          OR concepto_lower LIKE '%f931%'
          OR concepto_lower LIKE '%sicoss%'
          OR concepto_lower LIKE '%impuesto s/deb%'
          OR concepto_lower LIKE '%impuesto s/cred%'
          OR concepto_lower LIKE '%contribucion%patronal%'
          OR concepto_lower LIKE '%aporte%jubilat%'
          OR concepto_lower LIKE '%obra social%'
          OR concepto_lower LIKE '%sindicato%'
          OR concepto_lower LIKE '%retencion arba%'
          OR concepto_lower LIKE '%retencion iibb%'
        THEN 0
        -- Financial expense patterns
        WHEN concepto_lower LIKE '%comision%'
          OR concepto_lower LIKE '%interes%'
          OR concepto_lower LIKE '%mantenimiento%'
          OR concepto_lower LIKE '%seguro%'
          OR concepto_lower LIKE '%sellado%'
          OR concepto_lower LIKE '%amortizacion%prestamo%'
          OR concepto_lower LIKE '%cuota prestamo%'
        THEN monto ELSE 0
      END) AS financieros,

      -- PROVEEDORES: everything else (residual)
      SUM(CASE
        -- Sueldo → skip
        WHEN concepto_lower LIKE '%haber%'
          OR concepto_lower LIKE '%sueldo%'
          OR concepto_lower LIKE '%remuner%'
          OR concepto_lower LIKE '%aguinaldo%'
          OR concepto_lower LIKE '%vacacion%'
          OR concepto_lower LIKE '%lote haberes%'
          OR concepto_lower LIKE '%pago de haberes%'
          OR concepto_lower LIKE '%pago haberes%'
          OR concepto_raw LIKE 'DEBITO POR PAGO DE HABERES%'
          OR concepto_raw LIKE 'DEB LOTE ZACCARO FABIAN%'
        THEN 0
        -- Impuesto → skip
        WHEN concepto_lower LIKE '%afip%'
          OR concepto_lower LIKE '%arba%'
          OR concepto_lower LIKE '%iibb%'
          OR concepto_lower LIKE '%ganancias%'
          OR concepto_lower LIKE '%monotributo%'
          OR concepto_lower LIKE '%municipalidad%'
          OR concepto_lower LIKE '%seguridad e higiene%'
          OR concepto_lower LIKE '%ley 25413%'
          OR concepto_lower LIKE '%ley 25.413%'
          OR concepto_lower LIKE '%25413%'
          OR concepto_lower LIKE '%25.413%'
          OR concepto_lower LIKE '%f.931%'
          OR concepto_lower LIKE '%f931%'
          OR concepto_lower LIKE '%sicoss%'
          OR concepto_lower LIKE '%impuesto s/deb%'
          OR concepto_lower LIKE '%impuesto s/cred%'
          OR concepto_lower LIKE '%contribucion%patronal%'
          OR concepto_lower LIKE '%aporte%jubilat%'
          OR concepto_lower LIKE '%obra social%'
          OR concepto_lower LIKE '%sindicato%'
          OR concepto_lower LIKE '%retencion arba%'
          OR concepto_lower LIKE '%retencion iibb%'
        THEN 0
        -- Financiero → skip
        WHEN concepto_lower LIKE '%comision%'
          OR concepto_lower LIKE '%interes%'
          OR concepto_lower LIKE '%mantenimiento%'
          OR concepto_lower LIKE '%seguro%'
          OR concepto_lower LIKE '%sellado%'
          OR concepto_lower LIKE '%amortizacion%prestamo%'
          OR concepto_lower LIKE '%cuota prestamo%'
        THEN 0
        -- Everything else = proveedores
        ELSE monto
      END) AS proveedores

    FROM banco_deb
    GROUP BY p
  ),

  -- =========================================================================
  -- EGRESOS MP — classified
  -- =========================================================================

  -- MP: supplier payments (Pago, Movimiento General)
  mp_proveedores AS (
    SELECT TO_CHAR(fecha, 'YYYY-MM') AS p,
      SUM(ABS(COALESCE(importe, 0))) AS monto
    FROM movimiento_mp
    WHERE COALESCE(importe, 0) < 0
      AND fecha >= '2024-01-01'
      AND COALESCE(tipo_operacion, '') IN ('Pago', 'Movimiento General')
    GROUP BY 1
  ),

  -- MP: tax payments (Imp. al Cheque / Créditos y Débitos via MP)
  -- movimiento_mp only has tipo_operacion as text descriptor (no concepto column)
  mp_impuestos AS (
    SELECT TO_CHAR(fecha, 'YYYY-MM') AS p,
      SUM(ABS(COALESCE(importe, 0))) AS monto
    FROM movimiento_mp
    WHERE COALESCE(importe, 0) < 0
      AND fecha >= '2024-01-01'
      AND COALESCE(tipo_operacion, '') NOT IN ('Pago', 'Movimiento General')
      AND COALESCE(tipo_operacion, '') NOT ILIKE '%Retiro de dinero%'
      AND COALESCE(tipo_operacion, '') NOT ILIKE '%Transferencia%'
      AND COALESCE(tipo_operacion, '') NOT ILIKE '%Anulación%'
      AND COALESCE(tipo_operacion, '') ILIKE '%Créditos y Débitos%'
    GROUP BY 1
  ),

  -- MP: platform costs = financial expenses (commissions, withholdings, fees)
  -- Everything negative that is NOT: retiro, pago/mov general, transfer, anulación, impuestos
  mp_financieros AS (
    SELECT TO_CHAR(fecha, 'YYYY-MM') AS p,
      SUM(ABS(COALESCE(importe, 0))) AS monto
    FROM movimiento_mp
    WHERE COALESCE(importe, 0) < 0
      AND fecha >= '2024-01-01'
      AND COALESCE(tipo_operacion, '') NOT IN ('Pago', 'Movimiento General')
      AND COALESCE(tipo_operacion, '') NOT ILIKE '%Retiro de dinero%'
      AND COALESCE(tipo_operacion, '') NOT ILIKE '%Transferencia%'
      AND COALESCE(tipo_operacion, '') NOT ILIKE '%Anulación%'
      AND COALESCE(tipo_operacion, '') NOT ILIKE '%Créditos y Débitos%'
    GROUP BY 1
  ),

  -- =========================================================================
  -- RETIROS SOCIOS
  -- =========================================================================
  retiros AS (
    SELECT TO_CHAR(fecha, 'YYYY-MM') AS p,
      SUM(COALESCE(debito, 0)) AS total
    FROM movimiento_bancario
    WHERE COALESCE(debito, 0) > 0
      AND fecha >= '2024-01-01'
      AND (
        COALESCE(concepto, '') LIKE '%N:NADAL ANDREA%'
        OR COALESCE(concepto, '') LIKE '%N:ZACCARO FABIAN%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%nadal%andrea%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%zaccaro%fabian%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%zaccaro%'
      )
    GROUP BY 1
  )

  -- =========================================================================
  -- FINAL SELECT
  -- =========================================================================
  SELECT
    m.p,
    COALESCE(c.efectivo, 0),
    COALESCE(bc.cobros, 0),
    COALESCE(mi.ing, 0),
    -- Proveedores: bank residual + MP supplier payments
    COALESCE(bd.proveedores, 0) + COALESCE(mpp.monto, 0),
    -- Sueldos: from bank movements
    COALESCE(bd.sueldos, 0),
    -- Impuestos: bank + MP tax payments
    COALESCE(bd.impuestos, 0) + COALESCE(mpi.monto, 0),
    -- Gastos financieros: bank fees + MP platform costs
    COALESCE(bd.financieros, 0) + COALESCE(mpf.monto, 0),
    -- Retiros socios
    COALESCE(ret.total, 0)
  FROM meses m
  LEFT JOIN caja c ON c.p = m.p
  LEFT JOIN banco_cred bc ON bc.p = m.p
  LEFT JOIN banco_clasificado bd ON bd.p = m.p
  LEFT JOIN mp_ing mi ON mi.p = m.p
  LEFT JOIN mp_proveedores mpp ON mpp.p = m.p
  LEFT JOIN mp_impuestos mpi ON mpi.p = m.p
  LEFT JOIN mp_financieros mpf ON mpf.p = m.p
  LEFT JOIN retiros ret ON ret.p = m.p
  ORDER BY m.p;
$$;
