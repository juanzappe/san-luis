-- ============================================================================
-- 084 — Materialized views for heavy aggregator RPCs
--
-- Problema: las RPCs mensuales (get_flujo_fondos, get_ingresos_mensual, etc)
-- agregan tablas de 100k+ filas en cada llamada. Cada request tarda 5-25 s.
--
-- Solución: materializar el resultado de cada RPC en un MV, y reescribir la
-- RPC como SELECT * del MV. El refresh se dispara al final del ETL, cuando
-- la data subyacente cambia.
--
-- 11 MVs creadas. Todas con índice UNIQUE que habilita
-- REFRESH MATERIALIZED VIEW CONCURRENTLY (lock-free para readers).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. flujo_fondos  (25s → <50ms)
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_flujo_fondos CASCADE;
CREATE MATERIALIZED VIEW mv_flujo_fondos AS
WITH meses AS (
  SELECT DISTINCT sub.p FROM (
    SELECT TO_CHAR(fecha, 'YYYY-MM') AS p FROM movimiento_caja
    UNION SELECT TO_CHAR(fecha, 'YYYY-MM') FROM movimiento_bancario
    UNION SELECT TO_CHAR(fecha, 'YYYY-MM') FROM movimiento_mp
  ) sub
  WHERE sub.p >= '2024-01'
),
banco_deb_clasificado AS (
  SELECT
    TO_CHAR(fecha, 'YYYY-MM') AS p,
    banco,
    COALESCE(debito, 0) AS monto,
    CASE
      -- TRANSFERENCIAS
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%inviu%' THEN 'transferencias'
      WHEN COALESCE(concepto, '') LIKE 'BIP DB TRANSFERENCIA%' THEN 'transferencias'
      WHEN UPPER(COALESCE(concepto, '')) LIKE '%N:NADAL Y ZACCAR%' THEN 'transferencias'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%interbank%nadal y zaccaro%' THEN 'transferencias'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%nadal y zaccaro%' AND COALESCE(concepto, '') LIKE '%30657033770%' THEN 'transferencias'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%mercado pago%' THEN 'transferencias'
      -- RETIROS SOCIOS
      WHEN COALESCE(concepto, '') = 'DEBITO EN CUENTA' THEN 'retiros_socios'
      WHEN UPPER(COALESCE(concepto, '')) LIKE '%CHEQUE POR VENTANILLA%' THEN 'retiros_socios'
      WHEN COALESCE(concepto, '') LIKE 'DEBITO TRANS.CAJERO AUT%' THEN 'retiros_socios'
      WHEN UPPER(COALESCE(concepto, '')) LIKE '%N:NADAL ANDREA%' THEN 'retiros_socios'
      WHEN UPPER(COALESCE(concepto, '')) LIKE '%N:ZACCARO FABIAN%' THEN 'retiros_socios'
      -- SUELDOS
      WHEN COALESCE(concepto, '') LIKE 'DEB LOTE ZACCARO FABIAN%' THEN 'sueldos'
      WHEN COALESCE(concepto, '') LIKE 'DEB LOTE HABERES%' THEN 'sueldos'
      WHEN COALESCE(concepto, '') LIKE 'DEBITO POR PAGO DE HABERES%' THEN 'sueldos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%haber%' THEN 'sueldos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%sueldo%' THEN 'sueldos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%remuner%' THEN 'sueldos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%aguinaldo%' THEN 'sueldos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%vacacion%' THEN 'sueldos'
      -- IMPUESTOS
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%retencion arba%' THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%retencion iibb%' THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%arba%' THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%p.serv%ente950%' THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%p.serv%ente270%' THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%p.serv%municipali%' THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%pago servicio por atm%' THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%pago serv%' THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%afip%' THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%iibb%' THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%ganancias%' THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%monotributo%' THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%municipalidad%' THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%seguridad e higiene%' THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%ley 25413%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%ley 25.413%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%25413%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%25.413%' THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%f.931%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%f931%' THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%sicoss%' THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%impuesto s/deb%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%impuesto s/cred%' THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%contribucion%patronal%' THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%aporte%jubilat%' THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%obra social%' THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%sindicato%' THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%i.brutos%percepcion%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%iibb%percepcion%' THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%iva percepcion%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%iva%rg 2408%' THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE 'impuesto i.brutos%' THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE 'iva 21%%' THEN 'impuestos'
      -- TARJETAS
      WHEN LOWER(COALESCE(concepto, '')) LIKE 'pago visa%' THEN 'tarjetas'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%pago liquidacion visa%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%liquidacion visa%' THEN 'tarjetas'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%pago tarjeta de credito visa%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%pago de tarjeta de credito visa%' THEN 'tarjetas'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%pago mastercard%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%pago liquidacion mastercard%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%liquidacion mastercard%' THEN 'tarjetas'
      -- GASTOS FINANCIEROS
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%amortizacion%prestamo%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%cuota prestamo%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%cuota de prestamo%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%pago cuota de prestamo%' THEN 'gastos_financieros'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%comision%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%comis.gestion cheque%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%com. mant.%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%com mant%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%com.movim mensuales clearing%' THEN 'gastos_financieros'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%interes%' THEN 'gastos_financieros'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%mantenimiento%' THEN 'gastos_financieros'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%seguro%' THEN 'gastos_financieros'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%sellado%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%impuesto de sellos%' THEN 'gastos_financieros'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%cargo a comercios visa%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%cargo a comercios mastercard%' THEN 'gastos_financieros'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%debito arreglo - visa%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%debito arreglo - mastercard%' THEN 'gastos_financieros'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%contracargo a comercio%' THEN 'gastos_financieros'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%arancel%' THEN 'gastos_financieros'
      ELSE 'proveedores'
    END AS categoria
  FROM movimiento_bancario
  WHERE COALESCE(debito, 0) > 0 AND fecha >= '2024-01-01'
),
netting AS (
  SELECT TO_CHAR(fecha, 'YYYY-MM') AS p,
    CASE
      WHEN UPPER(COALESCE(concepto, '')) = 'REVERSA RETENCION ARBA' THEN 'impuestos'
      WHEN UPPER(COALESCE(concepto, '')) LIKE 'REV.%IMP.%LEY 25413%' THEN 'impuestos'
      WHEN UPPER(COALESCE(concepto, '')) = 'DEVOLUCION PAGO CH/OE' THEN 'proveedores'
    END AS categoria_netting,
    COALESCE(credito, 0) AS monto
  FROM movimiento_bancario
  WHERE COALESCE(credito, 0) > 0 AND fecha >= '2024-01-01'
    AND (
      UPPER(COALESCE(concepto, '')) = 'REVERSA RETENCION ARBA'
      OR UPPER(COALESCE(concepto, '')) LIKE 'REV.%IMP.%LEY 25413%'
      OR UPPER(COALESCE(concepto, '')) = 'DEVOLUCION PAGO CH/OE'
    )
),
netting_agg AS (
  SELECT p,
    SUM(CASE WHEN categoria_netting = 'impuestos' THEN monto ELSE 0 END) AS netting_impuestos,
    SUM(CASE WHEN categoria_netting = 'proveedores' THEN monto ELSE 0 END) AS netting_proveedores
  FROM netting GROUP BY p
),
banco_agg AS (
  SELECT p,
    SUM(CASE WHEN categoria = 'proveedores' THEN monto ELSE 0 END) AS proveedores,
    SUM(CASE WHEN categoria = 'sueldos' THEN monto ELSE 0 END) AS sueldos,
    SUM(CASE WHEN categoria = 'impuestos' THEN monto ELSE 0 END) AS impuestos,
    SUM(CASE WHEN categoria = 'gastos_financieros' THEN monto ELSE 0 END) AS financieros,
    SUM(CASE WHEN categoria = 'tarjetas' THEN monto ELSE 0 END) AS tarjetas,
    SUM(CASE WHEN categoria = 'retiros_socios' THEN monto ELSE 0 END) AS retiros,
    SUM(CASE WHEN categoria = 'transferencias' THEN monto ELSE 0 END) AS transferencias_out,
    SUM(CASE WHEN banco = 'provincia' AND categoria NOT IN ('retiros_socios', 'transferencias') THEN monto ELSE 0 END) AS total_provincia,
    SUM(CASE WHEN banco = 'santander' AND categoria NOT IN ('retiros_socios', 'transferencias') THEN monto ELSE 0 END) AS total_santander
  FROM banco_deb_clasificado GROUP BY p
),
caja AS (
  SELECT TO_CHAR(fecha, 'YYYY-MM') AS p, SUM(COALESCE(importe, 0)) AS efectivo
  FROM movimiento_caja
  WHERE condicion_pago = 'EFECTIVO' AND tipo = 'Venta Contado' AND fecha >= '2024-01-01'
  GROUP BY 1
),
banco_cred AS (
  SELECT TO_CHAR(fecha, 'YYYY-MM') AS p, banco, SUM(COALESCE(credito, 0)) AS cobros
  FROM movimiento_bancario
  WHERE COALESCE(credito, 0) > 0 AND fecha >= '2024-01-01'
    AND LOWER(COALESCE(concepto, '')) NOT LIKE '%deposito por caja%'
    AND LOWER(COALESCE(concepto, '')) NOT LIKE '%deposito de efectivo%'
    AND LOWER(COALESCE(concepto, '')) NOT LIKE '%credito traspaso cajero%'
    AND LOWER(COALESCE(concepto, '')) NOT LIKE 'dep efvo%'
    AND LOWER(COALESCE(concepto, '')) NOT LIKE '%deposito cheque%'
    AND LOWER(COALESCE(concepto, '')) NOT LIKE '%deposito ch/oe%'
    AND LOWER(COALESCE(concepto, '')) NOT LIKE '%mercado pago%'
    AND COALESCE(concepto, '') NOT LIKE '%30657033770%'
    AND COALESCE(concepto, '') NOT LIKE '%N:NADAL Y ZACCAR%'
    AND LOWER(COALESCE(concepto, '')) NOT LIKE '%inviu%'
    AND LOWER(COALESCE(concepto, '')) NOT LIKE '%acreditacion%prestamo%'
    AND UPPER(COALESCE(concepto, '')) <> 'REVERSA RETENCION ARBA'
    AND UPPER(COALESCE(concepto, '')) NOT LIKE 'REV.%IMP.%LEY 25413%'
    AND UPPER(COALESCE(concepto, '')) <> 'DEVOLUCION PAGO CH/OE'
  GROUP BY 1, 2
),
banco_cred_prov AS (SELECT p, cobros FROM banco_cred WHERE banco = 'provincia'),
banco_cred_sant AS (SELECT p, cobros FROM banco_cred WHERE banco = 'santander'),
financiamiento_banco AS (
  SELECT TO_CHAR(fecha, 'YYYY-MM') AS p, SUM(COALESCE(credito, 0)) AS monto
  FROM movimiento_bancario
  WHERE COALESCE(credito, 0) > 0 AND fecha >= '2024-01-01'
    AND LOWER(COALESCE(concepto, '')) LIKE '%acreditacion%prestamo%'
  GROUP BY 1
),
financiamiento_mp AS (
  SELECT TO_CHAR(fecha, 'YYYY-MM') AS p, SUM(COALESCE(importe, 0)) AS monto
  FROM movimiento_mp
  WHERE COALESCE(importe, 0) > 0 AND fecha >= '2024-01-01'
    AND tipo_operacion ILIKE '%Préstamo acreditado%'
  GROUP BY 1
),
mp_ing AS (
  SELECT TO_CHAR(fecha, 'YYYY-MM') AS p, SUM(COALESCE(importe, 0)) AS ing
  FROM movimiento_mp
  WHERE COALESCE(importe, 0) > 0 AND fecha >= '2024-01-01'
    AND NOT (
      COALESCE(tipo_operacion, '') ILIKE '%Transferencia%'
      AND (LOWER(COALESCE(tipo_operacion, '')) LIKE '%nadal y zaccaro%'
           OR COALESCE(tipo_operacion, '') LIKE '%30657033770%')
    )
    AND COALESCE(tipo_operacion, '') NOT ILIKE '%Préstamo acreditado%'
  GROUP BY 1
),
mp_egresos AS (
  SELECT TO_CHAR(fecha, 'YYYY-MM') AS p,
    CASE
      WHEN tipo_operacion ILIKE '%Retiro de dinero%' THEN 'transferencias'
      WHEN tipo_operacion ILIKE '%Transferencia%'
        AND (LOWER(COALESCE(tipo_operacion, '')) LIKE '%nadal y zaccaro%'
             OR tipo_operacion LIKE '%30657033770%') THEN 'transferencias'
      WHEN tipo_operacion IN ('Pago', 'Movimiento General') THEN 'proveedores'
      WHEN tipo_operacion ILIKE '%Transferencia%'
        AND NOT (LOWER(COALESCE(tipo_operacion, '')) LIKE '%nadal y zaccaro%'
                 OR tipo_operacion LIKE '%30657033770%') THEN 'proveedores'
      WHEN tipo_operacion ILIKE '%Créditos y Débitos%'
        OR LOWER(tipo_operacion) LIKE '%retencion%'
        OR LOWER(tipo_operacion) LIKE '%retención%'
        OR LOWER(tipo_operacion) LIKE '%ingresos brutos%'
        OR LOWER(tipo_operacion) LIKE '%iibb%'
        OR LOWER(tipo_operacion) LIKE '%iva%'
        OR LOWER(tipo_operacion) LIKE '%ganancias%'
        OR LOWER(tipo_operacion) LIKE '%impuesto%' THEN 'impuestos'
      WHEN tipo_operacion ILIKE '%Costo de Mercado Pago%'
        OR tipo_operacion ILIKE '%Costo por adelanto%' THEN 'gastos_financieros'
      ELSE 'proveedores'
    END AS categoria,
    ABS(COALESCE(importe, 0)) AS monto
  FROM movimiento_mp
  WHERE COALESCE(importe, 0) < 0 AND fecha >= '2024-01-01'
    AND tipo_operacion NOT ILIKE '%Anulación%'
),
mp_agg AS (
  SELECT p,
    SUM(CASE WHEN categoria = 'proveedores' THEN monto ELSE 0 END) AS proveedores,
    SUM(CASE WHEN categoria = 'impuestos' THEN monto ELSE 0 END) AS impuestos,
    SUM(CASE WHEN categoria = 'gastos_financieros' THEN monto ELSE 0 END) AS financieros,
    SUM(CASE WHEN categoria = 'transferencias' THEN monto ELSE 0 END) AS transferencias_out
  FROM mp_egresos GROUP BY p
)
SELECT
  m.p AS periodo,
  COALESCE(c.efectivo, 0) AS cobros_efectivo,
  COALESCE(bcp.cobros, 0) + COALESCE(bcs.cobros, 0) AS cobros_banco,
  COALESCE(bcp.cobros, 0) AS cobros_banco_provincia,
  COALESCE(bcs.cobros, 0) AS cobros_banco_santander,
  COALESCE(mi.ing, 0) AS cobros_mp,
  GREATEST(COALESCE(ba.proveedores, 0) + COALESCE(mp.proveedores, 0) - COALESCE(net.netting_proveedores, 0), 0) AS pagos_proveedores,
  COALESCE(ba.sueldos, 0) AS pagos_sueldos,
  GREATEST(COALESCE(ba.impuestos, 0) + COALESCE(mp.impuestos, 0) - COALESCE(net.netting_impuestos, 0), 0) AS pagos_impuestos,
  COALESCE(ba.financieros, 0) + COALESCE(mp.financieros, 0) AS pagos_gastos_financieros,
  COALESCE(ba.tarjetas, 0) AS pagos_tarjetas,
  COALESCE(ba.total_provincia, 0) AS pagos_provincia,
  COALESCE(ba.total_santander, 0) AS pagos_santander,
  COALESCE(ba.retiros, 0) AS retiros_socios,
  COALESCE(ba.transferencias_out, 0) + COALESCE(mp.transferencias_out, 0) AS transferencias,
  COALESCE(fb.monto, 0) + COALESCE(fmp.monto, 0) AS financiamiento_recibido
FROM meses m
LEFT JOIN caja c ON c.p = m.p
LEFT JOIN banco_cred_prov bcp ON bcp.p = m.p
LEFT JOIN banco_cred_sant bcs ON bcs.p = m.p
LEFT JOIN banco_agg ba ON ba.p = m.p
LEFT JOIN netting_agg net ON net.p = m.p
LEFT JOIN mp_ing mi ON mi.p = m.p
LEFT JOIN mp_agg mp ON mp.p = m.p
LEFT JOIN financiamiento_banco fb ON fb.p = m.p
LEFT JOIN financiamiento_mp fmp ON fmp.p = m.p;

CREATE UNIQUE INDEX idx_mv_flujo_fondos_periodo ON mv_flujo_fondos(periodo);

CREATE OR REPLACE FUNCTION public.get_flujo_fondos()
RETURNS TABLE(periodo text, cobros_efectivo numeric, cobros_banco numeric, cobros_banco_provincia numeric, cobros_banco_santander numeric, cobros_mp numeric, pagos_proveedores numeric, pagos_sueldos numeric, pagos_impuestos numeric, pagos_gastos_financieros numeric, pagos_tarjetas numeric, pagos_provincia numeric, pagos_santander numeric, retiros_socios numeric, transferencias numeric, financiamiento_recibido numeric)
LANGUAGE sql STABLE AS
$$ SELECT * FROM mv_flujo_fondos ORDER BY periodo $$;

-- ---------------------------------------------------------------------------
-- 2. ingresos_mensual  (18s → <50ms)
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_ingresos_mensual CASCADE;
CREATE MATERIALIZED VIEW mv_ingresos_mensual AS
WITH pos AS (
  SELECT TO_CHAR(v.fecha, 'YYYY-MM') AS periodo,
    SUM(CASE WHEN LOWER(vd.producto) != 'restobar' THEN vd.neto ELSE 0 END) AS mostrador,
    SUM(CASE WHEN LOWER(vd.producto) = 'restobar' THEN vd.neto ELSE 0 END) AS restobar
  FROM venta v
  JOIN venta_detalle vd ON vd.venta_id = v.id
  WHERE NOT COALESCE(vd.excluir_analisis, false)
  GROUP BY 1
),
serv AS (
  SELECT TO_CHAR(fecha_emision, 'YYYY-MM') AS periodo,
    SUM(CASE WHEN tipo_comprobante IN (3,8,203) THEN -imp_neto_gravado_total ELSE imp_neto_gravado_total END) AS servicios
  FROM factura_emitida
  WHERE punto_venta = 6
  GROUP BY 1
)
SELECT
  COALESCE(p.periodo, s.periodo) AS periodo,
  COALESCE(p.mostrador, 0) AS mostrador,
  COALESCE(p.restobar, 0) AS restobar,
  COALESCE(s.servicios, 0) AS servicios
FROM pos p
FULL OUTER JOIN serv s ON p.periodo = s.periodo;

CREATE UNIQUE INDEX idx_mv_ingresos_mensual_periodo ON mv_ingresos_mensual(periodo);

CREATE OR REPLACE FUNCTION public.get_ingresos_mensual()
RETURNS TABLE(periodo text, mostrador numeric, restobar numeric, servicios numeric)
LANGUAGE sql STABLE AS
$$ SELECT * FROM mv_ingresos_mensual ORDER BY periodo $$;

-- ---------------------------------------------------------------------------
-- 3. cheque_mensual  (12s → <50ms)
--    Original RPC: UNION ALL (2 filas/periodo). MV combina en una.
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_cheque_mensual CASCADE;
CREATE MATERIALIZED VIEW mv_cheque_mensual AS
SELECT periodo, SUM(importe_cheque) AS importe_cheque
FROM (
  SELECT TO_CHAR(fecha, 'YYYY-MM') AS periodo, SUM(ABS(importe)) AS importe_cheque
  FROM movimiento_bancario
  WHERE (concepto ILIKE '%25413%' OR concepto ILIKE '%25.413%')
    AND concepto NOT ILIKE '%COMPENSACION%'
  GROUP BY 1
  UNION ALL
  SELECT TO_CHAR(fecha, 'YYYY-MM') AS periodo, SUM(ABS(importe)) AS importe_cheque
  FROM movimiento_mp
  WHERE tipo_operacion ILIKE '%Créditos y Débitos%'
    AND tipo_operacion NOT ILIKE '%Anulación%'
  GROUP BY 1
) sub
GROUP BY periodo;

CREATE UNIQUE INDEX idx_mv_cheque_mensual_periodo ON mv_cheque_mensual(periodo);

CREATE OR REPLACE FUNCTION public.get_cheque_mensual()
RETURNS TABLE(periodo text, importe_cheque numeric)
LANGUAGE sql STABLE AS
$$ SELECT periodo, importe_cheque FROM mv_cheque_mensual ORDER BY periodo $$;

-- ---------------------------------------------------------------------------
-- 4. egresos_mensual
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_egresos_mensual CASCADE;
CREATE MATERIALIZED VIEW mv_egresos_mensual AS
WITH
sueldos_raw AS (
  SELECT
    CASE
      WHEN periodo LIKE '%-SAC' THEN
        CASE WHEN fecha_transferencia IS NOT NULL
             THEN TO_CHAR(fecha_transferencia, 'YYYY-MM')
             ELSE LEFT(periodo, 7) END
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
  SELECT p, SUM(costo) AS costo, SUM(neto) AS neto FROM sueldos_raw GROUP BY 1
),
prov AS (
  SELECT TO_CHAR(fecha_emision, 'YYYY-MM') AS p,
    SUM(CASE WHEN tipo_comprobante IN (3,8,203)
             THEN -(COALESCE(imp_neto_gravado_total, 0) + COALESCE(imp_neto_no_gravado, 0) + COALESCE(imp_op_exentas, 0))
             ELSE   COALESCE(imp_neto_gravado_total, 0) + COALESCE(imp_neto_no_gravado, 0) + COALESCE(imp_op_exentas, 0) END) AS total
  FROM factura_recibida GROUP BY 1
),
imp_raw AS (
  SELECT pi.monto, pi.formulario, io.tipo,
    SUBSTRING(pi.observaciones FROM 'Período: (\d{8})') AS periodo_raw,
    TO_CHAR(pi.fecha_pago, 'YYYY-MM') AS fecha_pago_ym
  FROM pago_impuesto pi
  LEFT JOIN impuesto_obligacion io ON io.id = pi.impuesto_obligacion_id
  WHERE pi.fecha_pago IS NOT NULL
),
imp_parsed AS (
  SELECT monto, formulario, tipo,
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
  SELECT p,
    SUM(CASE WHEN tipo = 'ganancias' THEN 0
             WHEN formulario = '1931' THEN 0
             ELSE COALESCE(monto, 0) END) AS comerciales,
    SUM(CASE WHEN tipo = 'ganancias' THEN COALESCE(monto, 0) ELSE 0 END) AS ganancias,
    SUM(CASE WHEN formulario = '1931' THEN COALESCE(monto, 0) ELSE 0 END) AS cargas_sociales
  FROM imp_parsed GROUP BY 1
),
fin AS (
  SELECT TO_CHAR(fecha, 'YYYY-MM') AS p, SUM(COALESCE(debito, 0)) AS total
  FROM movimiento_bancario
  WHERE COALESCE(debito, 0) > 0
    AND LOWER(COALESCE(concepto, '')) LIKE ANY(ARRAY[
      '%comision%', '%interes%', '%impuesto s/deb%',
      '%impuesto s/cred%', '%mantenimiento%', '%seguro%', '%sellado%'
    ])
  GROUP BY 1
),
all_p AS (
  SELECT p FROM sue UNION SELECT p FROM prov UNION SELECT p FROM imp UNION SELECT p FROM fin
)
SELECT
  ap.p AS periodo,
  COALESCE(s.costo, 0) AS sueldos_costo,
  COALESCE(s.neto, 0) AS sueldos_neto,
  COALESCE(pr.total, 0) AS proveedores,
  COALESCE(i.comerciales, 0) AS impuestos_comerciales,
  COALESCE(i.ganancias, 0) AS ganancias,
  COALESCE(f.total, 0) AS financieros,
  COALESCE(i.cargas_sociales, 0) AS cargas_sociales
FROM all_p ap
LEFT JOIN sue s ON s.p = ap.p
LEFT JOIN prov pr ON pr.p = ap.p
LEFT JOIN imp i ON i.p = ap.p
LEFT JOIN fin f ON f.p = ap.p;

CREATE UNIQUE INDEX idx_mv_egresos_mensual_periodo ON mv_egresos_mensual(periodo);

CREATE OR REPLACE FUNCTION public.get_egresos_mensual()
RETURNS TABLE(periodo text, sueldos_costo numeric, sueldos_neto numeric, proveedores numeric, impuestos_comerciales numeric, ganancias numeric, financieros numeric, cargas_sociales numeric)
LANGUAGE sql STABLE AS
$$ SELECT * FROM mv_egresos_mensual ORDER BY periodo $$;

-- ---------------------------------------------------------------------------
-- 5. financieros_desglosado
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_financieros_desglosado CASCADE;
CREATE MATERIALIZED VIEW mv_financieros_desglosado AS
WITH banco AS (
  SELECT TO_CHAR(fecha, 'YYYY-MM') AS periodo,
    SUM(CASE WHEN LOWER(COALESCE(concepto, '')) LIKE '%interes%' THEN COALESCE(debito, 0) ELSE 0 END) AS intereses,
    SUM(CASE WHEN LOWER(COALESCE(concepto, '')) LIKE '%seguro%'
              AND LOWER(COALESCE(concepto, '')) NOT LIKE '%interes%'
             THEN COALESCE(debito, 0) ELSE 0 END) AS seguros,
    SUM(CASE
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%interes%' THEN 0
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%seguro%' THEN 0
      WHEN LOWER(COALESCE(concepto, '')) LIKE ANY(ARRAY['%comision%', '%mantenimiento%', '%sellado%'])
        THEN COALESCE(debito, 0)
      ELSE 0
    END) AS comisiones_bancarias,
    SUM(CASE
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%interes%' THEN 0
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%seguro%' THEN 0
      WHEN LOWER(COALESCE(concepto, '')) LIKE ANY(ARRAY['%comision%', '%mantenimiento%', '%sellado%']) THEN 0
      ELSE COALESCE(debito, 0)
    END) AS otros
  FROM movimiento_bancario
  WHERE COALESCE(debito, 0) > 0
    AND LOWER(COALESCE(concepto, '')) LIKE ANY(ARRAY[
      '%comision%', '%interes%', '%mantenimiento%', '%seguro%', '%sellado%'
    ])
    AND COALESCE(concepto, '') NOT ILIKE '%25413%'
    AND COALESCE(concepto, '') NOT ILIKE '%25.413%'
    AND LOWER(COALESCE(concepto, '')) NOT LIKE '%impuesto s/deb%'
    AND LOWER(COALESCE(concepto, '')) NOT LIKE '%impuesto s/cred%'
  GROUP BY 1
),
mp AS (
  SELECT TO_CHAR(fecha, 'YYYY-MM') AS periodo, SUM(ABS(COALESCE(importe, 0))) AS comisiones_mp
  FROM movimiento_mp
  WHERE COALESCE(importe, 0) < 0
    AND COALESCE(tipo_operacion, '') NOT ILIKE '%Retiro de dinero%'
    AND COALESCE(tipo_operacion, '') NOT IN ('Pago', 'Movimiento General')
    AND COALESCE(tipo_operacion, '') NOT ILIKE '%Créditos y Débitos%'
    AND COALESCE(tipo_operacion, '') NOT ILIKE '%Anulación%'
  GROUP BY 1
)
SELECT
  COALESCE(b.periodo, m.periodo) AS periodo,
  COALESCE(b.comisiones_bancarias, 0) AS comisiones_bancarias,
  COALESCE(b.intereses, 0) AS intereses,
  COALESCE(b.seguros, 0) AS seguros,
  COALESCE(m.comisiones_mp, 0) AS comisiones_mp,
  COALESCE(b.otros, 0) AS otros
FROM banco b
FULL OUTER JOIN mp m ON b.periodo = m.periodo;

CREATE UNIQUE INDEX idx_mv_financieros_desglosado_periodo ON mv_financieros_desglosado(periodo);

CREATE OR REPLACE FUNCTION public.get_financieros_desglosado()
RETURNS TABLE(periodo text, comisiones_bancarias numeric, intereses numeric, seguros numeric, comisiones_mp numeric, otros numeric)
LANGUAGE sql STABLE AS
$$ SELECT * FROM mv_financieros_desglosado ORDER BY periodo $$;

-- ---------------------------------------------------------------------------
-- 6. mostrador_mensual
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_mostrador_mensual CASCADE;
CREATE MATERIALIZED VIEW mv_mostrador_mensual AS
SELECT
  TO_CHAR(v.fecha, 'YYYY-MM') AS periodo,
  SUM(COALESCE(vd.neto, 0)) AS monto,
  SUM(COALESCE(vd.cantidad, 0)) AS cantidad,
  COUNT(DISTINCT v.id) AS tx_count,
  COUNT(DISTINCT v.fecha::date) AS dias_con_venta
FROM venta v
JOIN venta_detalle vd ON vd.venta_id = v.id
WHERE LOWER(COALESCE(vd.producto, '')) != 'restobar'
  AND NOT COALESCE(vd.excluir_analisis, false)
GROUP BY 1;

CREATE UNIQUE INDEX idx_mv_mostrador_mensual_periodo ON mv_mostrador_mensual(periodo);

CREATE OR REPLACE FUNCTION public.get_mostrador_mensual()
RETURNS TABLE(periodo text, monto numeric, cantidad numeric, tx_count bigint, dias_con_venta bigint)
LANGUAGE sql STABLE AS
$$ SELECT * FROM mv_mostrador_mensual ORDER BY periodo $$;

-- ---------------------------------------------------------------------------
-- 7. restobar_mensual
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_restobar_mensual CASCADE;
CREATE MATERIALIZED VIEW mv_restobar_mensual AS
SELECT
  TO_CHAR(v.fecha, 'YYYY-MM') AS periodo,
  SUM(COALESCE(vd.neto, 0)) AS monto,
  SUM(COALESCE(vd.cantidad, 0)) AS cantidad,
  COUNT(DISTINCT v.id) AS tx_count,
  COUNT(DISTINCT v.fecha::date) AS dias_con_venta
FROM venta v
JOIN venta_detalle vd ON vd.venta_id = v.id
WHERE LOWER(COALESCE(vd.producto, '')) = 'restobar'
  AND NOT COALESCE(vd.excluir_analisis, false)
GROUP BY 1;

CREATE UNIQUE INDEX idx_mv_restobar_mensual_periodo ON mv_restobar_mensual(periodo);

CREATE OR REPLACE FUNCTION public.get_restobar_mensual()
RETURNS TABLE(periodo text, monto numeric, cantidad numeric, tx_count bigint, dias_con_venta bigint)
LANGUAGE sql STABLE AS
$$ SELECT * FROM mv_restobar_mensual ORDER BY periodo $$;

-- ---------------------------------------------------------------------------
-- 8. servicios_mensual
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_servicios_mensual CASCADE;
CREATE MATERIALIZED VIEW mv_servicios_mensual AS
SELECT
  TO_CHAR(fe.fecha_emision, 'YYYY-MM') AS periodo,
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
  COUNT(*) AS tx_count
FROM factura_emitida fe
LEFT JOIN cliente c ON c.cuit = fe.nro_doc_receptor
WHERE fe.punto_venta = 6
GROUP BY 1;

CREATE UNIQUE INDEX idx_mv_servicios_mensual_periodo ON mv_servicios_mensual(periodo);

CREATE OR REPLACE FUNCTION public.get_servicios_mensual()
RETURNS TABLE(periodo text, publico numeric, privado numeric, total numeric, tx_count bigint)
LANGUAGE sql STABLE AS
$$ SELECT * FROM mv_servicios_mensual ORDER BY periodo $$;

-- ---------------------------------------------------------------------------
-- 9. servicios_tipo_mensual
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_servicios_tipo_mensual CASCADE;
CREATE MATERIALIZED VIEW mv_servicios_tipo_mensual AS
WITH importe_por_factura AS (
  SELECT fed.factura_id, SUM(fed.importe) AS sum_importe
  FROM factura_emitida_detalle fed
  GROUP BY 1
),
detalle_alloc AS (
  SELECT
    TO_CHAR(fe.fecha_emision, 'YYYY-MM') AS periodo,
    COALESCE(fed.tipo_servicio, 'otros') AS tipo_servicio,
    COALESCE(fed.cantidad, 0) AS cantidad,
    CASE
      WHEN COALESCE(ipf.sum_importe, 0) > 0
      THEN COALESCE(fed.importe, 0) * COALESCE(fe.imp_neto_gravado_total, 0) / ipf.sum_importe
      ELSE 0
    END AS monto_neto,
    CASE WHEN fe.tipo_comprobante IN (3, 8, 203) THEN -1 ELSE 1 END AS signo
  FROM factura_emitida fe
  JOIN factura_emitida_detalle fed ON fed.factura_id = fe.id
  LEFT JOIN importe_por_factura ipf ON ipf.factura_id = fe.id
  WHERE fe.punto_venta = 6
)
SELECT
  periodo,
  tipo_servicio,
  SUM(signo * monto_neto) AS monto_neto,
  SUM(signo * cantidad) AS cantidad,
  COUNT(*) AS lineas
FROM detalle_alloc
GROUP BY 1, 2;

CREATE UNIQUE INDEX idx_mv_servicios_tipo_mensual_key ON mv_servicios_tipo_mensual(periodo, tipo_servicio);

CREATE OR REPLACE FUNCTION public.get_servicios_tipo_mensual()
RETURNS TABLE(periodo text, tipo_servicio text, monto_neto numeric, cantidad numeric, lineas bigint)
LANGUAGE sql STABLE AS
$$ SELECT * FROM mv_servicios_tipo_mensual ORDER BY periodo, tipo_servicio $$;

-- ---------------------------------------------------------------------------
-- 10. iva_ingresos_mensual
--     Originalmente emitía 2 filas/periodo (una por factura_emitida, otra por
--     factura_recibida). Mantenemos ese shape con columna 'fuente' para
--     unique index.
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_iva_ingresos_mensual CASCADE;
CREATE MATERIALIZED VIEW mv_iva_ingresos_mensual AS
SELECT
  TO_CHAR(fecha_emision, 'YYYY-MM') AS periodo,
  'emitida' AS fuente,
  SUM(CASE WHEN tipo_comprobante IN (3,8,203) THEN -total_iva ELSE total_iva END) AS iva_debito,
  0::numeric AS iva_credito,
  SUM(CASE WHEN tipo_comprobante IN (3,8,203) THEN -imp_total ELSE imp_total END) AS ingresos
FROM factura_emitida GROUP BY 1
UNION ALL
SELECT
  TO_CHAR(fecha_emision, 'YYYY-MM') AS periodo,
  'recibida' AS fuente,
  0::numeric AS iva_debito,
  SUM(CASE WHEN tipo_comprobante IN (3,8,203) THEN -total_iva ELSE total_iva END) AS iva_credito,
  0::numeric AS ingresos
FROM factura_recibida GROUP BY 1;

CREATE UNIQUE INDEX idx_mv_iva_ingresos_mensual_key ON mv_iva_ingresos_mensual(periodo, fuente);

CREATE OR REPLACE FUNCTION public.get_iva_ingresos_mensual()
RETURNS TABLE(periodo text, iva_debito numeric, iva_credito numeric, ingresos numeric)
LANGUAGE sql STABLE AS
$$ SELECT periodo, iva_debito, iva_credito, ingresos FROM mv_iva_ingresos_mensual ORDER BY periodo, fuente $$;

-- ---------------------------------------------------------------------------
-- 11. posicion_iva_mensual
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_posicion_iva_mensual CASCADE;
CREATE MATERIALIZED VIEW mv_posicion_iva_mensual AS
SELECT
  TO_CHAR(fecha_emision, 'YYYY-MM') AS periodo,
  'debito' AS tipo,
  SUM(CASE WHEN tipo_comprobante IN (3,8,203) THEN -iva_21 ELSE iva_21 END) AS iva_21,
  SUM(CASE WHEN tipo_comprobante IN (3,8,203) THEN -iva_10_5 ELSE iva_10_5 END) AS iva_10_5,
  SUM(CASE WHEN tipo_comprobante IN (3,8,203) THEN -iva_27 ELSE iva_27 END) AS iva_27,
  SUM(CASE WHEN tipo_comprobante IN (3,8,203) THEN -iva_5 ELSE iva_5 END) AS iva_5,
  SUM(CASE WHEN tipo_comprobante IN (3,8,203) THEN -iva_2_5 ELSE iva_2_5 END) AS iva_2_5,
  SUM(CASE WHEN tipo_comprobante IN (3,8,203) THEN -total_iva ELSE total_iva END) AS total_iva,
  0::numeric AS otros_tributos
FROM factura_emitida GROUP BY 1
UNION ALL
SELECT
  TO_CHAR(fecha_emision, 'YYYY-MM') AS periodo,
  'credito' AS tipo,
  SUM(CASE WHEN tipo_comprobante IN (3,8,203) THEN -iva_21 ELSE iva_21 END) AS iva_21,
  SUM(CASE WHEN tipo_comprobante IN (3,8,203) THEN -iva_10_5 ELSE iva_10_5 END) AS iva_10_5,
  SUM(CASE WHEN tipo_comprobante IN (3,8,203) THEN -iva_27 ELSE iva_27 END) AS iva_27,
  SUM(CASE WHEN tipo_comprobante IN (3,8,203) THEN -iva_5 ELSE iva_5 END) AS iva_5,
  SUM(CASE WHEN tipo_comprobante IN (3,8,203) THEN -iva_2_5 ELSE iva_2_5 END) AS iva_2_5,
  SUM(CASE WHEN tipo_comprobante IN (3,8,203) THEN -total_iva ELSE total_iva END) AS total_iva,
  SUM(CASE WHEN tipo_comprobante IN (3,8,203) THEN -COALESCE(otros_tributos, 0) ELSE COALESCE(otros_tributos, 0) END) AS otros_tributos
FROM factura_recibida GROUP BY 1;

CREATE UNIQUE INDEX idx_mv_posicion_iva_mensual_key ON mv_posicion_iva_mensual(periodo, tipo);

CREATE OR REPLACE FUNCTION public.get_posicion_iva_mensual()
RETURNS TABLE(periodo text, tipo text, iva_21 numeric, iva_10_5 numeric, iva_27 numeric, iva_5 numeric, iva_2_5 numeric, total_iva numeric, otros_tributos numeric)
LANGUAGE sql STABLE AS
$$ SELECT * FROM mv_posicion_iva_mensual ORDER BY periodo, tipo $$;

-- ---------------------------------------------------------------------------
-- refresh_aggregate_mvs() — refresca todas las MVs en orden.
-- Llamada al final del ETL (etl/main.py).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_aggregate_mvs()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_flujo_fondos;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_ingresos_mensual;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_cheque_mensual;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_egresos_mensual;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_financieros_desglosado;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_mostrador_mensual;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_restobar_mensual;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_servicios_mensual;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_servicios_tipo_mensual;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_iva_ingresos_mensual;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_posicion_iva_mensual;
END;
$$;

-- Permitir ejecución desde el cliente anon/authenticated (necesario para ETL).
GRANT EXECUTE ON FUNCTION public.refresh_aggregate_mvs() TO anon, authenticated, service_role;

COMMIT;
