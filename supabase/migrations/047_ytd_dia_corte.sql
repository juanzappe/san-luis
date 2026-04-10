-- 047_ytd_dia_corte.sql
-- RPCs for YTD day-level cutoff: determine the exact last date with data
-- and return partial-month amounts filtered to day <= cutoff for each year.
-- Used by YTD comparison tables to avoid distortion from partial months.

SET search_path = public;

-- ---------------------------------------------------------------------------
-- 1. get_fecha_corte_ytd()
--    Returns the cutoff date for YTD comparisons: the max date across
--    venta and factura_emitida in the most recent year with data.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_fecha_corte_ytd()
RETURNS TABLE(anio int, mes int, dia int, es_fin_de_mes bool)
LANGUAGE sql STABLE
SET statement_timeout TO '10s'
AS $$
  WITH max_dates AS (
    SELECT MAX(v.fecha::date) AS f
    FROM venta v
    WHERE EXTRACT(YEAR FROM v.fecha) = (SELECT MAX(EXTRACT(YEAR FROM fecha)) FROM venta)
    UNION ALL
    SELECT MAX(fe.fecha_emision)
    FROM factura_emitida fe
    WHERE EXTRACT(YEAR FROM fe.fecha_emision) = (SELECT MAX(EXTRACT(YEAR FROM fecha_emision)) FROM factura_emitida)
  ),
  corte AS (
    SELECT MAX(f) AS fecha FROM max_dates
  )
  SELECT
    EXTRACT(YEAR FROM c.fecha)::int,
    EXTRACT(MONTH FROM c.fecha)::int,
    EXTRACT(DAY FROM c.fecha)::int,
    c.fecha = (DATE_TRUNC('month', c.fecha) + INTERVAL '1 month' - INTERVAL '1 day')::date
  FROM corte c
  WHERE c.fecha IS NOT NULL;
$$;

-- ---------------------------------------------------------------------------
-- 2. get_ingresos_mes_parcial(p_mes, p_dia)
--    Same structure as get_ingresos_mensual but for a single month,
--    filtered to day <= p_dia, with one row per year.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_ingresos_mes_parcial(p_mes int, p_dia int)
RETURNS TABLE(periodo text, mostrador numeric, restobar numeric, servicios numeric)
LANGUAGE sql STABLE
SET statement_timeout TO '15s'
AS $$
  WITH pos AS (
    SELECT
      TO_CHAR(v.fecha, 'YYYY') || '-' || LPAD(p_mes::text, 2, '0') AS periodo,
      SUM(CASE WHEN LOWER(vd.producto) != 'restobar' THEN vd.neto ELSE 0 END) AS mostrador,
      SUM(CASE WHEN LOWER(vd.producto) = 'restobar' THEN vd.neto ELSE 0 END) AS restobar
    FROM venta v
    JOIN venta_detalle vd ON vd.venta_id = v.id
    WHERE EXTRACT(MONTH FROM v.fecha) = p_mes
      AND EXTRACT(DAY FROM v.fecha) <= p_dia
      AND NOT COALESCE(vd.excluir_analisis, false)
    GROUP BY 1
  ),
  serv AS (
    SELECT
      TO_CHAR(fecha_emision, 'YYYY') || '-' || LPAD(p_mes::text, 2, '0') AS periodo,
      SUM(CASE WHEN tipo_comprobante IN (3,8,203)
               THEN -imp_neto_gravado_total
               ELSE imp_neto_gravado_total END) AS servicios
    FROM factura_emitida
    WHERE punto_venta = 6
      AND EXTRACT(MONTH FROM fecha_emision) = p_mes
      AND EXTRACT(DAY FROM fecha_emision) <= p_dia
    GROUP BY 1
  )
  SELECT
    COALESCE(p.periodo, s.periodo),
    COALESCE(p.mostrador, 0),
    COALESCE(p.restobar, 0),
    COALESCE(s.servicios, 0)
  FROM pos p
  FULL OUTER JOIN serv s ON p.periodo = s.periodo;
$$;

-- ---------------------------------------------------------------------------
-- 3. get_egresos_mes_parcial(p_mes, p_dia)
--    Only day-cuttable expense items: proveedores and financieros.
--    Sueldos, cargas sociales, impuestos are monthly concepts (not included).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_egresos_mes_parcial(p_mes int, p_dia int)
RETURNS TABLE(periodo text, proveedores numeric, financieros numeric)
LANGUAGE sql STABLE
SET statement_timeout TO '15s'
AS $$
  WITH prov AS (
    SELECT
      TO_CHAR(fecha_emision, 'YYYY') || '-' || LPAD(p_mes::text, 2, '0') AS periodo,
      SUM(CASE WHEN tipo_comprobante IN (3,8,203)
               THEN -(COALESCE(imp_neto_gravado_total, 0) + COALESCE(imp_neto_no_gravado, 0) + COALESCE(imp_op_exentas, 0))
               ELSE   COALESCE(imp_neto_gravado_total, 0) + COALESCE(imp_neto_no_gravado, 0) + COALESCE(imp_op_exentas, 0) END) AS total
    FROM factura_recibida
    WHERE EXTRACT(MONTH FROM fecha_emision) = p_mes
      AND EXTRACT(DAY FROM fecha_emision) <= p_dia
    GROUP BY 1
  ),
  fin AS (
    SELECT
      TO_CHAR(fecha, 'YYYY') || '-' || LPAD(p_mes::text, 2, '0') AS periodo,
      SUM(COALESCE(debito, 0)) AS total
    FROM movimiento_bancario
    WHERE COALESCE(debito, 0) > 0
      AND LOWER(COALESCE(concepto, '')) LIKE ANY(ARRAY[
        '%comision%', '%interes%', '%impuesto s/deb%',
        '%impuesto s/cred%', '%mantenimiento%', '%seguro%', '%sellado%'
      ])
      AND EXTRACT(MONTH FROM fecha) = p_mes
      AND EXTRACT(DAY FROM fecha) <= p_dia
    GROUP BY 1
  )
  SELECT
    COALESCE(p.periodo, f.periodo),
    COALESCE(p.total, 0),
    COALESCE(f.total, 0)
  FROM prov p
  FULL OUTER JOIN fin f ON p.periodo = f.periodo;
$$;

-- ---------------------------------------------------------------------------
-- 4. get_mostrador_mes_parcial(p_mes, p_dia)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_mostrador_mes_parcial(p_mes int, p_dia int)
RETURNS TABLE(periodo text, monto numeric, cantidad numeric, tx_count bigint)
LANGUAGE sql STABLE
SET statement_timeout TO '15s'
AS $$
  SELECT
    TO_CHAR(v.fecha, 'YYYY') || '-' || LPAD(p_mes::text, 2, '0'),
    SUM(COALESCE(vd.neto, 0)),
    SUM(COALESCE(vd.cantidad, 0)),
    COUNT(DISTINCT v.id)
  FROM venta v
  JOIN venta_detalle vd ON vd.venta_id = v.id
  WHERE LOWER(COALESCE(vd.producto, '')) != 'restobar'
    AND NOT COALESCE(vd.excluir_analisis, false)
    AND EXTRACT(MONTH FROM v.fecha) = p_mes
    AND EXTRACT(DAY FROM v.fecha) <= p_dia
  GROUP BY 1
  ORDER BY 1;
$$;

-- ---------------------------------------------------------------------------
-- 5. get_restobar_mes_parcial(p_mes, p_dia)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_restobar_mes_parcial(p_mes int, p_dia int)
RETURNS TABLE(periodo text, monto numeric, cantidad numeric, tx_count bigint)
LANGUAGE sql STABLE
SET statement_timeout TO '15s'
AS $$
  SELECT
    TO_CHAR(v.fecha, 'YYYY') || '-' || LPAD(p_mes::text, 2, '0'),
    SUM(COALESCE(vd.neto, 0)),
    SUM(COALESCE(vd.cantidad, 0)),
    COUNT(DISTINCT v.id)
  FROM venta v
  JOIN venta_detalle vd ON vd.venta_id = v.id
  WHERE LOWER(COALESCE(vd.producto, '')) = 'restobar'
    AND NOT COALESCE(vd.excluir_analisis, false)
    AND EXTRACT(MONTH FROM v.fecha) = p_mes
    AND EXTRACT(DAY FROM v.fecha) <= p_dia
  GROUP BY 1
  ORDER BY 1;
$$;

-- ---------------------------------------------------------------------------
-- 6. get_servicios_mes_parcial(p_mes, p_dia)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_servicios_mes_parcial(p_mes int, p_dia int)
RETURNS TABLE(periodo text, publico numeric, privado numeric, total numeric, tx_count bigint)
LANGUAGE sql STABLE
SET statement_timeout TO '15s'
AS $$
  SELECT
    TO_CHAR(fe.fecha_emision, 'YYYY') || '-' || LPAD(p_mes::text, 2, '0') AS periodo,
    SUM(CASE
      WHEN LOWER(COALESCE(c.tipo_entidad, '')) LIKE '%público%'
        OR LOWER(COALESCE(c.tipo_entidad, '')) LIKE '%publico%'
      THEN CASE WHEN fe.tipo_comprobante IN (3, 8, 203)
                THEN -COALESCE(fe.imp_neto_gravado_total, 0)
                ELSE  COALESCE(fe.imp_neto_gravado_total, 0) END
      ELSE 0 END) AS publico,
    SUM(CASE
      WHEN NOT (LOWER(COALESCE(c.tipo_entidad, '')) LIKE '%público%'
             OR LOWER(COALESCE(c.tipo_entidad, '')) LIKE '%publico%')
      THEN CASE WHEN fe.tipo_comprobante IN (3, 8, 203)
                THEN -COALESCE(fe.imp_neto_gravado_total, 0)
                ELSE  COALESCE(fe.imp_neto_gravado_total, 0) END
      ELSE 0 END) AS privado,
    SUM(CASE WHEN fe.tipo_comprobante IN (3, 8, 203)
             THEN -COALESCE(fe.imp_neto_gravado_total, 0)
             ELSE  COALESCE(fe.imp_neto_gravado_total, 0) END) AS total,
    COUNT(*)
  FROM factura_emitida fe
  LEFT JOIN cliente c ON c.cuit = fe.nro_doc_receptor
  WHERE fe.punto_venta = 6
    AND EXTRACT(MONTH FROM fe.fecha_emision) = p_mes
    AND EXTRACT(DAY FROM fe.fecha_emision) <= p_dia
  GROUP BY 1
  ORDER BY 1;
$$;
