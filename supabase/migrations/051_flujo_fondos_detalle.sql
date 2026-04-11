-- 051_flujo_fondos_detalle.sql
-- Detail RPC for Flujo de Fondos: returns individual classified movements
-- grouped by normalized concept, with subcategoria for impuestos, retiros,
-- and transferencias.
--
-- Uses the EXACT same classification LIKE patterns as get_flujo_fondos() (049)
-- to guarantee consistency between aggregate totals and detail breakdown.
--
-- Categories:
--   proveedores, sueldos, impuestos, financieros  — operational expenses
--   retiros                                        — partner withdrawals
--   transferencias                                 — inter-account transfers + Inviu (informational only)
--   otros                                          — catch-all for unclassified (should be empty)

SET search_path = public;

DROP FUNCTION IF EXISTS get_flujo_fondos_detalle(integer);

CREATE FUNCTION get_flujo_fondos_detalle(p_anio integer)
RETURNS TABLE(
  periodo       text,
  concepto      text,
  categoria     text,
  subcategoria  text,
  monto         numeric,
  fuente        text
)
LANGUAGE sql STABLE
SET statement_timeout TO '30s'
AS $$
  -- =========================================================================
  -- BANK DEBITS — classified into sueldos/impuestos/financieros/proveedores
  -- =========================================================================
  WITH banco_detalle AS (
    SELECT
      TO_CHAR(fecha, 'YYYY-MM') AS periodo,
      COALESCE(debito, 0) AS monto,
      LOWER(COALESCE(concepto, '')) AS concepto_lower,
      COALESCE(concepto, '') AS concepto_raw
    FROM movimiento_bancario
    WHERE COALESCE(debito, 0) > 0
      AND fecha >= (p_anio || '-01-01')::date
      AND fecha <  ((p_anio + 1) || '-01-01')::date
      -- EXCLUDE inter-account transfers (handled in transferencias_detalle)
      AND COALESCE(concepto, '') NOT LIKE 'DEBITO TRANS.CAJERO AUT%'
      AND COALESCE(concepto, '') NOT LIKE 'BIP DB TRANSFERENCIA%'
      AND COALESCE(concepto, '') NOT LIKE '%N:NADAL Y ZACCAR%'
      AND LOWER(COALESCE(concepto, '')) NOT LIKE '%mercado pago%'
      -- EXCLUDE Inviu (handled in transferencias_detalle)
      AND LOWER(COALESCE(concepto, '')) NOT LIKE '%inviu%'
      AND LOWER(COALESCE(concepto, '')) NOT LIKE '%invertir%'
      AND LOWER(COALESCE(concepto, '')) NOT LIKE '%iol%invertir%'
      -- EXCLUDE partner withdrawals (handled in retiros_detalle)
      AND COALESCE(concepto, '') NOT LIKE '%N:NADAL ANDREA%'
      AND COALESCE(concepto, '') NOT LIKE '%N:ZACCARO FABIAN%'
  ),

  -- Classify each bank debit row
  banco_clasificado AS (
    SELECT
      periodo,
      monto,
      concepto_lower,
      concepto_raw,
      -- CATEGORIA: cascading priority sueldos → impuestos → financieros → proveedores
      CASE
        -- SUELDOS
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
        THEN 'sueldos'
        -- IMPUESTOS
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
        THEN 'impuestos'
        -- FINANCIEROS
        WHEN concepto_lower LIKE '%comision%'
          OR concepto_lower LIKE '%interes%'
          OR concepto_lower LIKE '%mantenimiento%'
          OR concepto_lower LIKE '%seguro%'
          OR concepto_lower LIKE '%sellado%'
          OR concepto_lower LIKE '%amortizacion%prestamo%'
          OR concepto_lower LIKE '%cuota prestamo%'
          OR concepto_lower LIKE '%federacion patr%'
          OR concepto_lower LIKE '%com. mant.%'
          OR concepto_lower LIKE '%com mant%'
        THEN 'financieros'
        -- PROVEEDORES (residual)
        ELSE 'proveedores'
      END AS categoria,

      -- CONCEPTO NORMALIZADO: clean up known patterns, truncate rest
      CASE
        WHEN concepto_lower LIKE '%p.serv%ente950%' THEN 'P.SERV ENTE950 (AFIP)'
        WHEN concepto_lower LIKE '%p.serv%municipali%' THEN 'P.SERV MUNICIPALIDAD'
        WHEN concepto_lower LIKE '%retencion arba%' THEN 'RETENCION ARBA'
        WHEN concepto_lower LIKE '%retencion iibb%' THEN 'RETENCION IIBB'
        WHEN concepto_lower LIKE '%impuesto s/deb%' THEN 'IMP. DEBITOS (Ley 25413)'
        WHEN concepto_lower LIKE '%impuesto s/cred%' THEN 'IMP. CREDITOS (Ley 25413)'
        WHEN concepto_lower LIKE '%ley 25413%' OR concepto_lower LIKE '%ley 25.413%'
          OR concepto_lower LIKE '%25413%' OR concepto_lower LIKE '%25.413%'
        THEN 'IMP. DEB/CRED (Ley 25413)'
        WHEN concepto_raw LIKE 'DEBITO POR PAGO DE HABERES%' THEN 'DEBITO POR PAGO DE HABERES'
        WHEN concepto_raw LIKE 'DEB LOTE ZACCARO FABIAN%' THEN 'DEB LOTE ZACCARO FABIAN'
        WHEN concepto_lower LIKE '%lote haberes%' THEN 'LOTE HABERES'
        WHEN concepto_lower LIKE '%pago de haberes%' OR concepto_lower LIKE '%pago haberes%'
        THEN 'PAGO DE HABERES'
        WHEN concepto_lower LIKE '%i.brutos%percepcion%' OR concepto_lower LIKE '%iibb%percepcion%'
        THEN 'PERCEPCION IIBB'
        WHEN concepto_lower LIKE '%iva percepcion%' OR concepto_lower LIKE '%iva%rg 2408%'
        THEN 'PERCEPCION IVA (RG 2408)'
        WHEN concepto_lower LIKE '%pago servicio por atm%'
        THEN 'PAGO SERVICIO POR ATM'
        WHEN concepto_lower LIKE '%federacion patr%'
        THEN 'FEDERACION PATRONAL (Seguro)'
        WHEN concepto_lower LIKE '%com. mant.%' OR concepto_lower LIKE '%com mant%'
        THEN 'COMISION MANTENIMIENTO'
        ELSE LEFT(UPPER(TRIM(concepto_raw)), 40)
      END AS concepto_norm,

      -- SUBCATEGORIA for impuestos
      CASE
        WHEN concepto_lower LIKE '%p.serv%ente950%' OR concepto_lower LIKE '%afip%'
          OR concepto_lower LIKE '%f.931%' OR concepto_lower LIKE '%f931%'
          OR concepto_lower LIKE '%sicoss%' OR concepto_lower LIKE '%ganancias%'
          OR concepto_lower LIKE '%monotributo%'
          OR concepto_lower LIKE '%iva percepcion%' OR concepto_lower LIKE '%iva%rg 2408%'
        THEN 'AFIP'
        WHEN concepto_lower LIKE '%arba%' OR concepto_lower LIKE '%retencion arba%'
          OR concepto_lower LIKE '%iibb%' OR concepto_lower LIKE '%retencion iibb%'
          OR concepto_lower LIKE '%i.brutos%percepcion%' OR concepto_lower LIKE '%iibb%percepcion%'
        THEN 'ARBA'
        WHEN concepto_lower LIKE '%p.serv%municipali%' OR concepto_lower LIKE '%municipalidad%'
          OR concepto_lower LIKE '%seguridad e higiene%'
        THEN 'Municipal'
        WHEN concepto_lower LIKE '%ley 25413%' OR concepto_lower LIKE '%ley 25.413%'
          OR concepto_lower LIKE '%25413%' OR concepto_lower LIKE '%25.413%'
          OR concepto_lower LIKE '%impuesto s/deb%' OR concepto_lower LIKE '%impuesto s/cred%'
        THEN 'Imp. al Cheque'
        WHEN concepto_lower LIKE '%contribucion%patronal%' OR concepto_lower LIKE '%aporte%jubilat%'
          OR concepto_lower LIKE '%obra social%' OR concepto_lower LIKE '%sindicato%'
        THEN 'Cargas Sociales'
        ELSE 'Otros'
      END AS subcategoria_imp
    FROM banco_detalle
  ),

  -- Final bank rows with concepto + categoria + subcategoria
  banco_final AS (
    SELECT
      periodo,
      concepto_norm AS concepto,
      categoria,
      CASE WHEN categoria = 'impuestos' THEN subcategoria_imp ELSE NULL END AS subcategoria,
      monto,
      'banco'::text AS fuente
    FROM banco_clasificado
  ),

  -- =========================================================================
  -- RETIROS SOCIOS — partner withdrawals
  -- =========================================================================
  retiros_detalle AS (
    SELECT
      TO_CHAR(fecha, 'YYYY-MM') AS periodo,
      -- Concepto normalizado
      CASE
        WHEN COALESCE(concepto, '') LIKE '%N:NADAL ANDREA%'
          OR LOWER(COALESCE(concepto, '')) LIKE '%nadal%andrea%'
        THEN 'TRANSFERENCIA A NADAL ANDREA'
        WHEN COALESCE(concepto, '') LIKE '%N:ZACCARO FABIAN%'
        THEN 'TRANSFERENCIA A ZACCARO FABIAN'
        ELSE LEFT(UPPER(TRIM(COALESCE(concepto, ''))), 40)
      END AS concepto,
      'retiros'::text AS categoria,
      -- Subcategoria = beneficiario
      CASE
        WHEN COALESCE(concepto, '') LIKE '%N:NADAL ANDREA%'
          OR LOWER(COALESCE(concepto, '')) LIKE '%nadal%andrea%'
        THEN 'Nadal'
        WHEN COALESCE(concepto, '') LIKE '%N:ZACCARO FABIAN%'
        THEN 'Zaccaro'
        ELSE 'Otro'
      END AS subcategoria,
      COALESCE(debito, 0) AS monto,
      'banco'::text AS fuente
    FROM movimiento_bancario
    WHERE COALESCE(debito, 0) > 0
      AND fecha >= (p_anio || '-01-01')::date
      AND fecha <  ((p_anio + 1) || '-01-01')::date
      AND (
        COALESCE(concepto, '') LIKE '%N:NADAL ANDREA%'
        OR COALESCE(concepto, '') LIKE '%N:ZACCARO FABIAN%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%nadal%andrea%'
      )
      -- Exclude payroll batches
      AND COALESCE(concepto, '') NOT LIKE 'DEB LOTE ZACCARO%'
      AND COALESCE(concepto, '') NOT LIKE '%PAGO DE HABERES%'
  ),

  -- =========================================================================
  -- TRANSFERENCIAS — inter-account transfers + Inviu (informational only)
  -- These are excluded from FF calculations but shown for trazability.
  -- Captures both debits and credits.
  -- =========================================================================

  -- Bank debits that are inter-account transfers or Inviu
  transf_banco_deb AS (
    SELECT
      TO_CHAR(fecha, 'YYYY-MM') AS periodo,
      CASE
        WHEN LOWER(COALESCE(concepto, '')) LIKE '%inviu%'
          OR LOWER(COALESCE(concepto, '')) LIKE '%invertir%'
          OR LOWER(COALESCE(concepto, '')) LIKE '%iol%invertir%'
        THEN 'INVIU: ' || LEFT(UPPER(TRIM(COALESCE(concepto, ''))), 34)
        WHEN COALESCE(concepto, '') LIKE 'DEBITO TRANS.CAJERO AUT%'
        THEN 'TRANSFERENCIA CAJERO AUTOMATICO'
        WHEN COALESCE(concepto, '') LIKE 'BIP DB TRANSFERENCIA%'
        THEN 'BIP DB TRANSFERENCIA'
        WHEN COALESCE(concepto, '') LIKE '%N:NADAL Y ZACCAR%'
        THEN 'TRANSFERENCIA A NADAL Y ZACCARO SA'
        WHEN LOWER(COALESCE(concepto, '')) LIKE '%mercado pago%'
        THEN 'TRANSFERENCIA A MERCADO PAGO'
        ELSE LEFT(UPPER(TRIM(COALESCE(concepto, ''))), 40)
      END AS concepto,
      'transferencias'::text AS categoria,
      CASE
        WHEN LOWER(COALESCE(concepto, '')) LIKE '%inviu%'
          OR LOWER(COALESCE(concepto, '')) LIKE '%invertir%'
          OR LOWER(COALESCE(concepto, '')) LIKE '%iol%invertir%'
        THEN 'Inviu'
        ELSE 'Entre cuentas propias'
      END AS subcategoria,
      COALESCE(debito, 0) AS monto,
      'banco'::text AS fuente
    FROM movimiento_bancario
    WHERE COALESCE(debito, 0) > 0
      AND fecha >= (p_anio || '-01-01')::date
      AND fecha <  ((p_anio + 1) || '-01-01')::date
      AND (
        -- Inter-account transfer patterns
        COALESCE(concepto, '') LIKE 'DEBITO TRANS.CAJERO AUT%'
        OR COALESCE(concepto, '') LIKE 'BIP DB TRANSFERENCIA%'
        OR COALESCE(concepto, '') LIKE '%N:NADAL Y ZACCAR%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%mercado pago%'
        -- Inviu broker
        OR LOWER(COALESCE(concepto, '')) LIKE '%inviu%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%invertir%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%iol%invertir%'
      )
  ),

  -- Bank credits that are inter-account transfers or Inviu
  transf_banco_cred AS (
    SELECT
      TO_CHAR(fecha, 'YYYY-MM') AS periodo,
      CASE
        WHEN LOWER(COALESCE(concepto, '')) LIKE '%inviu%'
          OR LOWER(COALESCE(concepto, '')) LIKE '%invertir%'
          OR LOWER(COALESCE(concepto, '')) LIKE '%iol%invertir%'
        THEN 'INVIU: ' || LEFT(UPPER(TRIM(COALESCE(concepto, ''))), 34)
        WHEN COALESCE(concepto, '') LIKE 'CREDITO TRASPASO CAJERO AUTOM%'
        THEN 'CREDITO TRASPASO CAJERO AUTOMATICO'
        WHEN LOWER(COALESCE(concepto, '')) LIKE '%deposito por caja%'
        THEN 'DEPOSITO POR CAJA'
        WHEN LOWER(COALESCE(concepto, '')) LIKE '%deposito de efectivo%'
        THEN 'DEPOSITO DE EFECTIVO'
        WHEN COALESCE(concepto, '') LIKE 'CREDITO TRANSFERENCIA I%'
        THEN 'CREDITO TRANSFERENCIA INTERBANCARIA'
        WHEN LOWER(COALESCE(concepto, '')) LIKE '%mercado pago%'
        THEN 'CREDITO DESDE MERCADO PAGO'
        WHEN COALESCE(concepto, '') LIKE '%N:NADAL Y ZACCAR%'
        THEN 'CREDITO DESDE NADAL Y ZACCARO SA'
        ELSE LEFT(UPPER(TRIM(COALESCE(concepto, ''))), 40)
      END AS concepto,
      'transferencias'::text AS categoria,
      CASE
        WHEN LOWER(COALESCE(concepto, '')) LIKE '%inviu%'
          OR LOWER(COALESCE(concepto, '')) LIKE '%invertir%'
          OR LOWER(COALESCE(concepto, '')) LIKE '%iol%invertir%'
        THEN 'Inviu'
        ELSE 'Entre cuentas propias'
      END AS subcategoria,
      COALESCE(credito, 0) AS monto,
      'banco'::text AS fuente
    FROM movimiento_bancario
    WHERE COALESCE(credito, 0) > 0
      AND fecha >= (p_anio || '-01-01')::date
      AND fecha <  ((p_anio + 1) || '-01-01')::date
      AND (
        -- Inter-account transfer patterns (credit side)
        COALESCE(concepto, '') LIKE 'CREDITO TRASPASO CAJERO AUTOM%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%deposito por caja%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%deposito de efectivo%'
        OR COALESCE(concepto, '') LIKE 'CREDITO TRANSFERENCIA I%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%mercado pago%'
        OR COALESCE(concepto, '') LIKE '%N:NADAL Y ZACCAR%'
        -- Inviu broker
        OR LOWER(COALESCE(concepto, '')) LIKE '%inviu%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%invertir%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%iol%invertir%'
      )
  ),

  -- MP transfers (retiro de dinero, transferencias, anulaciones)
  transf_mp AS (
    SELECT
      TO_CHAR(fecha, 'YYYY-MM') AS periodo,
      'MP: ' || COALESCE(tipo_operacion, '') AS concepto,
      'transferencias'::text AS categoria,
      'Entre cuentas propias'::text AS subcategoria,
      ABS(COALESCE(importe, 0)) AS monto,
      'mp'::text AS fuente
    FROM movimiento_mp
    WHERE fecha >= (p_anio || '-01-01')::date
      AND fecha <  ((p_anio + 1) || '-01-01')::date
      AND (
        COALESCE(tipo_operacion, '') ILIKE '%Retiro de dinero%'
        OR COALESCE(tipo_operacion, '') ILIKE '%Transferencia%'
        OR COALESCE(tipo_operacion, '') ILIKE '%Anulación%'
      )
  ),

  -- =========================================================================
  -- MP MOVEMENTS — classified (operational)
  -- Single CTE with CASE WHEN for cleaner classification.
  -- =========================================================================
  mp_clasificado AS (
    SELECT
      TO_CHAR(fecha, 'YYYY-MM') AS periodo,
      'MP: ' || COALESCE(tipo_operacion, '') AS concepto,
      CASE
        -- Proveedores: direct payments
        WHEN COALESCE(tipo_operacion, '') IN ('Pago', 'Movimiento General')
        THEN 'proveedores'
        -- Impuestos: tax retentions, perceptions, Créditos y Débitos
        WHEN LOWER(COALESCE(tipo_operacion, '')) LIKE '%créditos y débitos%'
          OR LOWER(COALESCE(tipo_operacion, '')) LIKE '%creditos y debitos%'
          OR LOWER(COALESCE(tipo_operacion, '')) LIKE '%retencion%'
          OR LOWER(COALESCE(tipo_operacion, '')) LIKE '%retención%'
          OR LOWER(COALESCE(tipo_operacion, '')) LIKE '%ingresos brutos%'
          OR LOWER(COALESCE(tipo_operacion, '')) LIKE '%iibb%'
          OR LOWER(COALESCE(tipo_operacion, '')) LIKE '%iva%'
          OR LOWER(COALESCE(tipo_operacion, '')) LIKE '%ganancias%'
          OR LOWER(COALESCE(tipo_operacion, '')) LIKE '%impuesto%'
        THEN 'impuestos'
        -- Financieros: everything else (platform costs, commissions, fees)
        ELSE 'financieros'
      END AS categoria,
      -- Subcategoria for impuestos
      CASE
        WHEN COALESCE(tipo_operacion, '') IN ('Pago', 'Movimiento General')
        THEN NULL::text
        WHEN LOWER(COALESCE(tipo_operacion, '')) LIKE '%créditos y débitos%'
          OR LOWER(COALESCE(tipo_operacion, '')) LIKE '%creditos y debitos%'
        THEN 'Imp. al Cheque'
        WHEN LOWER(COALESCE(tipo_operacion, '')) LIKE '%iibb%'
          OR LOWER(COALESCE(tipo_operacion, '')) LIKE '%ingresos brutos%'
        THEN 'ARBA'
        WHEN LOWER(COALESCE(tipo_operacion, '')) LIKE '%iva%'
        THEN 'AFIP'
        WHEN LOWER(COALESCE(tipo_operacion, '')) LIKE '%ganancias%'
        THEN 'AFIP'
        WHEN LOWER(COALESCE(tipo_operacion, '')) LIKE '%retencion%'
          OR LOWER(COALESCE(tipo_operacion, '')) LIKE '%retención%'
        THEN 'AFIP'
        WHEN LOWER(COALESCE(tipo_operacion, '')) LIKE '%impuesto%'
        THEN 'Otros'
        ELSE NULL::text
      END AS subcategoria,
      ABS(COALESCE(importe, 0)) AS monto,
      'mp'::text AS fuente
    FROM movimiento_mp
    WHERE COALESCE(importe, 0) < 0
      AND fecha >= (p_anio || '-01-01')::date
      AND fecha <  ((p_anio + 1) || '-01-01')::date
      -- Exclude transfers (handled in transf_mp)
      AND COALESCE(tipo_operacion, '') NOT ILIKE '%Retiro de dinero%'
      AND COALESCE(tipo_operacion, '') NOT ILIKE '%Transferencia%'
      AND COALESCE(tipo_operacion, '') NOT ILIKE '%Anulación%'
  ),

  -- =========================================================================
  -- UNION ALL + GROUP BY concepto + periodo
  -- =========================================================================
  all_movs AS (
    SELECT * FROM banco_final
    UNION ALL
    SELECT * FROM retiros_detalle
    UNION ALL
    SELECT * FROM transf_banco_deb
    UNION ALL
    SELECT * FROM transf_banco_cred
    UNION ALL
    SELECT * FROM transf_mp
    UNION ALL
    SELECT * FROM mp_clasificado
  )

  SELECT
    periodo,
    concepto,
    categoria,
    subcategoria,
    SUM(monto) AS monto,
    fuente
  FROM all_movs
  GROUP BY periodo, concepto, categoria, subcategoria, fuente
  ORDER BY periodo, categoria, monto DESC;
$$;
