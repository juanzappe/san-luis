-- Fix: Increase statement timeout for heavy RPCs that scan large tables.
-- Supabase default timeout (8s) is too short for cold-start queries on
-- 200k+ row joins. Use plpgsql wrapper to SET LOCAL statement_timeout.

SET search_path = public;

-- Recreate get_resumen_ejecutivo as plpgsql with extended timeout
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
BEGIN
  -- Allow up to 30s for this heavy aggregation query
  SET LOCAL statement_timeout = '30s';

  RETURN QUERY
  WITH
  pos AS (
    SELECT
      TO_CHAR(v.fecha, 'YYYY-MM') AS p,
      SUM(CASE WHEN LOWER(vd.producto) != 'restobar' THEN COALESCE(vd.neto, 0) ELSE 0 END) AS mostrador,
      SUM(CASE WHEN LOWER(vd.producto) = 'restobar'  THEN COALESCE(vd.neto, 0) ELSE 0 END) AS restobar
    FROM venta v
    JOIN venta_detalle vd ON vd.venta_id = v.id
    GROUP BY 1
  ),
  serv AS (
    SELECT
      TO_CHAR(fecha_emision, 'YYYY-MM') AS p,
      SUM(CASE WHEN tipo_comprobante IN (3,8,203)
               THEN -COALESCE(imp_neto_gravado_total, 0)
               ELSE  COALESCE(imp_neto_gravado_total, 0) END) AS servicios
    FROM factura_emitida
    WHERE punto_venta = 6
    GROUP BY 1
  ),
  prov AS (
    SELECT
      TO_CHAR(fecha_emision, 'YYYY-MM') AS p,
      SUM(CASE WHEN tipo_comprobante IN (3,8,203)
               THEN -COALESCE(imp_neto_gravado_total, 0)
               ELSE  COALESCE(imp_neto_gravado_total, 0) END) AS egresos_op
    FROM factura_recibida
    GROUP BY 1
  ),
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
      COALESCE(sueldo_neto, 0) AS sueldo_neto
    FROM liquidacion_sueldo
  ),
  sue AS (
    SELECT p, SUM(sueldo_neto) AS sueldos
    FROM sueldos_raw
    GROUP BY 1
  ),
  tax AS (
    SELECT
      TO_CHAR(fecha_pago, 'YYYY-MM') AS p,
      SUM(COALESCE(monto, 0)) AS comerciales
    FROM pago_impuesto
    GROUP BY 1
  ),
  fin AS (
    SELECT
      TO_CHAR(fecha, 'YYYY-MM') AS p,
      SUM(COALESCE(debito, 0)) AS financieros
    FROM movimiento_bancario
    WHERE COALESCE(debito, 0) > 0
      AND LOWER(COALESCE(concepto, '')) LIKE ANY(ARRAY[
        '%comision%', '%interes%', '%impuesto s/deb%',
        '%impuesto s/cred%', '%mantenimiento%', '%seguro%', '%sellado%'
      ])
    GROUP BY 1
  ),
  all_periodos AS (
    SELECT p FROM pos
    UNION SELECT p FROM serv
    UNION SELECT p FROM prov
    UNION SELECT p FROM sue
    UNION SELECT p FROM tax
    UNION SELECT p FROM fin
  )
  SELECT
    ap.p,
    COALESCE(po.mostrador, 0),
    COALESCE(po.restobar, 0),
    COALESCE(sv.servicios, 0),
    COALESCE(pr.egresos_op, 0),
    COALESCE(su.sueldos, 0),
    COALESCE(tx.comerciales, 0),
    COALESCE(fn.financieros, 0)
  FROM all_periodos ap
  LEFT JOIN pos  po ON po.p = ap.p
  LEFT JOIN serv sv ON sv.p = ap.p
  LEFT JOIN prov pr ON pr.p = ap.p
  LEFT JOIN sue  su ON su.p = ap.p
  LEFT JOIN tax  tx ON tx.p = ap.p
  LEFT JOIN fin  fn ON fn.p = ap.p
  ORDER BY ap.p;
END;
$$ LANGUAGE plpgsql STABLE;

-- Also extend timeout for the new heavy RPCs from migration 011
-- that scan factura_emitida/factura_recibida (93k+ rows)

CREATE OR REPLACE FUNCTION get_comercial_clientes()
RETURNS TABLE(
  periodo text,
  cuit text,
  denominacion text,
  total_neto numeric,
  cantidad bigint,
  tipo_comprobante int,
  tipo_entidad text,
  clasificacion text
) AS $$
BEGIN
  SET LOCAL statement_timeout = '30s';
  RETURN QUERY
  SELECT
    TO_CHAR(fe.fecha_emision, 'YYYY-MM'),
    COALESCE(fe.nro_doc_receptor, 'SIN_CUIT'),
    COALESCE(fe.denominacion_receptor, 'Sin nombre'),
    SUM(COALESCE(fe.imp_neto_gravado_total, 0)),
    COUNT(*),
    fe.tipo_comprobante::int,
    COALESCE(c.tipo_entidad, 'Sin clasificar'),
    COALESCE(c.clasificacion, 'Sin clasificar')
  FROM factura_emitida fe
  LEFT JOIN cliente c ON c.cuit = fe.nro_doc_receptor
  GROUP BY 1, 2, 3, 6, 7, 8;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION get_comercial_proveedores()
RETURNS TABLE(
  periodo text,
  cuit text,
  denominacion text,
  total_neto numeric,
  cantidad bigint,
  tipo_comprobante int,
  tipo_costo text,
  categoria_egreso text
) AS $$
BEGIN
  SET LOCAL statement_timeout = '30s';
  RETURN QUERY
  SELECT
    TO_CHAR(fr.fecha_emision, 'YYYY-MM'),
    COALESCE(fr.nro_doc_emisor, 'SIN_CUIT'),
    COALESCE(fr.denominacion_emisor, 'Sin nombre'),
    SUM(COALESCE(fr.imp_neto_gravado_total, 0)),
    COUNT(*),
    fr.tipo_comprobante::int,
    COALESCE(p.tipo_costo, 'Sin clasificar'),
    COALESCE(p.categoria_egreso, 'Sin clasificar')
  FROM factura_recibida fr
  LEFT JOIN proveedor p ON p.cuit = fr.nro_doc_emisor
  GROUP BY 1, 2, 3, 6, 7, 8;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION get_flujo_fondos()
RETURNS TABLE(
  periodo text,
  cobros_efectivo numeric,
  cobros_banco numeric,
  cobros_mp numeric,
  pagos_proveedores numeric,
  sueldos numeric,
  impuestos numeric,
  comisiones_bancarias numeric
) AS $$
BEGIN
  SET LOCAL statement_timeout = '30s';
  RETURN QUERY
  WITH meses AS (
    SELECT DISTINCT sub.p FROM (
      SELECT TO_CHAR(fecha, 'YYYY-MM') AS p FROM movimiento_caja
      UNION SELECT TO_CHAR(fecha, 'YYYY-MM') FROM movimiento_bancario
      UNION SELECT TO_CHAR(fecha, 'YYYY-MM') FROM movimiento_mp
      UNION SELECT LEFT(periodo, 7) FROM liquidacion_sueldo WHERE periodo IS NOT NULL
      UNION SELECT TO_CHAR(fecha_pago, 'YYYY-MM') FROM pago_impuesto WHERE fecha_pago IS NOT NULL
    ) sub
  ),
  caja AS (
    SELECT TO_CHAR(fecha, 'YYYY-MM') AS p,
      SUM(COALESCE(importe, 0)) AS efectivo
    FROM movimiento_caja
    WHERE condicion_pago = 'EFECTIVO' AND tipo = 'Venta Contado'
    GROUP BY 1
  ),
  banco_cred AS (
    SELECT TO_CHAR(fecha, 'YYYY-MM') AS p,
      SUM(COALESCE(credito, 0)) AS cobros
    FROM movimiento_bancario
    WHERE COALESCE(credito, 0) > 0
    GROUP BY 1
  ),
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
  mp AS (
    SELECT TO_CHAR(fecha, 'YYYY-MM') AS p,
      SUM(COALESCE(importe, 0)) AS ing
    FROM movimiento_mp
    WHERE COALESCE(importe, 0) > 0
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
    COALESCE(mp.ing, 0),
    COALESCE(bd.pagos_prov, 0),
    COALESCE(s.neto, 0),
    COALESCE(i.total, 0),
    COALESCE(bd.comisiones, 0)
  FROM meses m
  LEFT JOIN caja c ON c.p = m.p
  LEFT JOIN banco_cred bc ON bc.p = m.p
  LEFT JOIN banco_deb bd ON bd.p = m.p
  LEFT JOIN mp ON mp.p = m.p
  LEFT JOIN sue s ON s.p = m.p
  LEFT JOIN imp i ON i.p = m.p
  ORDER BY m.p;
END;
$$ LANGUAGE plpgsql STABLE;
