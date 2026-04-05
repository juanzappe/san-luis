-- Migration 041: Add excluir_analisis flag to venta_detalle
-- Allows marking anomalous sale lines (e.g. cashier keying total as quantity)
-- without deleting them. Excluded from all analysis queries but still visible
-- for fiscal/conciliation purposes.

-- Step 1: Add column
ALTER TABLE venta_detalle ADD COLUMN IF NOT EXISTS excluir_analisis BOOLEAN DEFAULT false;

-- Step 2: Mark known anomalous row (2024-08-02, MASAS FINAS POR KL, qty 1250)
UPDATE venta_detalle
SET excluir_analisis = true
WHERE producto = 'MASAS FINAS POR KL'
  AND cantidad = 1250
  AND neto > 20000000;

-- Step 3: Index for the flag (partial — only true rows, very small)
CREATE INDEX IF NOT EXISTS idx_venta_detalle_excluir
    ON venta_detalle (excluir_analisis) WHERE excluir_analisis = true;

-- =========================================================================
-- Step 4: Recreate all analysis RPCs with excluir_analisis filter
-- =========================================================================

-- 4a. get_mostrador_mensual
CREATE OR REPLACE FUNCTION get_mostrador_mensual()
RETURNS TABLE(
    periodo     text,
    monto       numeric,
    cantidad    numeric,
    tx_count    bigint
) AS $$
    SELECT
        TO_CHAR(v.fecha, 'YYYY-MM'),
        SUM(COALESCE(vd.neto, 0)),
        SUM(COALESCE(vd.cantidad, 0)),
        COUNT(DISTINCT v.id)
    FROM venta v
    JOIN venta_detalle vd ON vd.venta_id = v.id
    WHERE LOWER(COALESCE(vd.producto, '')) != 'restobar'
      AND NOT COALESCE(vd.excluir_analisis, false)
    GROUP BY 1
    ORDER BY 1
$$ LANGUAGE sql STABLE
SET statement_timeout = '30s';

-- 4b. get_mostrador_heatmap
CREATE OR REPLACE FUNCTION get_mostrador_heatmap()
RETURNS TABLE(
    day     int,
    hour    int,
    monto   numeric,
    count   bigint
) AS $$
    SELECT
        EXTRACT(DOW FROM v.fecha)::int,
        EXTRACT(HOUR FROM v.fecha)::int,
        SUM(COALESCE(vd.neto, 0)),
        COUNT(*)
    FROM venta v
    JOIN venta_detalle vd ON vd.venta_id = v.id
    WHERE LOWER(COALESCE(vd.producto, '')) != 'restobar'
      AND NOT COALESCE(vd.excluir_analisis, false)
    GROUP BY 1, 2
$$ LANGUAGE sql STABLE
SET statement_timeout = '30s';

-- 4c. get_mostrador_productos_lista
CREATE OR REPLACE FUNCTION get_mostrador_productos_lista()
RETURNS TABLE(producto text) AS $$
    SELECT DISTINCT vd.producto
    FROM venta_detalle vd
    WHERE vd.producto IS NOT NULL
      AND LOWER(vd.producto) != 'restobar'
      AND NOT COALESCE(vd.excluir_analisis, false)
    ORDER BY 1
$$ LANGUAGE sql STABLE
SET statement_timeout = '30s';

-- 4d. get_mostrador_producto_semanal
CREATE OR REPLACE FUNCTION get_mostrador_producto_semanal(p_producto text)
RETURNS TABLE(
    semana          text,
    semana_inicio   date,
    cantidad        numeric,
    monto           numeric
) AS $$
    SELECT
        TO_CHAR(DATE_TRUNC('week', v.fecha), 'IYYY-"W"IW'),
        DATE_TRUNC('week', v.fecha)::date,
        SUM(COALESCE(vd.cantidad, 0)),
        SUM(COALESCE(vd.neto, 0))
    FROM venta v
    JOIN venta_detalle vd ON vd.venta_id = v.id
    WHERE LOWER(vd.producto) = LOWER(p_producto)
      AND v.fecha >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '3 months'
      AND NOT COALESCE(vd.excluir_analisis, false)
    GROUP BY 1, 2
    ORDER BY 2
$$ LANGUAGE sql STABLE
SET statement_timeout = '30s';

-- 4e. get_mostrador_ranking_mensual (supersedes migration 040)
CREATE OR REPLACE FUNCTION get_mostrador_ranking_mensual(p_periodo text)
RETURNS TABLE(
    producto        text,
    total_cantidad  numeric,
    total_monto     numeric,
    dias_con_venta  bigint,
    promedio_diario numeric
) AS $$
    WITH detalles AS (
        SELECT
            vd.producto,
            COALESCE(vd.cantidad, 1) AS cantidad,
            COALESCE(vd.neto, 0)     AS neto,
            v.fecha::date            AS dia
        FROM venta v
        JOIN venta_detalle vd ON vd.venta_id = v.id
        WHERE TO_CHAR(v.fecha, 'YYYY-MM') = p_periodo
          AND LOWER(COALESCE(vd.producto, '')) NOT IN ('restobar', '')
          AND COALESCE(vd.precio_unitario, 0) >= 100
          AND NOT COALESCE(vd.excluir_analisis, false)
    )
    SELECT
        d.producto,
        SUM(d.cantidad),
        SUM(d.neto),
        COUNT(DISTINCT d.dia),
        CASE WHEN COUNT(DISTINCT d.dia) > 0
             THEN ROUND(SUM(d.cantidad) / COUNT(DISTINCT d.dia), 1)
             ELSE 0 END
    FROM detalles d
    WHERE d.producto IS NOT NULL
    GROUP BY 1
    ORDER BY SUM(d.cantidad) DESC
$$ LANGUAGE sql STABLE
SET statement_timeout = '30s';

-- 4f. get_restobar_mensual
CREATE OR REPLACE FUNCTION get_restobar_mensual()
RETURNS TABLE(
    periodo     text,
    monto       numeric,
    cantidad    numeric,
    tx_count    bigint
) AS $$
    SELECT
        TO_CHAR(v.fecha, 'YYYY-MM'),
        SUM(COALESCE(vd.neto, 0)),
        SUM(COALESCE(vd.cantidad, 0)),
        COUNT(DISTINCT v.id)
    FROM venta v
    JOIN venta_detalle vd ON vd.venta_id = v.id
    WHERE LOWER(COALESCE(vd.producto, '')) = 'restobar'
      AND NOT COALESCE(vd.excluir_analisis, false)
    GROUP BY 1
    ORDER BY 1
$$ LANGUAGE sql STABLE
SET statement_timeout = '30s';

-- 4g. get_restobar_heatmap
CREATE OR REPLACE FUNCTION get_restobar_heatmap()
RETURNS TABLE(
    day     int,
    hour    int,
    monto   numeric,
    count   bigint
) AS $$
    SELECT
        EXTRACT(DOW FROM v.fecha)::int,
        EXTRACT(HOUR FROM v.fecha)::int,
        SUM(COALESCE(vd.neto, 0)),
        COUNT(*)
    FROM venta v
    JOIN venta_detalle vd ON vd.venta_id = v.id
    WHERE LOWER(COALESCE(vd.producto, '')) = 'restobar'
      AND NOT COALESCE(vd.excluir_analisis, false)
    GROUP BY 1, 2
$$ LANGUAGE sql STABLE
SET statement_timeout = '30s';

-- 4h. get_ingresos_mensual
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
    WHERE NOT COALESCE(vd.excluir_analisis, false)
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

-- 4i. get_resumen_ejecutivo
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
  pos AS (
    SELECT
      TO_CHAR(v.fecha, 'YYYY-MM') AS periodo,
      SUM(CASE WHEN LOWER(vd.producto) != 'restobar' THEN COALESCE(vd.neto, 0) ELSE 0 END) AS mostrador,
      SUM(CASE WHEN LOWER(vd.producto) = 'restobar'  THEN COALESCE(vd.neto, 0) ELSE 0 END) AS restobar
    FROM venta v
    JOIN venta_detalle vd ON vd.venta_id = v.id
    WHERE NOT COALESCE(vd.excluir_analisis, false)
    GROUP BY 1
  ),
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
  prov AS (
    SELECT
      TO_CHAR(fecha_emision, 'YYYY-MM') AS periodo,
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
      END AS periodo,
      COALESCE(sueldo_neto, 0) AS sueldo_neto
    FROM liquidacion_sueldo
  ),
  sue AS (
    SELECT periodo, SUM(sueldo_neto) AS sueldos
    FROM sueldos_raw
    GROUP BY 1
  ),
  tax AS (
    SELECT
      TO_CHAR(fecha_pago, 'YYYY-MM') AS periodo,
      SUM(COALESCE(monto, 0)) AS comerciales
    FROM pago_impuesto
    GROUP BY 1
  ),
  fin AS (
    SELECT
      TO_CHAR(fecha, 'YYYY-MM') AS periodo,
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
  ORDER BY ap.periodo
$$ LANGUAGE sql STABLE
SET statement_timeout = '30s';
