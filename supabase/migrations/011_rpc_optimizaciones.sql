-- Optimizaciones: RPCs para reemplazar fetches de tablas completas.
-- Elimina el problema de truncamiento a 1000 filas del REST API
-- y reduce timeouts al agregar datos en el servidor.

SET search_path = public;

-- ---------------------------------------------------------------------------
-- RPC 1: COMERCIAL - CLIENTES (reemplaza fetch de ALL factura_emitida + cliente)
-- ---------------------------------------------------------------------------
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
  GROUP BY 1, 2, 3, 6, 7, 8
$$ LANGUAGE sql STABLE;

-- ---------------------------------------------------------------------------
-- RPC 2: COMERCIAL - PROVEEDORES (reemplaza fetch de ALL factura_recibida + proveedor)
-- ---------------------------------------------------------------------------
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
  GROUP BY 1, 2, 3, 6, 7, 8
$$ LANGUAGE sql STABLE;

-- ---------------------------------------------------------------------------
-- RPC 3: COMERCIAL - DETALLE CLIENTE (facturas de un CUIT con agregación mensual)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_detalle_cliente(p_cuit text)
RETURNS TABLE(
  periodo text,
  total_neto numeric,
  cantidad bigint,
  tipo_comprobante int,
  primera_fecha date,
  ultima_fecha date,
  cant_fechas_distintas bigint
) AS $$
  SELECT
    TO_CHAR(fecha_emision, 'YYYY-MM'),
    SUM(COALESCE(imp_neto_gravado_total, 0)),
    COUNT(*),
    tipo_comprobante::int,
    MIN(fecha_emision),
    MAX(fecha_emision),
    COUNT(DISTINCT fecha_emision)
  FROM factura_emitida
  WHERE nro_doc_receptor = p_cuit
  GROUP BY 1, 4
$$ LANGUAGE sql STABLE;

-- ---------------------------------------------------------------------------
-- RPC 4: COMERCIAL - DETALLE PROVEEDOR
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_detalle_proveedor(p_cuit text)
RETURNS TABLE(
  periodo text,
  total_neto numeric,
  cantidad bigint,
  tipo_comprobante int,
  primera_fecha date,
  ultima_fecha date,
  cant_fechas_distintas bigint
) AS $$
  SELECT
    TO_CHAR(fecha_emision, 'YYYY-MM'),
    SUM(COALESCE(imp_neto_gravado_total, 0)),
    COUNT(*),
    tipo_comprobante::int,
    MIN(fecha_emision),
    MAX(fecha_emision),
    COUNT(DISTINCT fecha_emision)
  FROM factura_recibida
  WHERE nro_doc_emisor = p_cuit
  GROUP BY 1, 4
$$ LANGUAGE sql STABLE;

-- ---------------------------------------------------------------------------
-- RPC 5: FINANCIERO - FLUJO DE FONDOS MENSUAL
-- (reemplaza 5 fetches completos: caja, banco, mp, sueldos, impuestos)
-- ---------------------------------------------------------------------------
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
  WITH meses AS (
    -- Collect all periods from all sources
    SELECT DISTINCT p FROM (
      SELECT TO_CHAR(fecha, 'YYYY-MM') AS p FROM movimiento_caja
      UNION SELECT TO_CHAR(fecha, 'YYYY-MM') FROM movimiento_bancario
      UNION SELECT TO_CHAR(fecha, 'YYYY-MM') FROM movimiento_mp
      UNION SELECT TO_CHAR(periodo::date, 'YYYY-MM') FROM liquidacion_sueldo WHERE periodo IS NOT NULL
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
  ORDER BY m.p
$$ LANGUAGE sql STABLE;

-- ---------------------------------------------------------------------------
-- RPC 6: IMPUESTOS - PAGOS CON JOIN A OBLIGACIONES
-- (reemplaza fetch de ALL pago_impuesto + ALL impuesto_obligacion)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_pagos_impuestos()
RETURNS TABLE(
  id bigint,
  fecha_pago date,
  monto numeric,
  medio_pago text,
  numero_vep text,
  formulario text,
  observaciones text,
  obligacion_tipo text,
  obligacion_periodo text,
  obligacion_fuente text
) AS $$
  SELECT
    pi.id,
    pi.fecha_pago,
    pi.monto,
    pi.medio_pago,
    pi.numero_vep,
    pi.formulario,
    pi.observaciones,
    io.tipo::text,
    io.periodo,
    io.fuente::text
  FROM pago_impuesto pi
  LEFT JOIN impuesto_obligacion io ON io.id = pi.impuesto_obligacion_id
  ORDER BY pi.fecha_pago DESC
$$ LANGUAGE sql STABLE;

-- ---------------------------------------------------------------------------
-- RPC 7: IMPUESTOS - OBLIGACIONES RESUMEN
-- (datos para fetchResumenFiscal: IIBB, municipales, próx. vencimiento)
-- Solo devuelve las filas relevantes para el cálculo fiscal.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_obligaciones_resumen()
RETURNS TABLE(
  id bigint,
  tipo text,
  periodo text,
  fuente text,
  fecha_vencimiento date,
  monto_determinado numeric,
  compensaciones_recibidas numeric,
  compensaciones_enviadas numeric,
  estado text
) AS $$
  SELECT
    io.id,
    io.tipo::text,
    io.periodo,
    io.fuente::text,
    io.fecha_vencimiento,
    COALESCE(io.monto_determinado, 0),
    COALESCE(io.compensaciones_recibidas, 0),
    COALESCE(io.compensaciones_enviadas, 0),
    io.estado::text
  FROM impuesto_obligacion io
  ORDER BY io.periodo
$$ LANGUAGE sql STABLE;
