-- Fix: Add SET statement_timeout = '30s' to all remaining RPCs and
-- create new get_egresos_mensual() to replace 6 fetchAllRows() calls.

SET search_path = public;

-- ---------------------------------------------------------------------------
-- Recreate existing RPCs with timeout override
-- ---------------------------------------------------------------------------

-- get_ingresos_mensual (from 008) — scans venta_detalle 200k+ rows
CREATE OR REPLACE FUNCTION get_ingresos_mensual()
RETURNS TABLE(periodo text, mostrador numeric, restobar numeric, servicios numeric)
AS $$
  WITH pos AS (
    SELECT
      TO_CHAR(v.fecha, 'YYYY-MM') AS periodo,
      SUM(CASE WHEN LOWER(vd.producto) != 'restobar' THEN vd.neto ELSE 0 END) AS mostrador,
      SUM(CASE WHEN LOWER(vd.producto) = 'restobar' THEN vd.neto ELSE 0 END) AS restobar
    FROM venta v
    JOIN venta_detalle vd ON vd.venta_id = v.id
    GROUP BY 1
  ),
  serv AS (
    SELECT
      TO_CHAR(fecha_emision, 'YYYY-MM') AS periodo,
      SUM(CASE WHEN tipo_comprobante IN (3,8,203) THEN -imp_neto_gravado_total ELSE imp_neto_gravado_total END) AS servicios
    FROM factura_emitida
    WHERE punto_venta = 6
    GROUP BY 1
  )
  SELECT
    COALESCE(p.periodo, s.periodo),
    COALESCE(p.mostrador, 0),
    COALESCE(p.restobar, 0),
    COALESCE(s.servicios, 0)
  FROM pos p
  FULL OUTER JOIN serv s ON p.periodo = s.periodo
$$ LANGUAGE sql STABLE
SET statement_timeout = '30s';

-- get_iva_ingresos_mensual (from 008) — scans factura_emitida + factura_recibida
CREATE OR REPLACE FUNCTION get_iva_ingresos_mensual()
RETURNS TABLE(periodo text, iva_debito numeric, iva_credito numeric, ingresos numeric)
AS $$
  SELECT
    TO_CHAR(fecha_emision, 'YYYY-MM'),
    SUM(CASE WHEN tipo_comprobante IN (3,8,203) THEN -total_iva ELSE total_iva END),
    0::numeric,
    SUM(CASE WHEN tipo_comprobante IN (3,8,203) THEN -imp_total ELSE imp_total END)
  FROM factura_emitida
  GROUP BY 1

  UNION ALL

  SELECT
    TO_CHAR(fecha_emision, 'YYYY-MM'),
    0::numeric,
    SUM(CASE WHEN tipo_comprobante IN (3,8,203) THEN -total_iva ELSE total_iva END),
    0::numeric
  FROM factura_recibida
  GROUP BY 1
$$ LANGUAGE sql STABLE
SET statement_timeout = '30s';

-- get_posicion_iva_mensual (from 008) — scans factura_emitida + factura_recibida
CREATE OR REPLACE FUNCTION get_posicion_iva_mensual()
RETURNS TABLE(
  periodo text, tipo text,
  iva_21 numeric, iva_10_5 numeric, iva_27 numeric,
  iva_5 numeric, iva_2_5 numeric, total_iva numeric,
  otros_tributos numeric
) AS $$
  SELECT
    TO_CHAR(fecha_emision, 'YYYY-MM'), 'debito',
    SUM(CASE WHEN tipo_comprobante IN (3,8,203) THEN -iva_21 ELSE iva_21 END),
    SUM(CASE WHEN tipo_comprobante IN (3,8,203) THEN -iva_10_5 ELSE iva_10_5 END),
    SUM(CASE WHEN tipo_comprobante IN (3,8,203) THEN -iva_27 ELSE iva_27 END),
    SUM(CASE WHEN tipo_comprobante IN (3,8,203) THEN -iva_5 ELSE iva_5 END),
    SUM(CASE WHEN tipo_comprobante IN (3,8,203) THEN -iva_2_5 ELSE iva_2_5 END),
    SUM(CASE WHEN tipo_comprobante IN (3,8,203) THEN -total_iva ELSE total_iva END),
    0::numeric
  FROM factura_emitida
  GROUP BY 1

  UNION ALL

  SELECT
    TO_CHAR(fecha_emision, 'YYYY-MM'), 'credito',
    SUM(CASE WHEN tipo_comprobante IN (3,8,203) THEN -iva_21 ELSE iva_21 END),
    SUM(CASE WHEN tipo_comprobante IN (3,8,203) THEN -iva_10_5 ELSE iva_10_5 END),
    SUM(CASE WHEN tipo_comprobante IN (3,8,203) THEN -iva_27 ELSE iva_27 END),
    SUM(CASE WHEN tipo_comprobante IN (3,8,203) THEN -iva_5 ELSE iva_5 END),
    SUM(CASE WHEN tipo_comprobante IN (3,8,203) THEN -iva_2_5 ELSE iva_2_5 END),
    SUM(CASE WHEN tipo_comprobante IN (3,8,203) THEN -total_iva ELSE total_iva END),
    SUM(CASE WHEN tipo_comprobante IN (3,8,203) THEN -COALESCE(otros_tributos, 0) ELSE COALESCE(otros_tributos, 0) END)
  FROM factura_recibida
  GROUP BY 1
$$ LANGUAGE sql STABLE
SET statement_timeout = '30s';

-- get_cheque_mensual (from 007) — scans movimiento_bancario + movimiento_mp
CREATE OR REPLACE FUNCTION get_cheque_mensual()
RETURNS TABLE(periodo text, importe_cheque numeric)
AS $$
  SELECT
    TO_CHAR(fecha, 'YYYY-MM'),
    (COALESCE(SUM(ABS(debito)), 0) + COALESCE(SUM(ABS(credito)), 0)) * 0.012
  FROM movimiento_bancario
  WHERE concepto NOT ILIKE '%IMPUESTO LEY 25413%'
  GROUP BY 1

  UNION ALL

  SELECT
    TO_CHAR(fecha, 'YYYY-MM'),
    SUM(ABS(importe)) * 0.012
  FROM movimiento_mp
  GROUP BY 1
$$ LANGUAGE sql STABLE
SET statement_timeout = '30s';

-- get_pagos_impuestos (from 011) — joins pago_impuesto + impuesto_obligacion
CREATE OR REPLACE FUNCTION get_pagos_impuestos()
RETURNS TABLE(
  id bigint, fecha_pago date, monto numeric, medio_pago text,
  numero_vep text, formulario text, observaciones text,
  obligacion_tipo text, obligacion_periodo text, obligacion_fuente text
) AS $$
  SELECT
    pi.id, pi.fecha_pago, pi.monto, pi.medio_pago,
    pi.numero_vep, pi.formulario, pi.observaciones,
    io.tipo::text, io.periodo, io.fuente::text
  FROM pago_impuesto pi
  LEFT JOIN impuesto_obligacion io ON io.id = pi.impuesto_obligacion_id
  ORDER BY pi.fecha_pago DESC
$$ LANGUAGE sql STABLE
SET statement_timeout = '30s';

-- get_obligaciones_resumen (from 011)
CREATE OR REPLACE FUNCTION get_obligaciones_resumen()
RETURNS TABLE(
  id bigint, tipo text, periodo text, fuente text,
  fecha_vencimiento date, monto_determinado numeric,
  compensaciones_recibidas numeric, compensaciones_enviadas numeric,
  estado text
) AS $$
  SELECT
    io.id, io.tipo::text, io.periodo, io.fuente::text,
    io.fecha_vencimiento,
    COALESCE(io.monto_determinado, 0),
    COALESCE(io.compensaciones_recibidas, 0),
    COALESCE(io.compensaciones_enviadas, 0),
    io.estado::text
  FROM impuesto_obligacion io
  ORDER BY io.periodo
$$ LANGUAGE sql STABLE
SET statement_timeout = '30s';

-- get_detalle_cliente (from 011)
CREATE OR REPLACE FUNCTION get_detalle_cliente(p_cuit text)
RETURNS TABLE(
  periodo text, total_neto numeric, cantidad bigint,
  tipo_comprobante int, primera_fecha date, ultima_fecha date,
  cant_fechas_distintas bigint
) AS $$
  SELECT
    TO_CHAR(fecha_emision, 'YYYY-MM'),
    SUM(COALESCE(imp_neto_gravado_total, 0)),
    COUNT(*),
    tipo_comprobante::int,
    MIN(fecha_emision), MAX(fecha_emision),
    COUNT(DISTINCT fecha_emision)
  FROM factura_emitida
  WHERE nro_doc_receptor = p_cuit
  GROUP BY 1, 4
$$ LANGUAGE sql STABLE
SET statement_timeout = '30s';

-- get_detalle_proveedor (from 011)
CREATE OR REPLACE FUNCTION get_detalle_proveedor(p_cuit text)
RETURNS TABLE(
  periodo text, total_neto numeric, cantidad bigint,
  tipo_comprobante int, primera_fecha date, ultima_fecha date,
  cant_fechas_distintas bigint
) AS $$
  SELECT
    TO_CHAR(fecha_emision, 'YYYY-MM'),
    SUM(COALESCE(imp_neto_gravado_total, 0)),
    COUNT(*),
    tipo_comprobante::int,
    MIN(fecha_emision), MAX(fecha_emision),
    COUNT(DISTINCT fecha_emision)
  FROM factura_recibida
  WHERE nro_doc_emisor = p_cuit
  GROUP BY 1, 4
$$ LANGUAGE sql STABLE
SET statement_timeout = '30s';

-- ---------------------------------------------------------------------------
-- NEW RPC: get_egresos_mensual — replaces 6 fetchAllRows() calls in
-- fetchEgresos(). Aggregates sueldos, proveedores, impuestos, financieros
-- all server-side.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_egresos_mensual()
RETURNS TABLE(
  periodo text,
  sueldos_costo numeric,       -- costo_total_empresa with devengamiento
  sueldos_neto numeric,        -- sueldo_neto with devengamiento
  proveedores numeric,         -- factura_recibida neto (with NC sign)
  impuestos_comerciales numeric, -- pago_impuesto excluding ganancias
  ganancias numeric,           -- pago_impuesto where tipo = 'ganancias'
  financieros numeric          -- bank fees
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

  -- 3) Impuestos: split ganancias vs others
  imp AS (
    SELECT
      TO_CHAR(pi.fecha_pago, 'YYYY-MM') AS p,
      SUM(CASE WHEN io.tipo = 'ganancias' THEN 0 ELSE COALESCE(pi.monto, 0) END) AS comerciales,
      SUM(CASE WHEN io.tipo = 'ganancias' THEN COALESCE(pi.monto, 0) ELSE 0 END) AS ganancias
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
    COALESCE(f.total, 0)
  FROM all_p ap
  LEFT JOIN sue s ON s.p = ap.p
  LEFT JOIN prov pr ON pr.p = ap.p
  LEFT JOIN imp i ON i.p = ap.p
  LEFT JOIN fin f ON f.p = ap.p
  ORDER BY ap.p
$$ LANGUAGE sql STABLE
SET statement_timeout = '30s';
