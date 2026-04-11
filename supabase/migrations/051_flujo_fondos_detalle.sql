-- 051_flujo_fondos_detalle.sql
-- Detail RPC for Flujo de Fondos: returns individual classified movements
-- grouped by normalized concept, with subcategoria for impuestos and retiros.
--
-- Uses the EXACT same classification LIKE patterns as get_flujo_fondos() (049)
-- to guarantee consistency between aggregate totals and detail breakdown.

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
      -- EXCLUDE inter-account transfers (same as get_flujo_fondos)
      AND COALESCE(concepto, '') NOT LIKE 'DEBITO TRANS.CAJERO AUT%'
      AND COALESCE(concepto, '') NOT LIKE 'BIP DB TRANSFERENCIA%'
      AND COALESCE(concepto, '') NOT LIKE '%N:NADAL Y ZACCAR%'
      AND LOWER(COALESCE(concepto, '')) NOT LIKE '%mercado pago%'
      -- EXCLUDE Inviu
      AND LOWER(COALESCE(concepto, '')) NOT LIKE '%inviu%'
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
        THEN 'impuestos'
        -- FINANCIEROS
        WHEN concepto_lower LIKE '%comision%'
          OR concepto_lower LIKE '%interes%'
          OR concepto_lower LIKE '%mantenimiento%'
          OR concepto_lower LIKE '%seguro%'
          OR concepto_lower LIKE '%sellado%'
          OR concepto_lower LIKE '%amortizacion%prestamo%'
          OR concepto_lower LIKE '%cuota prestamo%'
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
        ELSE LEFT(UPPER(TRIM(concepto_raw)), 40)
      END AS concepto_norm,

      -- SUBCATEGORIA for impuestos
      CASE
        WHEN concepto_lower LIKE '%p.serv%ente950%' OR concepto_lower LIKE '%afip%'
          OR concepto_lower LIKE '%f.931%' OR concepto_lower LIKE '%f931%'
          OR concepto_lower LIKE '%sicoss%' OR concepto_lower LIKE '%ganancias%'
          OR concepto_lower LIKE '%monotributo%'
        THEN 'AFIP'
        WHEN concepto_lower LIKE '%arba%' OR concepto_lower LIKE '%retencion arba%'
          OR concepto_lower LIKE '%iibb%' OR concepto_lower LIKE '%retencion iibb%'
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
  -- MP MOVEMENTS — classified
  -- =========================================================================

  -- MP proveedores: Pago + Movimiento General
  mp_prov AS (
    SELECT
      TO_CHAR(fecha, 'YYYY-MM') AS periodo,
      'MP: ' || COALESCE(tipo_operacion, 'Pago') AS concepto,
      'proveedores'::text AS categoria,
      NULL::text AS subcategoria,
      ABS(COALESCE(importe, 0)) AS monto,
      'mp'::text AS fuente
    FROM movimiento_mp
    WHERE COALESCE(importe, 0) < 0
      AND fecha >= (p_anio || '-01-01')::date
      AND fecha <  ((p_anio + 1) || '-01-01')::date
      AND COALESCE(tipo_operacion, '') IN ('Pago', 'Movimiento General')
  ),

  -- MP impuestos: Créditos y Débitos
  mp_imp AS (
    SELECT
      TO_CHAR(fecha, 'YYYY-MM') AS periodo,
      'MP: ' || COALESCE(tipo_operacion, '') AS concepto,
      'impuestos'::text AS categoria,
      'Imp. al Cheque'::text AS subcategoria,
      ABS(COALESCE(importe, 0)) AS monto,
      'mp'::text AS fuente
    FROM movimiento_mp
    WHERE COALESCE(importe, 0) < 0
      AND fecha >= (p_anio || '-01-01')::date
      AND fecha <  ((p_anio + 1) || '-01-01')::date
      AND COALESCE(tipo_operacion, '') NOT IN ('Pago', 'Movimiento General')
      AND COALESCE(tipo_operacion, '') NOT ILIKE '%Retiro de dinero%'
      AND COALESCE(tipo_operacion, '') NOT ILIKE '%Transferencia%'
      AND COALESCE(tipo_operacion, '') NOT ILIKE '%Anulación%'
      AND COALESCE(tipo_operacion, '') ILIKE '%Créditos y Débitos%'
  ),

  -- MP financieros: platform costs (everything else negative)
  mp_fin AS (
    SELECT
      TO_CHAR(fecha, 'YYYY-MM') AS periodo,
      'MP: ' || COALESCE(tipo_operacion, '') AS concepto,
      'financieros'::text AS categoria,
      NULL::text AS subcategoria,
      ABS(COALESCE(importe, 0)) AS monto,
      'mp'::text AS fuente
    FROM movimiento_mp
    WHERE COALESCE(importe, 0) < 0
      AND fecha >= (p_anio || '-01-01')::date
      AND fecha <  ((p_anio + 1) || '-01-01')::date
      AND COALESCE(tipo_operacion, '') NOT IN ('Pago', 'Movimiento General')
      AND COALESCE(tipo_operacion, '') NOT ILIKE '%Retiro de dinero%'
      AND COALESCE(tipo_operacion, '') NOT ILIKE '%Transferencia%'
      AND COALESCE(tipo_operacion, '') NOT ILIKE '%Anulación%'
      AND COALESCE(tipo_operacion, '') NOT ILIKE '%Créditos y Débitos%'
  ),

  -- =========================================================================
  -- UNION ALL + GROUP BY concepto + periodo
  -- =========================================================================
  all_movs AS (
    SELECT * FROM banco_final
    UNION ALL
    SELECT * FROM retiros_detalle
    UNION ALL
    SELECT * FROM mp_prov
    UNION ALL
    SELECT * FROM mp_imp
    UNION ALL
    SELECT * FROM mp_fin
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
