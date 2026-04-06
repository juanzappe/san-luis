-- 045_proveedores_neto_completo.sql
-- Fix: use FULL net amount (neto_gravado + no_gravado + exentas) instead of
-- only imp_neto_gravado_total.
--
-- Many suppliers (monotributistas, exempt entities) issue invoices where the
-- entire amount goes to imp_neto_no_gravado or imp_op_exentas, with
-- imp_neto_gravado_total = 0. Using only neto_gravado loses ~50% of costs.
--
-- The correct cost = neto_gravado + no_gravado + exentas (everything the
-- supplier bills, minus the IVA which is recovered as tax credit).
--
-- This fix applies to:
-- 1. get_comercial_proveedores (proveedores page)
-- 2. get_detalle_proveedor (supplier detail)
-- 3. get_egresos_mensual (EERR costos operativos)
-- All three must use the same formula for consistency.

SET search_path = public;

-- Helper expression (not a function, just documenting the formula):
-- COALESCE(imp_neto_gravado_total, 0) + COALESCE(imp_neto_no_gravado, 0) + COALESCE(imp_op_exentas, 0)

-- ---------------------------------------------------------------------------
-- 1. get_comercial_proveedores
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_comercial_proveedores()
RETURNS TABLE(
  periodo          text,
  cuit             text,
  denominacion     text,
  total_neto       numeric,
  cantidad         bigint,
  tipo_costo       text,
  categoria_egreso text
) AS $$
  SELECT
    TO_CHAR(fr.fecha_emision, 'YYYY-MM'),
    COALESCE(fr.nro_doc_emisor, 'SIN_CUIT'),
    COALESCE(fr.denominacion_emisor, 'Sin nombre'),
    SUM(CASE WHEN fr.tipo_comprobante IN (3, 8, 203)
             THEN -(COALESCE(fr.imp_neto_gravado_total, 0) + COALESCE(fr.imp_neto_no_gravado, 0) + COALESCE(fr.imp_op_exentas, 0))
             ELSE   COALESCE(fr.imp_neto_gravado_total, 0) + COALESCE(fr.imp_neto_no_gravado, 0) + COALESCE(fr.imp_op_exentas, 0) END),
    COUNT(*),
    COALESCE(p.tipo_costo, 'Sin clasificar'),
    COALESCE(p.categoria_egreso, 'Sin clasificar')
  FROM factura_recibida fr
  LEFT JOIN proveedor p ON p.cuit = fr.nro_doc_emisor
  GROUP BY 1, 2, 3, 6, 7
$$ LANGUAGE sql STABLE
SET statement_timeout = '30s';

-- ---------------------------------------------------------------------------
-- 2. get_detalle_proveedor
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_detalle_proveedor(p_cuit text)
RETURNS TABLE(
  periodo                text,
  total_neto             numeric,
  cantidad               bigint,
  primera_fecha          date,
  ultima_fecha           date,
  cant_fechas_distintas  bigint
) AS $$
  SELECT
    TO_CHAR(fecha_emision, 'YYYY-MM'),
    SUM(CASE WHEN tipo_comprobante IN (3, 8, 203)
             THEN -(COALESCE(imp_neto_gravado_total, 0) + COALESCE(imp_neto_no_gravado, 0) + COALESCE(imp_op_exentas, 0))
             ELSE   COALESCE(imp_neto_gravado_total, 0) + COALESCE(imp_neto_no_gravado, 0) + COALESCE(imp_op_exentas, 0) END),
    COUNT(*),
    MIN(fecha_emision),
    MAX(fecha_emision),
    COUNT(DISTINCT fecha_emision)
  FROM factura_recibida
  WHERE nro_doc_emisor = p_cuit
  GROUP BY 1
$$ LANGUAGE sql STABLE
SET statement_timeout = '30s';

-- ---------------------------------------------------------------------------
-- 3. get_egresos_mensual — fix the prov CTE to match
-- ---------------------------------------------------------------------------
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

  -- 2) Proveedores — full net (neto_gravado + no_gravado + exentas)
  prov AS (
    SELECT
      TO_CHAR(fecha_emision, 'YYYY-MM') AS p,
      SUM(CASE WHEN tipo_comprobante IN (3,8,203)
               THEN -(COALESCE(imp_neto_gravado_total, 0) + COALESCE(imp_neto_no_gravado, 0) + COALESCE(imp_op_exentas, 0))
               ELSE   COALESCE(imp_neto_gravado_total, 0) + COALESCE(imp_neto_no_gravado, 0) + COALESCE(imp_op_exentas, 0) END) AS total
    FROM factura_recibida
    GROUP BY 1
  ),

  -- 3) Impuestos: DEVENGADO (período fiscal de observaciones, fallback fecha_pago)
  imp_raw AS (
    SELECT
      pi.monto,
      pi.formulario,
      io.tipo,
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
        WHEN periodo_raw IS NOT NULL AND SUBSTR(periodo_raw, 5, 2) = '00'
          THEN LEFT(periodo_raw, 4) || '-12'
        WHEN periodo_raw IS NOT NULL AND SUBSTR(periodo_raw, 5, 2) BETWEEN '01' AND '12'
          THEN LEFT(periodo_raw, 4) || '-' || SUBSTR(periodo_raw, 5, 2)
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
