-- RPC: Resumen ejecutivo — all dashboard KPIs in a single server-side query.
-- Replaces 5+ client-side fetches (get_ingresos_mensual + 4 fetchAllRows)
-- with one lightweight call that returns pre-aggregated monthly rows.

SET search_path = public;

CREATE OR REPLACE FUNCTION get_resumen_ejecutivo()
RETURNS TABLE(
  periodo        text,
  mostrador      numeric,
  restobar       numeric,
  servicios      numeric,
  egresos_op     numeric,
  sueldos        numeric,
  comerciales    numeric,
  financieros    numeric
) AS $$
  WITH
  -- 1) Ingresos POS: mostrador + restobar (from venta_detalle)
  pos AS (
    SELECT
      TO_CHAR(v.fecha, 'YYYY-MM') AS periodo,
      SUM(CASE WHEN LOWER(vd.producto) != 'restobar' THEN COALESCE(vd.neto, 0) ELSE 0 END) AS mostrador,
      SUM(CASE WHEN LOWER(vd.producto) = 'restobar'  THEN COALESCE(vd.neto, 0) ELSE 0 END) AS restobar
    FROM venta v
    JOIN venta_detalle vd ON vd.venta_id = v.id
    GROUP BY 1
  ),

  -- 2) Ingresos Servicios: factura_emitida PV=6 with NC sign
  serv AS (
    SELECT
      TO_CHAR(fecha_emision, 'YYYY-MM') AS periodo,
      SUM(CASE WHEN tipo_comprobante IN (3,8,203)
               THEN -COALESCE(imp_neto_gravado_total, 0)
               ELSE  COALESCE(imp_neto_gravado_total, 0) END) AS servicios
    FROM factura_emitida
    WHERE punto_venta = 6
    GROUP BY 1
  ),

  -- 3) Egresos operativos: factura_recibida neto with NC sign
  prov AS (
    SELECT
      TO_CHAR(fecha_emision, 'YYYY-MM') AS periodo,
      SUM(CASE WHEN tipo_comprobante IN (3,8,203)
               THEN -COALESCE(imp_neto_gravado_total, 0)
               ELSE  COALESCE(imp_neto_gravado_total, 0) END) AS egresos_op
    FROM factura_recibida
    GROUP BY 1
  ),

  -- 4) Sueldos with devengamiento (accrual logic)
  --    - SAC (aguinaldo): accrue to transfer month
  --    - Transfer day < 20: accrue to previous month
  --    - Transfer day >= 20: accrue to transfer month
  --    - NULL transfer date: fall back to periodo field
  sueldos_raw AS (
    SELECT
      CASE
        -- SAC: accrue to transfer month (or periodo if no transfer date)
        WHEN periodo LIKE '%-SAC' THEN
          CASE WHEN fecha_transferencia IS NOT NULL
               THEN TO_CHAR(fecha_transferencia, 'YYYY-MM')
               ELSE LEFT(periodo, 7)
          END
        -- No transfer date: use periodo
        WHEN fecha_transferencia IS NULL THEN LEFT(periodo, 7)
        -- Transfer day < 20: previous month
        WHEN EXTRACT(DAY FROM fecha_transferencia) < 20 THEN
          TO_CHAR(fecha_transferencia - INTERVAL '1 month', 'YYYY-MM')
        -- Transfer day >= 20: transfer month
        ELSE TO_CHAR(fecha_transferencia, 'YYYY-MM')
      END AS periodo,
      COALESCE(sueldo_neto, 0) AS sueldo_neto
    FROM liquidacion_sueldo
  ),
  sue AS (
    SELECT periodo, SUM(sueldo_neto) AS sueldos
    FROM sueldos_raw
    GROUP BY 1
  ),

  -- 5) Comerciales (tax payments)
  tax AS (
    SELECT
      TO_CHAR(fecha_pago, 'YYYY-MM') AS periodo,
      SUM(COALESCE(monto, 0)) AS comerciales
    FROM pago_impuesto
    GROUP BY 1
  ),

  -- 6) Costos financieros (bank fees: comisiones, intereses, etc.)
  fin AS (
    SELECT
      TO_CHAR(fecha, 'YYYY-MM') AS periodo,
      SUM(COALESCE(debito, 0)) AS financieros
    FROM movimiento_bancario
    WHERE COALESCE(debito, 0) > 0
      AND (
        LOWER(concepto) LIKE '%comision%'
        OR LOWER(concepto) LIKE '%interes%'
        OR LOWER(concepto) LIKE '%impuesto s/deb%'
        OR LOWER(concepto) LIKE '%impuesto s/cred%'
        OR LOWER(concepto) LIKE '%mantenimiento%'
        OR LOWER(concepto) LIKE '%seguro%'
        OR LOWER(concepto) LIKE '%sellado%'
      )
    GROUP BY 1
  ),

  -- Collect all periods
  all_periodos AS (
    SELECT periodo FROM pos
    UNION SELECT periodo FROM serv
    UNION SELECT periodo FROM prov
    UNION SELECT periodo FROM sue
    UNION SELECT periodo FROM tax
    UNION SELECT periodo FROM fin
  )

SELECT
  ap.periodo,
  COALESCE(p.mostrador, 0),
  COALESCE(p.restobar, 0),
  COALESCE(s.servicios, 0),
  COALESCE(pr.egresos_op, 0),
  COALESCE(su.sueldos, 0),
  COALESCE(tx.comerciales, 0),
  COALESCE(fn.financieros, 0)
FROM all_periodos ap
LEFT JOIN pos  p  ON p.periodo  = ap.periodo
LEFT JOIN serv s  ON s.periodo  = ap.periodo
LEFT JOIN prov pr ON pr.periodo = ap.periodo
LEFT JOIN sue  su ON su.periodo = ap.periodo
LEFT JOIN tax  tx ON tx.periodo = ap.periodo
LEFT JOIN fin  fn ON fn.periodo = ap.periodo
ORDER BY ap.periodo;
$$ LANGUAGE sql STABLE;
