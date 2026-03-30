-- RPC for ingresos mensual (server-side aggregation of 170k+ venta_detalle rows)
-- and credit note (NC) sign handling for all factura RPCs.

-- New RPC: monthly ingresos by business unit
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
$$ LANGUAGE sql STABLE;

-- Update: IVA + ingresos with credit note sign handling
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
$$ LANGUAGE sql STABLE;

-- Update: IVA position detail with credit note sign handling
CREATE OR REPLACE FUNCTION get_posicion_iva_mensual()
RETURNS TABLE(
  periodo text,
  tipo text,
  iva_21 numeric,
  iva_10_5 numeric,
  iva_27 numeric,
  iva_5 numeric,
  iva_2_5 numeric,
  total_iva numeric,
  otros_tributos numeric
) AS $$
  SELECT
    TO_CHAR(fecha_emision, 'YYYY-MM'),
    'debito',
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
    TO_CHAR(fecha_emision, 'YYYY-MM'),
    'credito',
    SUM(CASE WHEN tipo_comprobante IN (3,8,203) THEN -iva_21 ELSE iva_21 END),
    SUM(CASE WHEN tipo_comprobante IN (3,8,203) THEN -iva_10_5 ELSE iva_10_5 END),
    SUM(CASE WHEN tipo_comprobante IN (3,8,203) THEN -iva_27 ELSE iva_27 END),
    SUM(CASE WHEN tipo_comprobante IN (3,8,203) THEN -iva_5 ELSE iva_5 END),
    SUM(CASE WHEN tipo_comprobante IN (3,8,203) THEN -iva_2_5 ELSE iva_2_5 END),
    SUM(CASE WHEN tipo_comprobante IN (3,8,203) THEN -total_iva ELSE total_iva END),
    SUM(CASE WHEN tipo_comprobante IN (3,8,203) THEN -COALESCE(otros_tributos, 0) ELSE COALESCE(otros_tributos, 0) END)
  FROM factura_recibida
  GROUP BY 1
$$ LANGUAGE sql STABLE;
