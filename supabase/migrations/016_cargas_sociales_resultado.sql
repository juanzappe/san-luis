-- Migration 016: Separar cargas sociales (F.931) de impuestos comerciales
-- en get_egresos_mensual para que fluyan a "Sueldos y Cargas Sociales"
-- en el Estado de Resultados, evitando doble conteo en Costos Comerciales.

CREATE OR REPLACE FUNCTION get_egresos_mensual()
RETURNS TABLE(
  periodo text,
  sueldos_costo numeric,
  sueldos_neto numeric,
  proveedores numeric,
  impuestos_comerciales numeric,
  ganancias numeric,
  financieros numeric,
  cargas_sociales numeric          -- NEW: F.931 payments
) AS $$
  WITH
  -- 1) Sueldos with devengamiento
  sueldos_raw AS (
    SELECT
      CASE
        WHEN periodo LIKE '%-SAC' THEN
          CASE WHEN fecha_transferencia IS NOT NULL
               THEN TO_CHAR(fecha_transferencia, 'YYYY-MM')
               ELSE LEFT(periodo, 7)
          END
        WHEN fecha_transferencia IS NULL THEN LEFT(periodo, 7)
        WHEN EXTRACT(DAY FROM fecha_transferencia) < 20 THEN
          TO_CHAR(fecha_transferencia - INTERVAL '1 month', 'YYYY-MM')
        ELSE TO_CHAR(fecha_transferencia, 'YYYY-MM')
      END AS p,
      COALESCE(costo_total_empresa, sueldo_neto, 0) AS costo,
      COALESCE(sueldo_neto, 0) AS neto
    FROM liquidacion_sueldo
  ),
  sue AS (
    SELECT p, SUM(costo) AS costo, SUM(neto) AS neto
    FROM sueldos_raw
    GROUP BY 1
  ),

  -- 2) Proveedores (factura_recibida neto with NC sign)
  prov AS (
    SELECT
      TO_CHAR(fecha_emision, 'YYYY-MM') AS p,
      SUM(CASE WHEN tipo_comprobante IN (3,8,203)
               THEN -COALESCE(imp_neto_gravado_total, 0)
               ELSE  COALESCE(imp_neto_gravado_total, 0) END) AS total
    FROM factura_recibida
    GROUP BY 1
  ),

  -- 3) Impuestos: split ganancias vs cargas sociales (F.931) vs others
  imp AS (
    SELECT
      TO_CHAR(pi.fecha_pago, 'YYYY-MM') AS p,
      SUM(CASE WHEN io.tipo = 'ganancias' THEN 0
               WHEN pi.formulario = '1931' THEN 0
               ELSE COALESCE(pi.monto, 0) END) AS comerciales,
      SUM(CASE WHEN io.tipo = 'ganancias' THEN COALESCE(pi.monto, 0)
               ELSE 0 END) AS ganancias,
      SUM(CASE WHEN pi.formulario = '1931' THEN COALESCE(pi.monto, 0)
               ELSE 0 END) AS cargas_sociales
    FROM pago_impuesto pi
    LEFT JOIN impuesto_obligacion io ON io.id = pi.impuesto_obligacion_id
    WHERE pi.fecha_pago IS NOT NULL
    GROUP BY 1
  ),

  -- 4) Financial costs (bank fees)
  fin AS (
    SELECT
      TO_CHAR(fecha, 'YYYY-MM') AS p,
      SUM(COALESCE(debito, 0)) AS total
    FROM movimiento_bancario
    WHERE COALESCE(debito, 0) > 0
      AND LOWER(COALESCE(concepto, '')) LIKE ANY(ARRAY[
        '%comision%', '%interes%', '%impuesto s/deb%',
        '%impuesto s/cred%', '%mantenimiento%', '%seguro%', '%sellado%'
      ])
    GROUP BY 1
  ),

  -- Collect all periods
  all_p AS (
    SELECT p FROM sue
    UNION SELECT p FROM prov
    UNION SELECT p FROM imp
    UNION SELECT p FROM fin
  )

  SELECT
    ap.p,
    COALESCE(s.costo, 0),
    COALESCE(s.neto, 0),
    COALESCE(pr.total, 0),
    COALESCE(i.comerciales, 0),
    COALESCE(i.ganancias, 0),
    COALESCE(f.total, 0),
    COALESCE(i.cargas_sociales, 0)
  FROM all_p ap
  LEFT JOIN sue s ON s.p = ap.p
  LEFT JOIN prov pr ON pr.p = ap.p
  LEFT JOIN imp i ON i.p = ap.p
  LEFT JOIN fin f ON f.p = ap.p
  ORDER BY ap.p
$$ LANGUAGE sql STABLE
SET statement_timeout = '30s';
