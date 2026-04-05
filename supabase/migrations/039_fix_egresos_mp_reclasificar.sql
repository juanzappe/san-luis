-- Fix: Reclasificar egresos MP — "Pago" y "Movimiento General" a pagos_proveedores
--
-- "Pago" ($154M) y "Movimiento General" ($8.8M) son pagos a proveedores desde
-- la wallet de Mercado Pago. Se suman a pagos_proveedores.
-- egresos_mp queda solo para costos de plataforma: comisiones, retenciones, impuestos (~$22M).
--
-- Return type no cambia (mismas 10 columnas).

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
  egresos_mp numeric,
  retiros_socios numeric
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
      AND COALESCE(concepto, '') NOT LIKE 'CREDITO TRASPASO CAJERO AUTOM%'
      AND LOWER(COALESCE(concepto, '')) NOT LIKE '%deposito por caja%'
      AND LOWER(COALESCE(concepto, '')) NOT LIKE '%deposito de efectivo%'
      AND COALESCE(concepto, '') NOT LIKE 'CREDITO TRANSFERENCIA I%'
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
      AND COALESCE(concepto, '') NOT LIKE 'DEBITO POR PAGO DE HABERES%'
      AND COALESCE(concepto, '') NOT LIKE 'DEB LOTE ZACCARO FABIAN%'
      AND COALESCE(concepto, '') NOT LIKE 'DEBITO TRANS.CAJERO AUT%'
      AND LOWER(COALESCE(concepto, '')) NOT LIKE '%inviu%'
      AND COALESCE(concepto, '') NOT LIKE '%N:NADAL ANDREA%'
      AND COALESCE(concepto, '') NOT LIKE '%N:ZACCARO FABIAN%'
      AND COALESCE(concepto, '') NOT LIKE '%N:NADAL Y ZACCAR%'
      AND COALESCE(concepto, '') NOT LIKE 'BIP DB TRANSFERENCIA%'
    GROUP BY 1
  ),

  -- Cobros MP: positive inflows
  mp_ing AS (
    SELECT TO_CHAR(fecha, 'YYYY-MM') AS p,
      SUM(COALESCE(importe, 0)) AS ing
    FROM movimiento_mp
    WHERE COALESCE(importe, 0) > 0
    GROUP BY 1
  ),

  -- Pagos a proveedores vía MP (tipo_operacion = 'Pago' o 'Movimiento General')
  -- Se suman a pagos_proveedores en el SELECT final
  mp_pagos_prov AS (
    SELECT TO_CHAR(fecha, 'YYYY-MM') AS p,
      SUM(ABS(COALESCE(importe, 0))) AS pagos
    FROM movimiento_mp
    WHERE COALESCE(importe, 0) < 0
      AND COALESCE(tipo_operacion, '') IN ('Pago', 'Movimiento General')
    GROUP BY 1
  ),

  -- Egresos MP: solo costos de plataforma (comisiones, retenciones, impuestos)
  -- Excluye retiros (internos), pagos (proveedores) y movimiento general (proveedores)
  mp_egr AS (
    SELECT TO_CHAR(fecha, 'YYYY-MM') AS p,
      SUM(ABS(COALESCE(importe, 0))) AS egr
    FROM movimiento_mp
    WHERE COALESCE(importe, 0) < 0
      AND COALESCE(tipo_operacion, '') NOT ILIKE '%Retiro de dinero%'
      AND COALESCE(tipo_operacion, '') NOT IN ('Pago', 'Movimiento General')
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
  ),

  retiros AS (
    SELECT TO_CHAR(fecha, 'YYYY-MM') AS p,
      SUM(COALESCE(debito, 0)) AS total
    FROM movimiento_bancario
    WHERE COALESCE(debito, 0) > 0
      AND (COALESCE(concepto, '') LIKE '%N:NADAL ANDREA%'
        OR COALESCE(concepto, '') LIKE '%N:ZACCARO FABIAN%')
    GROUP BY 1
  )

  SELECT
    m.p,
    COALESCE(c.efectivo, 0),
    COALESCE(bc.cobros, 0),
    COALESCE(mi.ing, 0),
    COALESCE(bd.pagos_prov, 0) + COALESCE(mpp.pagos, 0),  -- banco + MP supplier payments
    COALESCE(s.neto, 0),
    COALESCE(i.total, 0),
    COALESCE(bd.comisiones, 0),
    COALESCE(me.egr, 0),
    COALESCE(ret.total, 0)
  FROM meses m
  LEFT JOIN caja c ON c.p = m.p
  LEFT JOIN banco_cred bc ON bc.p = m.p
  LEFT JOIN banco_deb bd ON bd.p = m.p
  LEFT JOIN mp_ing mi ON mi.p = m.p
  LEFT JOIN mp_pagos_prov mpp ON mpp.p = m.p
  LEFT JOIN mp_egr me ON me.p = m.p
  LEFT JOIN sue s ON s.p = m.p
  LEFT JOIN imp i ON i.p = m.p
  LEFT JOIN retiros ret ON ret.p = m.p
  ORDER BY m.p
$$ LANGUAGE sql STABLE
SET statement_timeout = '30s';
