-- Migration 019: Cambiar criterio de impuestos en get_egresos_mensual
-- de PERCIBIDO (fecha_pago) a DEVENGADO (período fiscal en observaciones).
--
-- El campo observaciones contiene:
--   "Impuesto: 30 - IVA | Período: 20251200 | 02 - Comprobante general"
-- Extraemos "20251200" → "2025-12".
-- Caso especial: "20250000" (anual, ej Ganancias) → "2025-12" (cierre ejercicio).
-- Fallback si no se parsea: fecha_pago.

CREATE OR REPLACE FUNCTION get_egresos_mensual()
RETURNS TABLE(
  periodo text,
  sueldos_costo numeric,
  sueldos_neto numeric,
  proveedores numeric,
  impuestos_comerciales numeric,
  ganancias numeric,
  financieros numeric,
  cargas_sociales numeric
) AS $$
  WITH
  -- 1) Sueldos with devengamiento (unchanged)
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

  -- 2) Proveedores (unchanged)
  prov AS (
    SELECT
      TO_CHAR(fecha_emision, 'YYYY-MM') AS p,
      SUM(CASE WHEN tipo_comprobante IN (3,8,203)
               THEN -COALESCE(imp_neto_gravado_total, 0)
               ELSE  COALESCE(imp_neto_gravado_total, 0) END) AS total
    FROM factura_recibida
    GROUP BY 1
  ),

  -- 3) Impuestos: DEVENGADO (período fiscal de observaciones, fallback fecha_pago)
  imp_raw AS (
    SELECT
      pi.monto,
      pi.formulario,
      io.tipo,
      -- Extract periodo from observaciones: "Período: 20251200" → "202512"
      SUBSTRING(pi.observaciones FROM 'Período: (\d{8})') AS periodo_raw,
      TO_CHAR(pi.fecha_pago, 'YYYY-MM') AS fecha_pago_ym
    FROM pago_impuesto pi
    LEFT JOIN impuesto_obligacion io ON io.id = pi.impuesto_obligacion_id
    WHERE pi.fecha_pago IS NOT NULL
  ),
  imp_parsed AS (
    SELECT
      monto, formulario, tipo,
      CASE
        -- Caso anual (ej: 20250000 → 2025-12, cierre ejercicio)
        WHEN periodo_raw IS NOT NULL AND SUBSTR(periodo_raw, 5, 2) = '00'
          THEN LEFT(periodo_raw, 4) || '-12'
        -- Caso normal (ej: 20251200 → 2025-12)
        WHEN periodo_raw IS NOT NULL AND SUBSTR(periodo_raw, 5, 2) BETWEEN '01' AND '12'
          THEN LEFT(periodo_raw, 4) || '-' || SUBSTR(periodo_raw, 5, 2)
        -- Fallback: fecha de pago
        ELSE fecha_pago_ym
      END AS p
    FROM imp_raw
  ),
  imp AS (
    SELECT
      p,
      SUM(CASE WHEN tipo = 'ganancias' THEN 0
               WHEN formulario = '1931' THEN 0
               ELSE COALESCE(monto, 0) END) AS comerciales,
      SUM(CASE WHEN tipo = 'ganancias' THEN COALESCE(monto, 0)
               ELSE 0 END) AS ganancias,
      SUM(CASE WHEN formulario = '1931' THEN COALESCE(monto, 0)
               ELSE 0 END) AS cargas_sociales
    FROM imp_parsed
    GROUP BY 1
  ),

  -- 4) Financial costs (unchanged)
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
