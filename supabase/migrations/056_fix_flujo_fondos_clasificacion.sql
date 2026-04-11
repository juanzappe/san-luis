-- 056_fix_flujo_fondos_clasificacion.sql
-- Reclassify bank debits that were falling into Proveedores (residual)
-- but belong to Gastos Financieros or Impuestos.
--
-- GASTOS FINANCIEROS — added:
--   cargo a comercios visa/mastercard, debito arreglo visa/mastercard,
--   contracargo a comercio, pago tarjeta de credito visa,
--   arancel clave dni, comis.gestion cheque, impuesto de sellos,
--   com.movim mensuales clearing
--
-- IMPUESTOS — added:
--   p.serv%ente270 (Santander), impuesto i.brutos (without percepcion),
--   iva 21% (IVA retention on Santander)
--
-- FEDERACION PATR — moved from Financieros to Proveedores (residual).
--   These are seguro/ART payments, not bank fees.
--
-- No new columns — only amounts shift between existing categories.

SET search_path = public;

DROP FUNCTION IF EXISTS get_flujo_fondos();

CREATE FUNCTION get_flujo_fondos()
RETURNS TABLE(
  periodo text,
  cobros_efectivo numeric,
  cobros_banco numeric,
  cobros_banco_provincia numeric,
  cobros_banco_santander numeric,
  cobros_mp numeric,
  pagos_proveedores numeric,
  pagos_sueldos numeric,
  pagos_impuestos numeric,
  pagos_gastos_financieros numeric,
  pagos_provincia numeric,
  pagos_santander numeric,
  retiros_socios numeric,
  transferencias numeric
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

  -- Cobros banco: credits EXCLUDING own-company transfers, cash deposits, MP, Inviu
  -- Split by banco
  banco_cred AS (
    SELECT TO_CHAR(fecha, 'YYYY-MM') AS p,
      banco,
      SUM(COALESCE(credito, 0)) AS cobros
    FROM movimiento_bancario
    WHERE COALESCE(credito, 0) > 0
      AND fecha >= '2024-01-01'
      -- Exclude cash deposits (double-count with cobros_efectivo)
      AND LOWER(COALESCE(concepto, '')) NOT LIKE '%deposito por caja%'
      AND LOWER(COALESCE(concepto, '')) NOT LIKE '%deposito de efectivo%'
      AND LOWER(COALESCE(concepto, '')) NOT LIKE '%credito traspaso cajero%'
      -- Exclude MP wallet -> bank transfers (already counted in cobros_mp)
      AND LOWER(COALESCE(concepto, '')) NOT LIKE '%mercado pago%'
      -- Exclude transfers from own company accounts
      AND COALESCE(concepto, '') NOT LIKE '%N:NADAL Y ZACCAR%'
      -- Exclude Inviu broker movements completely
      AND LOWER(COALESCE(concepto, '')) NOT LIKE '%inviu%'
    GROUP BY 1, 2
  ),

  banco_cred_prov AS (
    SELECT p, cobros FROM banco_cred WHERE banco = 'provincia'
  ),
  banco_cred_sant AS (
    SELECT p, cobros FROM banco_cred WHERE banco = 'santander'
  ),

  -- Cobros MP: positive inflows EXCLUDING own-company transfers
  mp_ing AS (
    SELECT TO_CHAR(fecha, 'YYYY-MM') AS p,
      SUM(COALESCE(importe, 0)) AS ing
    FROM movimiento_mp
    WHERE COALESCE(importe, 0) > 0
      AND fecha >= '2024-01-01'
      AND NOT (
        COALESCE(tipo_operacion, '') ILIKE '%Transferencia%'
        AND (
          LOWER(COALESCE(tipo_operacion, '')) LIKE '%nadal y zaccaro%'
          OR COALESCE(tipo_operacion, '') LIKE '%30657033770%'
        )
      )
    GROUP BY 1
  ),

  -- =========================================================================
  -- EGRESOS — classified from bank movements (split by banco)
  -- =========================================================================

  banco_deb AS (
    SELECT
      TO_CHAR(fecha, 'YYYY-MM') AS p,
      banco,
      COALESCE(debito, 0) AS monto,
      LOWER(COALESCE(concepto, '')) AS concepto_lower,
      COALESCE(concepto, '') AS concepto_raw
    FROM movimiento_bancario
    WHERE COALESCE(debito, 0) > 0
      AND fecha >= '2024-01-01'
      -- EXCLUDE inter-account transfers (captured in transferencias CTE)
      AND COALESCE(concepto, '') NOT LIKE 'BIP DB TRANSFERENCIA%'
      AND LOWER(COALESCE(concepto, '')) NOT LIKE '%mercado pago%'
      -- EXCLUDE Inviu
      AND LOWER(COALESCE(concepto, '')) NOT LIKE '%inviu%'
      -- EXCLUDE partner withdrawals / own-company (captured in retiros CTE)
      AND COALESCE(concepto, '') NOT LIKE '%N:NADAL ANDREA%'
      AND COALESCE(concepto, '') NOT LIKE '%N:ZACCARO FABIAN%'
      AND COALESCE(concepto, '') NOT LIKE '%N:NADAL Y ZACCAR%'
      AND COALESCE(concepto, '') NOT LIKE 'DEBITO TRANS.CAJERO AUT%'
      AND COALESCE(concepto, '') <> 'DEBITO EN CUENTA'
  ),

  -- Classify each bank debit
  banco_clasificado AS (
    SELECT
      p,
      banco,

      -- ---------------------------------------------------------------
      -- SUELDOS (priority 1)
      -- ---------------------------------------------------------------
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

      -- ---------------------------------------------------------------
      -- IMPUESTOS (priority 2 — excludes sueldos)
      -- Added: p.serv%ente270, impuesto i.brutos, iva 21%
      -- ---------------------------------------------------------------
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
        THEN 0
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
          OR concepto_lower LIKE '%p.serv%ente950%'
          OR concepto_lower LIKE '%p.serv%municipali%'
          OR concepto_lower LIKE '%pago servicio por atm%'
          OR concepto_lower LIKE '%pago serv%'
          OR concepto_lower LIKE '%i.brutos%percepcion%'
          OR concepto_lower LIKE '%iibb%percepcion%'
          OR concepto_lower LIKE '%iva percepcion%'
          OR concepto_lower LIKE '%iva%rg 2408%'
          -- 056: Santander-format impuestos
          OR concepto_lower LIKE '%p.serv%ente270%'
          OR concepto_lower LIKE 'impuesto i.brutos%'
          OR concepto_lower LIKE 'iva 21%%'
        THEN monto ELSE 0
      END) AS impuestos,

      -- ---------------------------------------------------------------
      -- GASTOS FINANCIEROS (priority 3 — excludes sueldos + impuestos)
      -- Added: VISA/MC cargos, aranceles, sellos, clearing
      -- Removed: federacion patr (goes to proveedores)
      -- ---------------------------------------------------------------
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
        THEN 0
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
          OR concepto_lower LIKE '%p.serv%ente950%'
          OR concepto_lower LIKE '%p.serv%municipali%'
          OR concepto_lower LIKE '%pago servicio por atm%'
          OR concepto_lower LIKE '%pago serv%'
          OR concepto_lower LIKE '%i.brutos%percepcion%'
          OR concepto_lower LIKE '%iibb%percepcion%'
          OR concepto_lower LIKE '%iva percepcion%'
          OR concepto_lower LIKE '%iva%rg 2408%'
          -- 056: Santander-format impuestos
          OR concepto_lower LIKE '%p.serv%ente270%'
          OR concepto_lower LIKE 'impuesto i.brutos%'
          OR concepto_lower LIKE 'iva 21%%'
        THEN 0
        WHEN concepto_lower LIKE '%comision%'
          OR concepto_lower LIKE '%interes%'
          OR concepto_lower LIKE '%mantenimiento%'
          OR concepto_lower LIKE '%seguro%'
          OR concepto_lower LIKE '%sellado%'
          OR concepto_lower LIKE '%amortizacion%prestamo%'
          OR concepto_lower LIKE '%cuota prestamo%'
          OR concepto_lower LIKE '%cuota de prestamo%'
          OR concepto_lower LIKE '%pago cuota de prestamo%'
          OR concepto_lower LIKE '%liquidacion visa%'
          OR concepto_lower LIKE 'pago visa%'
          OR concepto_lower LIKE '%com. mant.%'
          OR concepto_lower LIKE '%com mant%'
          -- 056: VISA/MC card processing, aranceles, clearing
          OR concepto_lower LIKE '%cargo a comercios visa%'
          OR concepto_lower LIKE '%cargo a comercios mastercard%'
          OR concepto_lower LIKE '%debito arreglo - visa%'
          OR concepto_lower LIKE '%debito arreglo - mastercard%'
          OR concepto_lower LIKE '%contracargo a comercio%'
          OR concepto_lower LIKE '%pago tarjeta de credito visa%'
          OR concepto_lower LIKE '%arancel clave dni%'
          OR concepto_lower LIKE '%comis.gestion cheque%'
          OR concepto_lower LIKE '%impuesto de sellos%'
          OR concepto_lower LIKE '%com.movim mensuales clearing%'
        THEN monto ELSE 0
      END) AS financieros,

      -- ---------------------------------------------------------------
      -- PROVEEDORES (residual — everything not sueldos/impuestos/financieros)
      -- federacion patr now falls here (removed from financieros)
      -- ---------------------------------------------------------------
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
        THEN 0
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
          OR concepto_lower LIKE '%p.serv%ente950%'
          OR concepto_lower LIKE '%p.serv%municipali%'
          OR concepto_lower LIKE '%pago servicio por atm%'
          OR concepto_lower LIKE '%pago serv%'
          OR concepto_lower LIKE '%i.brutos%percepcion%'
          OR concepto_lower LIKE '%iibb%percepcion%'
          OR concepto_lower LIKE '%iva percepcion%'
          OR concepto_lower LIKE '%iva%rg 2408%'
          -- 056: Santander-format impuestos
          OR concepto_lower LIKE '%p.serv%ente270%'
          OR concepto_lower LIKE 'impuesto i.brutos%'
          OR concepto_lower LIKE 'iva 21%%'
        THEN 0
        WHEN concepto_lower LIKE '%comision%'
          OR concepto_lower LIKE '%interes%'
          OR concepto_lower LIKE '%mantenimiento%'
          OR concepto_lower LIKE '%seguro%'
          OR concepto_lower LIKE '%sellado%'
          OR concepto_lower LIKE '%amortizacion%prestamo%'
          OR concepto_lower LIKE '%cuota prestamo%'
          OR concepto_lower LIKE '%cuota de prestamo%'
          OR concepto_lower LIKE '%pago cuota de prestamo%'
          OR concepto_lower LIKE '%liquidacion visa%'
          OR concepto_lower LIKE 'pago visa%'
          OR concepto_lower LIKE '%com. mant.%'
          OR concepto_lower LIKE '%com mant%'
          -- 056: VISA/MC card processing, aranceles, clearing
          OR concepto_lower LIKE '%cargo a comercios visa%'
          OR concepto_lower LIKE '%cargo a comercios mastercard%'
          OR concepto_lower LIKE '%debito arreglo - visa%'
          OR concepto_lower LIKE '%debito arreglo - mastercard%'
          OR concepto_lower LIKE '%contracargo a comercio%'
          OR concepto_lower LIKE '%pago tarjeta de credito visa%'
          OR concepto_lower LIKE '%arancel clave dni%'
          OR concepto_lower LIKE '%comis.gestion cheque%'
          OR concepto_lower LIKE '%impuesto de sellos%'
          OR concepto_lower LIKE '%com.movim mensuales clearing%'
        THEN 0
        ELSE monto
      END) AS proveedores

    FROM banco_deb
    GROUP BY p, banco
  ),

  -- Aggregate classified bank debits: combined totals + per-bank totals
  banco_totals AS (
    SELECT
      p,
      SUM(sueldos) AS sueldos,
      SUM(impuestos) AS impuestos,
      SUM(financieros) AS financieros,
      SUM(proveedores) AS proveedores,
      SUM(CASE WHEN banco = 'provincia' THEN sueldos + impuestos + financieros + proveedores ELSE 0 END) AS total_provincia,
      SUM(CASE WHEN banco = 'santander' THEN sueldos + impuestos + financieros + proveedores ELSE 0 END) AS total_santander
    FROM banco_clasificado
    GROUP BY p
  ),

  -- =========================================================================
  -- EGRESOS MP — classified (unchanged)
  -- =========================================================================

  mp_proveedores AS (
    SELECT TO_CHAR(fecha, 'YYYY-MM') AS p,
      SUM(ABS(COALESCE(importe, 0))) AS monto
    FROM movimiento_mp
    WHERE COALESCE(importe, 0) < 0
      AND fecha >= '2024-01-01'
      AND (
        COALESCE(tipo_operacion, '') IN ('Pago', 'Movimiento General')
        OR (
          COALESCE(tipo_operacion, '') ILIKE '%Transferencia%'
          AND NOT (
            LOWER(COALESCE(tipo_operacion, '')) LIKE '%nadal y zaccaro%'
            OR COALESCE(tipo_operacion, '') LIKE '%30657033770%'
          )
        )
      )
    GROUP BY 1
  ),

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
      AND (
        COALESCE(tipo_operacion, '') ILIKE '%Créditos y Débitos%'
        OR LOWER(COALESCE(tipo_operacion, '')) LIKE '%retencion%'
        OR LOWER(COALESCE(tipo_operacion, '')) LIKE '%retención%'
        OR LOWER(COALESCE(tipo_operacion, '')) LIKE '%ingresos brutos%'
        OR LOWER(COALESCE(tipo_operacion, '')) LIKE '%iibb%'
        OR LOWER(COALESCE(tipo_operacion, '')) LIKE '%iva%'
        OR LOWER(COALESCE(tipo_operacion, '')) LIKE '%ganancias%'
        OR LOWER(COALESCE(tipo_operacion, '')) LIKE '%impuesto%'
      )
    GROUP BY 1
  ),

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
      AND NOT (
        COALESCE(tipo_operacion, '') ILIKE '%Créditos y Débitos%'
        OR LOWER(COALESCE(tipo_operacion, '')) LIKE '%retencion%'
        OR LOWER(COALESCE(tipo_operacion, '')) LIKE '%retención%'
        OR LOWER(COALESCE(tipo_operacion, '')) LIKE '%ingresos brutos%'
        OR LOWER(COALESCE(tipo_operacion, '')) LIKE '%iibb%'
        OR LOWER(COALESCE(tipo_operacion, '')) LIKE '%iva%'
        OR LOWER(COALESCE(tipo_operacion, '')) LIKE '%ganancias%'
        OR LOWER(COALESCE(tipo_operacion, '')) LIKE '%impuesto%'
      )
    GROUP BY 1
  ),

  -- =========================================================================
  -- RETIROS SOCIOS (expanded: NADAL, ZACCARO, own-company, ATM, round debits)
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
        OR COALESCE(concepto, '') LIKE '%N:NADAL Y ZACCAR%'
        OR COALESCE(concepto, '') LIKE 'DEBITO TRANS.CAJERO AUT%'
        OR COALESCE(concepto, '') = 'DEBITO EN CUENTA'
      )
      -- Exclude DEB LOTE ZACCARO FABIAN (goes to sueldos)
      AND COALESCE(concepto, '') NOT LIKE 'DEB LOTE ZACCARO%'
    GROUP BY 1
  ),

  -- =========================================================================
  -- TRANSFERENCIAS INTERBANCARIAS
  -- =========================================================================
  transferencias AS (
    SELECT TO_CHAR(fecha, 'YYYY-MM') AS p,
      SUM(COALESCE(debito, 0)) AS total
    FROM movimiento_bancario
    WHERE COALESCE(debito, 0) > 0
      AND fecha >= '2024-01-01'
      AND COALESCE(concepto, '') LIKE 'BIP DB TRANSFERENCIA%'
    GROUP BY 1
  )

  -- =========================================================================
  -- FINAL SELECT
  -- =========================================================================
  SELECT
    m.p,
    COALESCE(c.efectivo, 0),
    -- cobros_banco (combined, backward compat)
    COALESCE(bcp.cobros, 0) + COALESCE(bcs.cobros, 0),
    -- cobros_banco_provincia
    COALESCE(bcp.cobros, 0),
    -- cobros_banco_santander
    COALESCE(bcs.cobros, 0),
    COALESCE(mi.ing, 0),
    -- Proveedores: bank residual + MP supplier payments
    COALESCE(bt.proveedores, 0) + COALESCE(mpp.monto, 0),
    -- Sueldos: from bank movements
    COALESCE(bt.sueldos, 0),
    -- Impuestos: bank + MP tax payments
    COALESCE(bt.impuestos, 0) + COALESCE(mpi.monto, 0),
    -- Gastos financieros: bank fees + MP platform costs
    COALESCE(bt.financieros, 0) + COALESCE(mpf.monto, 0),
    -- Pagos por banco (debitos clasificados, sin MP)
    COALESCE(bt.total_provincia, 0),
    COALESCE(bt.total_santander, 0),
    -- Retiros socios
    COALESCE(ret.total, 0),
    -- Transferencias interbancarias
    COALESCE(tr.total, 0)
  FROM meses m
  LEFT JOIN caja c ON c.p = m.p
  LEFT JOIN banco_cred_prov bcp ON bcp.p = m.p
  LEFT JOIN banco_cred_sant bcs ON bcs.p = m.p
  LEFT JOIN banco_totals bt ON bt.p = m.p
  LEFT JOIN mp_ing mi ON mi.p = m.p
  LEFT JOIN mp_proveedores mpp ON mpp.p = m.p
  LEFT JOIN mp_impuestos mpi ON mpi.p = m.p
  LEFT JOIN mp_financieros mpf ON mpf.p = m.p
  LEFT JOIN retiros ret ON ret.p = m.p
  LEFT JOIN transferencias tr ON tr.p = m.p
  ORDER BY m.p;
$$;
