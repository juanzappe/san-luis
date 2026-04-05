-- Fix: Flujo de Fondos — eliminate double-counting of cross-transfers
--
-- Problem: get_flujo_fondos() counts the same money twice:
--   1. Cash deposits: counted as cobros_efectivo (POS sale) AND cobros_banco (bank deposit)
--   2. MP→Bank: MP collections counted as cobros_mp AND again as cobros_banco when transferred
--   3. MP outflows (fees, taxes, payments) were completely ignored
--
-- Fix:
--   - banco_cred: exclude cash deposits and MP transfers (identified by concepto patterns)
--   - Add egresos_mp: MP outflows (excluding 'Retiro de dinero' which is just an internal transfer)
--
-- NOTE: Must DROP first because return type changed (added egresos_mp column).
-- CREATE OR REPLACE cannot change the return type of an existing function.

DROP FUNCTION IF EXISTS get_flujo_fondos();

CREATE FUNCTION get_flujo_fondos()
RETURNS TABLE(
  periodo text,
  cobros_efectivo numeric,
  cobros_banco numeric,
  cobros_mp numeric,
  pagos_proveedores numeric,
  sueldos numeric,
  impuestos numeric,
  comisiones_bancarias numeric,
  egresos_mp numeric
) AS $$
  WITH meses AS (
    SELECT DISTINCT sub.p FROM (
      SELECT TO_CHAR(fecha, 'YYYY-MM') AS p FROM movimiento_caja
      UNION SELECT TO_CHAR(fecha, 'YYYY-MM') FROM movimiento_bancario
      UNION SELECT TO_CHAR(fecha, 'YYYY-MM') FROM movimiento_mp
      UNION SELECT LEFT(periodo, 7) FROM liquidacion_sueldo WHERE periodo IS NOT NULL
      UNION SELECT TO_CHAR(fecha_pago, 'YYYY-MM') FROM pago_impuesto WHERE fecha_pago IS NOT NULL
    ) sub
  ),

  -- Cobros: ventas en efectivo (POS cash sales)
  caja AS (
    SELECT TO_CHAR(fecha, 'YYYY-MM') AS p,
      SUM(COALESCE(importe, 0)) AS efectivo
    FROM movimiento_caja
    WHERE condicion_pago = 'EFECTIVO' AND tipo = 'Venta Contado'
    GROUP BY 1
  ),

  -- Cobros: créditos bancarios EXCLUDING cash deposits, MP transfers, and internal transfers
  banco_cred AS (
    SELECT TO_CHAR(fecha, 'YYYY-MM') AS p,
      SUM(COALESCE(credito, 0)) AS cobros
    FROM movimiento_bancario
    WHERE COALESCE(credito, 0) > 0
      -- Exclude cash deposits (caja → banco): already counted in cobros_efectivo
      -- Provincia: "CREDITO TRASPASO CAJERO AUTOM."
      -- Santander: "Deposito de efectivo en sucursal", "DEPOSITO POR CAJA ..."
      AND COALESCE(concepto, '') NOT LIKE 'CREDITO TRASPASO CAJERO AUTOM%'
      AND LOWER(COALESCE(concepto, '')) NOT LIKE '%deposito por caja%'
      AND LOWER(COALESCE(concepto, '')) NOT LIKE '%deposito de efectivo%'
      -- Exclude internal transfers (between own bank accounts)
      -- Provincia: "CREDITO TRANSFERENCIA I" (interna)
      AND COALESCE(concepto, '') NOT LIKE 'CREDITO TRANSFERENCIA I'
      -- Exclude MP transfers (MP → banco): already counted in cobros_mp
      -- Santander: "... mercado pago ..."
      AND LOWER(COALESCE(concepto, '')) NOT LIKE '%mercado pago%'
    GROUP BY 1
  ),

  -- Pagos: débitos bancarios (proveedores vs comisiones)
  banco_deb AS (
    SELECT TO_CHAR(fecha, 'YYYY-MM') AS p,
      SUM(CASE
        WHEN LOWER(COALESCE(concepto, '')) LIKE ANY(ARRAY[
          '%comision%', '%interes%', '%mantenimiento%', '%seguro%',
          '%sellado%', '%impuesto s/deb%', '%impuesto s/cred%'
        ]) THEN 0
        ELSE COALESCE(debito, 0)
      END) AS pagos_prov,
      SUM(CASE
        WHEN LOWER(COALESCE(concepto, '')) LIKE ANY(ARRAY[
          '%comision%', '%interes%', '%mantenimiento%', '%seguro%',
          '%sellado%', '%impuesto s/deb%', '%impuesto s/cred%'
        ]) THEN COALESCE(debito, 0)
        ELSE 0
      END) AS comisiones
    FROM movimiento_bancario
    WHERE COALESCE(debito, 0) > 0
    GROUP BY 1
  ),

  -- Cobros MP: only positive inflows (Cobro, Ingreso de dinero, Dinero recibido)
  -- Retiro de dinero, Pago, taxes etc. are negative → already excluded by importe > 0
  mp_ing AS (
    SELECT TO_CHAR(fecha, 'YYYY-MM') AS p,
      SUM(COALESCE(importe, 0)) AS ing
    FROM movimiento_mp
    WHERE COALESCE(importe, 0) > 0
    GROUP BY 1
  ),

  -- Egresos MP: negative outflows (fees, taxes, payments from MP wallet)
  -- Exclude 'Retiro de dinero' (internal transfer to bank, not a real cost)
  mp_egr AS (
    SELECT TO_CHAR(fecha, 'YYYY-MM') AS p,
      SUM(ABS(COALESCE(importe, 0))) AS egr
    FROM movimiento_mp
    WHERE COALESCE(importe, 0) < 0
      AND COALESCE(tipo_operacion, '') NOT ILIKE '%Retiro de dinero%'
    GROUP BY 1
  ),

  sue AS (
    SELECT LEFT(periodo, 7) AS p,
      SUM(COALESCE(sueldo_neto, 0)) AS neto
    FROM liquidacion_sueldo
    WHERE periodo IS NOT NULL
    GROUP BY 1
  ),

  imp AS (
    SELECT TO_CHAR(fecha_pago, 'YYYY-MM') AS p,
      SUM(COALESCE(monto, 0)) AS total
    FROM pago_impuesto
    WHERE fecha_pago IS NOT NULL
    GROUP BY 1
  )

  SELECT
    m.p,
    COALESCE(c.efectivo, 0),
    COALESCE(bc.cobros, 0),
    COALESCE(mi.ing, 0),
    COALESCE(bd.pagos_prov, 0),
    COALESCE(s.neto, 0),
    COALESCE(i.total, 0),
    COALESCE(bd.comisiones, 0),
    COALESCE(me.egr, 0)
  FROM meses m
  LEFT JOIN caja c ON c.p = m.p
  LEFT JOIN banco_cred bc ON bc.p = m.p
  LEFT JOIN banco_deb bd ON bd.p = m.p
  LEFT JOIN mp_ing mi ON mi.p = m.p
  LEFT JOIN mp_egr me ON me.p = m.p
  LEFT JOIN sue s ON s.p = m.p
  LEFT JOIN imp i ON i.p = m.p
  ORDER BY m.p
$$ LANGUAGE sql STABLE
SET statement_timeout = '30s';
