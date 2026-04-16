-- =============================================================================
-- 063_add_tarjetas_category.sql
-- Nueva categoría "tarjetas" separada de gastos_financieros
-- =============================================================================
--
-- Decisiones del negocio:
--   - Tarjetas = pago de resumen de tarjeta de crédito (VISA/MC)
--   - Contablemente es GASTO OPERATIVO (no gasto financiero)
--   - Distinto de CARGO A COMERCIOS (costo por aceptar tarjetas como comercio)
--
-- Patrones → tarjetas:
--   - PAGO LIQUIDACION VISA ($60.6M)
--   - PAGO VISA ($26.7M)
--   - Pago tarjeta de credito visa ($50M, Santander)
--   - Pago de tarjeta de credito visa ($25M, Santander — NO matcheaba en 061)
--   - PAGO MASTERCARD / PAGO LIQUIDACION MASTERCARD (sin datos hoy, por futuro)
--
-- Patrones que PERMANECEN en gastos_financieros:
--   - CARGO A COMERCIOS VISA/MASTERCARD (costo por aceptar tarjetas)
--   - DEBITO ARREGLO - VISA/MASTERCARD (ajustes del procesador)
--   - CONTRACARGO A COMERCIO
--
-- Cambios:
--   1. get_flujo_fondos: agrega columna pagos_tarjetas (DROP + CREATE)
--   2. get_flujo_fondos_detalle: agrega categoría 'tarjetas' (CREATE OR REPLACE)
--   3. Fix: Santander "Pago de tarjeta de credito visa" ahora se captura
--      (antes caía en proveedores porque el patrón no matcheaba)
-- =============================================================================


-- =====================================================================
-- PARTE 1: get_flujo_fondos — DROP + CREATE (nuevo tipo de retorno)
-- =====================================================================

DROP FUNCTION IF EXISTS public.get_flujo_fondos();

CREATE OR REPLACE FUNCTION public.get_flujo_fondos()
RETURNS TABLE(
  periodo                  text,
  -- COBROS OPERACIONALES
  cobros_efectivo          numeric,
  cobros_banco             numeric,
  cobros_banco_provincia   numeric,
  cobros_banco_santander   numeric,
  cobros_mp                numeric,
  -- EGRESOS OPERACIONALES
  pagos_proveedores        numeric,
  pagos_sueldos            numeric,
  pagos_impuestos          numeric,
  pagos_gastos_financieros numeric,
  pagos_tarjetas           numeric,  -- 063: nueva columna
  -- POR BANCO (solo egresos operacionales, sin retiros ni transferencias)
  pagos_provincia          numeric,
  pagos_santander          numeric,
  -- NO OPERACIONALES
  retiros_socios           numeric,
  transferencias           numeric,
  -- FINANCIAMIENTO
  financiamiento_recibido  numeric
)
LANGUAGE sql
STABLE
SET statement_timeout TO '30s'
AS $function$

-- ===========================================================================
-- CTE 1: MESES
-- ===========================================================================
WITH meses AS (
  SELECT DISTINCT sub.p FROM (
    SELECT TO_CHAR(fecha, 'YYYY-MM') AS p FROM movimiento_caja
    UNION SELECT TO_CHAR(fecha, 'YYYY-MM') FROM movimiento_bancario
    UNION SELECT TO_CHAR(fecha, 'YYYY-MM') FROM movimiento_mp
  ) sub
  WHERE sub.p >= '2024-01'
),

-- ===========================================================================
-- CTE 2: CLASIFICADOR CENTRAL DE DÉBITOS BANCARIOS
-- 063: Agrega categoría 'tarjetas' ANTES de gastos_financieros
-- ===========================================================================
banco_deb_clasificado AS (
  SELECT
    TO_CHAR(fecha, 'YYYY-MM') AS p,
    banco,
    COALESCE(debito, 0) AS monto,
    CASE
      -- =================================================================
      -- 1. TRANSFERENCIAS ENTRE CUENTAS
      -- =================================================================
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%inviu%'
        THEN 'transferencias'
      WHEN COALESCE(concepto, '') LIKE 'BIP DB TRANSFERENCIA%'
        THEN 'transferencias'
      WHEN UPPER(COALESCE(concepto, '')) LIKE '%N:NADAL Y ZACCAR%'
        THEN 'transferencias'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%interbank%nadal y zaccaro%'
        THEN 'transferencias'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%nadal y zaccaro%'
        AND COALESCE(concepto, '') LIKE '%30657033770%'
        THEN 'transferencias'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%mercado pago%'
        THEN 'transferencias'

      -- =================================================================
      -- 2. RETIROS SOCIOS
      -- =================================================================
      WHEN COALESCE(concepto, '') = 'DEBITO EN CUENTA'
        THEN 'retiros_socios'
      WHEN UPPER(COALESCE(concepto, '')) LIKE '%CHEQUE POR VENTANILLA%'
        THEN 'retiros_socios'
      WHEN COALESCE(concepto, '') LIKE 'DEBITO TRANS.CAJERO AUT%'
        THEN 'retiros_socios'
      WHEN UPPER(COALESCE(concepto, '')) LIKE '%N:NADAL ANDREA%'
        THEN 'retiros_socios'
      WHEN UPPER(COALESCE(concepto, '')) LIKE '%N:ZACCARO FABIAN%'
        THEN 'retiros_socios'

      -- =================================================================
      -- 3. SUELDOS
      -- =================================================================
      WHEN COALESCE(concepto, '') LIKE 'DEB LOTE ZACCARO FABIAN%'
        THEN 'sueldos'
      WHEN COALESCE(concepto, '') LIKE 'DEB LOTE HABERES%'
        THEN 'sueldos'
      WHEN COALESCE(concepto, '') LIKE 'DEBITO POR PAGO DE HABERES%'
        THEN 'sueldos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%haber%'
        THEN 'sueldos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%sueldo%'
        THEN 'sueldos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%remuner%'
        THEN 'sueldos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%aguinaldo%'
        THEN 'sueldos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%vacacion%'
        THEN 'sueldos'

      -- =================================================================
      -- 4. IMPUESTOS
      -- =================================================================
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%retencion arba%'
        THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%retencion iibb%'
        THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%arba%'
        THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%p.serv%ente950%'
        THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%p.serv%ente270%'
        THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%p.serv%municipali%'
        THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%pago servicio por atm%'
        THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%pago serv%'
        THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%afip%'
        THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%iibb%'
        THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%ganancias%'
        THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%monotributo%'
        THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%municipalidad%'
        THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%seguridad e higiene%'
        THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%ley 25413%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%ley 25.413%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%25413%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%25.413%'
        THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%f.931%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%f931%'
        THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%sicoss%'
        THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%impuesto s/deb%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%impuesto s/cred%'
        THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%contribucion%patronal%'
        THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%aporte%jubilat%'
        THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%obra social%'
        THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%sindicato%'
        THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%i.brutos%percepcion%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%iibb%percepcion%'
        THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%iva percepcion%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%iva%rg 2408%'
        THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE 'impuesto i.brutos%'
        THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE 'iva 21%%'
        THEN 'impuestos'

      -- =================================================================
      -- 5. TARJETAS — pago de resumen de tarjeta de crédito
      --    Gasto operativo del dueño. No es costo financiero del negocio.
      --    063: nueva categoría (antes estaba en gastos_financieros)
      -- =================================================================

      -- Provincia: PAGO LIQUIDACION VISA, PAGO VISA
      WHEN LOWER(COALESCE(concepto, '')) LIKE 'pago visa%'
        THEN 'tarjetas'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%pago liquidacion visa%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%liquidacion visa%'
        THEN 'tarjetas'

      -- Santander: Pago tarjeta de credito visa / Pago de tarjeta de credito visa
      -- 063 FIX: "Pago de tarjeta..." no matcheaba en 061 (caía en proveedores)
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%pago tarjeta de credito visa%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%pago de tarjeta de credito visa%'
        THEN 'tarjetas'

      -- Mastercard (sin datos actualmente, por si aparecen)
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%pago mastercard%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%pago liquidacion mastercard%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%liquidacion mastercard%'
        THEN 'tarjetas'

      -- =================================================================
      -- 6. GASTOS FINANCIEROS
      --    Préstamos, comisiones, intereses, seguros, aranceles
      --    063: VISA payment patterns movidos a tarjetas (arriba)
      --    CARGO A COMERCIOS / DEBITO ARREGLO permanecen acá
      -- =================================================================

      -- Préstamos bancarios
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%amortizacion%prestamo%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%cuota prestamo%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%cuota de prestamo%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%pago cuota de prestamo%'
        THEN 'gastos_financieros'

      -- Comisiones bancarias
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%comision%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%comis.gestion cheque%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%com. mant.%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%com mant%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%com.movim mensuales clearing%'
        THEN 'gastos_financieros'

      -- Intereses, mantenimiento, seguros
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%interes%'
        THEN 'gastos_financieros'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%mantenimiento%'
        THEN 'gastos_financieros'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%seguro%'
        THEN 'gastos_financieros'

      -- Sellados
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%sellado%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%impuesto de sellos%'
        THEN 'gastos_financieros'

      -- Procesamiento tarjetas (costo del comercio — se queda acá)
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%cargo a comercios visa%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%cargo a comercios mastercard%'
        THEN 'gastos_financieros'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%debito arreglo - visa%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%debito arreglo - mastercard%'
        THEN 'gastos_financieros'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%contracargo a comercio%'
        THEN 'gastos_financieros'

      -- Aranceles
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%arancel%'
        THEN 'gastos_financieros'

      -- =================================================================
      -- 7. PROVEEDORES (residual)
      -- =================================================================
      ELSE 'proveedores'
    END AS categoria
  FROM movimiento_bancario
  WHERE COALESCE(debito, 0) > 0
    AND fecha >= '2024-01-01'
),

-- ===========================================================================
-- CTE 3: NETTING (sin cambios)
-- ===========================================================================
netting AS (
  SELECT
    TO_CHAR(fecha, 'YYYY-MM') AS p,
    CASE
      WHEN UPPER(COALESCE(concepto, '')) = 'REVERSA RETENCION ARBA'
        THEN 'impuestos'
      WHEN UPPER(COALESCE(concepto, '')) LIKE 'REV.%IMP.%LEY 25413%'
        THEN 'impuestos'
      WHEN UPPER(COALESCE(concepto, '')) = 'DEVOLUCION PAGO CH/OE'
        THEN 'proveedores'
    END AS categoria_netting,
    COALESCE(credito, 0) AS monto
  FROM movimiento_bancario
  WHERE COALESCE(credito, 0) > 0
    AND fecha >= '2024-01-01'
    AND (
      UPPER(COALESCE(concepto, '')) = 'REVERSA RETENCION ARBA'
      OR UPPER(COALESCE(concepto, '')) LIKE 'REV.%IMP.%LEY 25413%'
      OR UPPER(COALESCE(concepto, '')) = 'DEVOLUCION PAGO CH/OE'
    )
),

netting_agg AS (
  SELECT
    p,
    SUM(CASE WHEN categoria_netting = 'impuestos' THEN monto ELSE 0 END) AS netting_impuestos,
    SUM(CASE WHEN categoria_netting = 'proveedores' THEN monto ELSE 0 END) AS netting_proveedores
  FROM netting
  GROUP BY p
),

-- ===========================================================================
-- CTE 4: AGREGACIÓN DE DÉBITOS BANCARIOS
-- 063: agrega tarjetas
-- ===========================================================================
banco_agg AS (
  SELECT
    p,
    SUM(CASE WHEN categoria = 'proveedores' THEN monto ELSE 0 END) AS proveedores,
    SUM(CASE WHEN categoria = 'sueldos' THEN monto ELSE 0 END) AS sueldos,
    SUM(CASE WHEN categoria = 'impuestos' THEN monto ELSE 0 END) AS impuestos,
    SUM(CASE WHEN categoria = 'gastos_financieros' THEN monto ELSE 0 END) AS financieros,
    SUM(CASE WHEN categoria = 'tarjetas' THEN monto ELSE 0 END) AS tarjetas,  -- 063
    SUM(CASE WHEN categoria = 'retiros_socios' THEN monto ELSE 0 END) AS retiros,
    SUM(CASE WHEN categoria = 'transferencias' THEN monto ELSE 0 END) AS transferencias_out,
    SUM(CASE WHEN banco = 'provincia'
              AND categoria NOT IN ('retiros_socios', 'transferencias')
             THEN monto ELSE 0 END) AS total_provincia,
    SUM(CASE WHEN banco = 'santander'
              AND categoria NOT IN ('retiros_socios', 'transferencias')
             THEN monto ELSE 0 END) AS total_santander
  FROM banco_deb_clasificado
  GROUP BY p
),

-- ===========================================================================
-- CTE 5-8: COBROS (sin cambios respecto a 061)
-- ===========================================================================
caja AS (
  SELECT TO_CHAR(fecha, 'YYYY-MM') AS p,
    SUM(COALESCE(importe, 0)) AS efectivo
  FROM movimiento_caja
  WHERE condicion_pago = 'EFECTIVO'
    AND tipo = 'Venta Contado'
    AND fecha >= '2024-01-01'
  GROUP BY 1
),

banco_cred AS (
  SELECT TO_CHAR(fecha, 'YYYY-MM') AS p,
    banco,
    SUM(COALESCE(credito, 0)) AS cobros
  FROM movimiento_bancario
  WHERE COALESCE(credito, 0) > 0
    AND fecha >= '2024-01-01'
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

banco_cred_prov AS (
  SELECT p, cobros FROM banco_cred WHERE banco = 'provincia'
),
banco_cred_sant AS (
  SELECT p, cobros FROM banco_cred WHERE banco = 'santander'
),

financiamiento_banco AS (
  SELECT TO_CHAR(fecha, 'YYYY-MM') AS p,
    SUM(COALESCE(credito, 0)) AS monto
  FROM movimiento_bancario
  WHERE COALESCE(credito, 0) > 0
    AND fecha >= '2024-01-01'
    AND LOWER(COALESCE(concepto, '')) LIKE '%acreditacion%prestamo%'
  GROUP BY 1
),

financiamiento_mp AS (
  SELECT TO_CHAR(fecha, 'YYYY-MM') AS p,
    SUM(COALESCE(importe, 0)) AS monto
  FROM movimiento_mp
  WHERE COALESCE(importe, 0) > 0
    AND fecha >= '2024-01-01'
    AND tipo_operacion ILIKE '%Préstamo acreditado%'
  GROUP BY 1
),

mp_ing AS (
  SELECT TO_CHAR(fecha, 'YYYY-MM') AS p,
    SUM(COALESCE(importe, 0)) AS ing
  FROM movimiento_mp
  WHERE COALESCE(importe, 0) > 0
    AND fecha >= '2024-01-01'
    AND NOT (
      COALESCE(tipo_operacion, '') ILIKE '%Transferencia%'
      AND (
        LOWER(COALESCE(tipo_operacion, '')) LIKE '%nadal y zaccaro%'
        OR COALESCE(tipo_operacion, '') LIKE '%30657033770%'
      )
    )
    AND COALESCE(tipo_operacion, '') NOT ILIKE '%Préstamo acreditado%'
  GROUP BY 1
),

-- ===========================================================================
-- CTE 9: EGRESOS MP (sin cambios — no hay patrones VISA/MC en MP)
-- ===========================================================================
mp_egresos AS (
  SELECT
    TO_CHAR(fecha, 'YYYY-MM') AS p,
    CASE
      WHEN tipo_operacion ILIKE '%Retiro de dinero%'
        THEN 'transferencias'
      WHEN tipo_operacion ILIKE '%Transferencia%'
        AND (
          LOWER(COALESCE(tipo_operacion, '')) LIKE '%nadal y zaccaro%'
          OR tipo_operacion LIKE '%30657033770%'
        )
        THEN 'transferencias'
      WHEN tipo_operacion IN ('Pago', 'Movimiento General')
        THEN 'proveedores'
      WHEN tipo_operacion ILIKE '%Transferencia%'
        AND NOT (
          LOWER(COALESCE(tipo_operacion, '')) LIKE '%nadal y zaccaro%'
          OR tipo_operacion LIKE '%30657033770%'
        )
        THEN 'proveedores'
      WHEN tipo_operacion ILIKE '%Créditos y Débitos%'
        OR LOWER(tipo_operacion) LIKE '%retencion%'
        OR LOWER(tipo_operacion) LIKE '%retención%'
        OR LOWER(tipo_operacion) LIKE '%ingresos brutos%'
        OR LOWER(tipo_operacion) LIKE '%iibb%'
        OR LOWER(tipo_operacion) LIKE '%iva%'
        OR LOWER(tipo_operacion) LIKE '%ganancias%'
        OR LOWER(tipo_operacion) LIKE '%impuesto%'
        THEN 'impuestos'
      WHEN tipo_operacion ILIKE '%Costo de Mercado Pago%'
        OR tipo_operacion ILIKE '%Costo por adelanto%'
        THEN 'gastos_financieros'
      ELSE 'proveedores'
    END AS categoria,
    ABS(COALESCE(importe, 0)) AS monto
  FROM movimiento_mp
  WHERE COALESCE(importe, 0) < 0
    AND fecha >= '2024-01-01'
    AND tipo_operacion NOT ILIKE '%Anulación%'
),

mp_agg AS (
  SELECT
    p,
    SUM(CASE WHEN categoria = 'proveedores' THEN monto ELSE 0 END) AS proveedores,
    SUM(CASE WHEN categoria = 'impuestos' THEN monto ELSE 0 END) AS impuestos,
    SUM(CASE WHEN categoria = 'gastos_financieros' THEN monto ELSE 0 END) AS financieros,
    SUM(CASE WHEN categoria = 'transferencias' THEN monto ELSE 0 END) AS transferencias_out
    -- nota: no hay tarjetas en MP
  FROM mp_egresos
  GROUP BY p
)

-- ===========================================================================
-- FINAL SELECT — 063: agrega pagos_tarjetas
-- ===========================================================================
SELECT
  m.p,
  -- COBROS OPERACIONALES
  COALESCE(c.efectivo, 0),
  COALESCE(bcp.cobros, 0) + COALESCE(bcs.cobros, 0),
  COALESCE(bcp.cobros, 0),
  COALESCE(bcs.cobros, 0),
  COALESCE(mi.ing, 0),
  -- EGRESOS OPERACIONALES
  GREATEST(COALESCE(ba.proveedores, 0) + COALESCE(mp.proveedores, 0)
           - COALESCE(net.netting_proveedores, 0), 0),
  COALESCE(ba.sueldos, 0),
  GREATEST(COALESCE(ba.impuestos, 0) + COALESCE(mp.impuestos, 0)
           - COALESCE(net.netting_impuestos, 0), 0),
  COALESCE(ba.financieros, 0) + COALESCE(mp.financieros, 0),
  COALESCE(ba.tarjetas, 0),  -- 063: tarjetas (solo banco, no hay en MP)
  -- POR BANCO
  COALESCE(ba.total_provincia, 0),
  COALESCE(ba.total_santander, 0),
  -- NO OPERACIONALES
  COALESCE(ba.retiros, 0),
  COALESCE(ba.transferencias_out, 0) + COALESCE(mp.transferencias_out, 0),
  -- FINANCIAMIENTO
  COALESCE(fb.monto, 0) + COALESCE(fmp.monto, 0)

FROM meses m
LEFT JOIN caja c ON c.p = m.p
LEFT JOIN banco_cred_prov bcp ON bcp.p = m.p
LEFT JOIN banco_cred_sant bcs ON bcs.p = m.p
LEFT JOIN banco_agg ba ON ba.p = m.p
LEFT JOIN netting_agg net ON net.p = m.p
LEFT JOIN mp_ing mi ON mi.p = m.p
LEFT JOIN mp_agg mp ON mp.p = m.p
LEFT JOIN financiamiento_banco fb ON fb.p = m.p
LEFT JOIN financiamiento_mp fmp ON fmp.p = m.p
ORDER BY m.p;

$function$;


-- =====================================================================
-- PARTE 2: get_flujo_fondos_detalle — CREATE OR REPLACE
-- 063: agrega categoría 'tarjetas' y fix Santander variant
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_flujo_fondos_detalle(p_anio integer)
RETURNS TABLE(periodo text, concepto text, categoria text, subcategoria text, monto numeric, fuente text, banco text)
LANGUAGE sql
STABLE
SET statement_timeout TO '30s'
AS $function$

  WITH banco_detalle AS (
    SELECT
      TO_CHAR(fecha, 'YYYY-MM') AS periodo,
      COALESCE(debito, 0) AS monto,
      LOWER(COALESCE(concepto, '')) AS concepto_lower,
      COALESCE(concepto, '') AS concepto_raw,
      banco::text AS banco
    FROM movimiento_bancario
    WHERE COALESCE(debito, 0) > 0
      AND fecha >= (p_anio || '-01-01')::date
      AND fecha <  ((p_anio + 1) || '-01-01')::date
      -- EXCLUDE transfers
      AND COALESCE(concepto, '') NOT LIKE 'BIP DB TRANSFERENCIA%'
      AND LOWER(COALESCE(concepto, '')) NOT LIKE '%mercado pago%'
      AND LOWER(COALESCE(concepto, '')) NOT LIKE '%inviu%'
      AND LOWER(COALESCE(concepto, '')) NOT LIKE '%invertir%'
      AND LOWER(COALESCE(concepto, '')) NOT LIKE '%iol%invertir%'
      AND UPPER(COALESCE(concepto, '')) NOT LIKE '%N:NADAL Y ZACCAR%'
      AND NOT (LOWER(COALESCE(concepto, '')) LIKE '%interbank%nadal y zaccaro%')
      AND NOT (
        LOWER(COALESCE(concepto, '')) LIKE '%nadal y zaccaro%'
        AND COALESCE(concepto, '') LIKE '%30657033770%'
      )
      -- EXCLUDE retiros
      AND COALESCE(concepto, '') NOT LIKE '%N:NADAL ANDREA%'
      AND COALESCE(concepto, '') NOT LIKE '%N:ZACCARO FABIAN%'
      AND COALESCE(concepto, '') NOT LIKE 'DEBITO TRANS.CAJERO AUT%'
      AND COALESCE(concepto, '') <> 'DEBITO EN CUENTA'
      AND UPPER(COALESCE(concepto, '')) NOT LIKE '%CHEQUE POR VENTANILLA%'
  ),

  banco_clasificado AS (
    SELECT
      periodo, monto, concepto_lower, concepto_raw, banco,
      CASE
        -- SUELDOS
        WHEN concepto_raw LIKE 'DEB LOTE ZACCARO FABIAN%' THEN 'sueldos'
        WHEN concepto_raw LIKE 'DEB LOTE HABERES%' THEN 'sueldos'
        WHEN concepto_raw LIKE 'DEBITO POR PAGO DE HABERES%' THEN 'sueldos'
        WHEN concepto_lower LIKE '%haber%' THEN 'sueldos'
        WHEN concepto_lower LIKE '%sueldo%' THEN 'sueldos'
        WHEN concepto_lower LIKE '%remuner%' THEN 'sueldos'
        WHEN concepto_lower LIKE '%aguinaldo%' THEN 'sueldos'
        WHEN concepto_lower LIKE '%vacacion%' THEN 'sueldos'

        -- IMPUESTOS
        WHEN concepto_lower LIKE '%retencion arba%' THEN 'impuestos'
        WHEN concepto_lower LIKE '%retencion iibb%' THEN 'impuestos'
        WHEN concepto_lower LIKE '%arba%' THEN 'impuestos'
        WHEN concepto_lower LIKE '%p.serv%ente950%' THEN 'impuestos'
        WHEN concepto_lower LIKE '%p.serv%ente270%' THEN 'impuestos'
        WHEN concepto_lower LIKE '%p.serv%municipali%' THEN 'impuestos'
        WHEN concepto_lower LIKE '%pago servicio por atm%' THEN 'impuestos'
        WHEN concepto_lower LIKE '%pago serv%' THEN 'impuestos'
        WHEN concepto_lower LIKE '%afip%' THEN 'impuestos'
        WHEN concepto_lower LIKE '%iibb%' THEN 'impuestos'
        WHEN concepto_lower LIKE '%ganancias%' THEN 'impuestos'
        WHEN concepto_lower LIKE '%monotributo%' THEN 'impuestos'
        WHEN concepto_lower LIKE '%municipalidad%' THEN 'impuestos'
        WHEN concepto_lower LIKE '%seguridad e higiene%' THEN 'impuestos'
        WHEN concepto_lower LIKE '%ley 25413%'
          OR concepto_lower LIKE '%ley 25.413%'
          OR concepto_lower LIKE '%25413%'
          OR concepto_lower LIKE '%25.413%'
          THEN 'impuestos'
        WHEN concepto_lower LIKE '%f.931%'
          OR concepto_lower LIKE '%f931%'
          THEN 'impuestos'
        WHEN concepto_lower LIKE '%sicoss%' THEN 'impuestos'
        WHEN concepto_lower LIKE '%impuesto s/deb%'
          OR concepto_lower LIKE '%impuesto s/cred%'
          THEN 'impuestos'
        WHEN concepto_lower LIKE '%contribucion%patronal%' THEN 'impuestos'
        WHEN concepto_lower LIKE '%aporte%jubilat%' THEN 'impuestos'
        WHEN concepto_lower LIKE '%obra social%' THEN 'impuestos'
        WHEN concepto_lower LIKE '%sindicato%' THEN 'impuestos'
        WHEN concepto_lower LIKE '%i.brutos%percepcion%'
          OR concepto_lower LIKE '%iibb%percepcion%'
          THEN 'impuestos'
        WHEN concepto_lower LIKE '%iva percepcion%'
          OR concepto_lower LIKE '%iva%rg 2408%'
          THEN 'impuestos'
        WHEN concepto_lower LIKE 'impuesto i.brutos%' THEN 'impuestos'
        WHEN concepto_lower LIKE 'iva 21%%' THEN 'impuestos'
        WHEN concepto_lower LIKE 'impuesto ley 25.413%' THEN 'impuestos'
        WHEN concepto_lower LIKE 'impuesto iibb%' THEN 'impuestos'
        WHEN concepto_lower LIKE 'iibb percepcion%' THEN 'impuestos'
        WHEN concepto_lower LIKE 'iva percepcion%' THEN 'impuestos'
        WHEN concepto_lower LIKE 'afip -%' THEN 'impuestos'

        -- =================================================================
        -- 063: TARJETAS — pago de resumen de tarjeta de crédito
        -- Gasto operativo. Distinto de CARGO A COMERCIOS (costo del comercio).
        -- =================================================================
        WHEN concepto_lower LIKE 'pago visa%' THEN 'tarjetas'
        WHEN concepto_lower LIKE '%pago liquidacion visa%'
          OR concepto_lower LIKE '%liquidacion visa%'
          THEN 'tarjetas'
        WHEN concepto_lower LIKE '%pago tarjeta de credito visa%'
          OR concepto_lower LIKE '%pago de tarjeta de credito visa%'
          THEN 'tarjetas'
        WHEN concepto_lower LIKE '%pago mastercard%'
          OR concepto_lower LIKE '%pago liquidacion mastercard%'
          OR concepto_lower LIKE '%liquidacion mastercard%'
          THEN 'tarjetas'

        -- GASTOS FINANCIEROS (sin VISA payment patterns, movidos a tarjetas)
        WHEN concepto_lower LIKE '%amortizacion%prestamo%'
          OR concepto_lower LIKE '%cuota prestamo%'
          OR concepto_lower LIKE '%cuota de prestamo%'
          OR concepto_lower LIKE '%pago cuota de prestamo%'
          THEN 'financieros'
        WHEN concepto_lower LIKE '%comision%'
          OR concepto_lower LIKE '%comis.gestion cheque%'
          OR concepto_lower LIKE '%com. mant.%'
          OR concepto_lower LIKE '%com mant%'
          OR concepto_lower LIKE '%com.movim mensuales clearing%'
          THEN 'financieros'
        WHEN concepto_lower LIKE '%interes%' THEN 'financieros'
        WHEN concepto_lower LIKE '%mantenimiento%' THEN 'financieros'
        WHEN concepto_lower LIKE '%seguro%' THEN 'financieros'
        WHEN concepto_lower LIKE '%sellado%'
          OR concepto_lower LIKE '%impuesto de sellos%'
          THEN 'financieros'
        WHEN concepto_lower LIKE '%cargo a comercios visa%'
          OR concepto_lower LIKE '%cargo a comercios mastercard%'
          THEN 'financieros'
        WHEN concepto_lower LIKE '%debito arreglo - visa%'
          OR concepto_lower LIKE '%debito arreglo - mastercard%'
          THEN 'financieros'
        WHEN concepto_lower LIKE '%contracargo a comercio%' THEN 'financieros'
        WHEN concepto_lower LIKE '%arancel%' THEN 'financieros'

        ELSE 'proveedores'
      END AS categoria,

      -- CONCEPTO NORMALIZADO
      CASE
        WHEN concepto_lower LIKE '%p.serv%ente950%' THEN 'P.SERV ENTE950 (AFIP)'
        WHEN concepto_lower LIKE '%p.serv%ente270%' THEN 'P.SERV ENTE270 (ARBA)'
        WHEN concepto_lower LIKE '%p.serv%municipali%' THEN 'P.SERV MUNICIPALIDAD'
        WHEN concepto_lower LIKE '%retencion arba%' THEN 'RETENCION ARBA'
        WHEN concepto_lower LIKE '%retencion iibb%' THEN 'RETENCION IIBB'
        WHEN concepto_lower LIKE '%impuesto s/deb%' THEN 'IMP. DEBITOS (Ley 25413)'
        WHEN concepto_lower LIKE '%impuesto s/cred%' THEN 'IMP. CREDITOS (Ley 25413)'
        WHEN concepto_lower LIKE '%ley 25413%' OR concepto_lower LIKE '%ley 25.413%'
          OR concepto_lower LIKE '%25413%' OR concepto_lower LIKE '%25.413%'
          OR concepto_lower LIKE 'impuesto ley 25.413%'
        THEN 'IMP. DEB/CRED (Ley 25413)'
        WHEN concepto_raw LIKE 'DEBITO POR PAGO DE HABERES%' THEN 'DEBITO POR PAGO DE HABERES'
        WHEN concepto_raw LIKE 'DEB LOTE ZACCARO FABIAN%' THEN 'DEB LOTE ZACCARO FABIAN'
        WHEN concepto_lower LIKE '%lote haberes%' THEN 'LOTE HABERES'
        WHEN concepto_lower LIKE '%pago de haberes%' OR concepto_lower LIKE '%pago haberes%'
        THEN 'PAGO DE HABERES'
        WHEN concepto_lower LIKE '%i.brutos%percepcion%' OR concepto_lower LIKE '%iibb%percepcion%'
          OR concepto_lower LIKE 'iibb percepcion%'
        THEN 'PERCEPCION IIBB'
        WHEN concepto_lower LIKE '%iva percepcion%' OR concepto_lower LIKE '%iva%rg 2408%'
          OR concepto_lower LIKE 'iva percepcion%'
        THEN 'PERCEPCION IVA (RG 2408)'
        WHEN concepto_lower LIKE 'iva 21%%' THEN 'IVA 21%'
        WHEN concepto_lower LIKE 'impuesto i.brutos%' THEN 'IMPUESTO INGRESOS BRUTOS'
        WHEN concepto_lower LIKE 'impuesto iibb%' THEN 'IMPUESTO IIBB'
        WHEN concepto_lower LIKE 'afip -%' THEN 'AFIP'
        WHEN concepto_lower LIKE '%pago servicio por atm%' THEN 'PAGO SERVICIO POR ATM (AFIP)'
        WHEN concepto_lower LIKE '%pago servicios varios%' THEN 'PAGO SERVICIOS VARIOS (AFIP)'
        WHEN concepto_lower LIKE '%federacion patr%' THEN 'FEDERACION PATRONAL (Seguro)'
        WHEN concepto_lower LIKE '%com. mant.%' OR concepto_lower LIKE '%com mant%'
        THEN 'COMISION MANTENIMIENTO'
        -- 063: tarjetas concepto normalizado
        WHEN concepto_lower LIKE '%pago liquidacion visa%' THEN 'PAGO LIQUIDACION VISA'
        WHEN concepto_lower LIKE '%liquidacion visa%' THEN 'LIQUIDACION VISA'
        WHEN concepto_lower LIKE 'pago visa%' THEN 'PAGO VISA'
        WHEN concepto_lower LIKE '%pago tarjeta de credito visa%'
          OR concepto_lower LIKE '%pago de tarjeta de credito visa%'
        THEN 'PAGO TARJETA VISA'
        WHEN concepto_lower LIKE '%pago liquidacion mastercard%' THEN 'PAGO LIQUIDACION MASTERCARD'
        WHEN concepto_lower LIKE '%liquidacion mastercard%' THEN 'LIQUIDACION MASTERCARD'
        WHEN concepto_lower LIKE '%pago mastercard%' THEN 'PAGO MASTERCARD'
        -- Financieros
        WHEN concepto_lower LIKE '%cargo a comercios visa%' THEN 'CARGO COMERCIOS VISA'
        WHEN concepto_lower LIKE '%cargo a comercios mastercard%' THEN 'CARGO COMERCIOS MASTERCARD'
        WHEN concepto_lower LIKE '%debito arreglo - visa%' THEN 'DEBITO ARREGLO VISA'
        WHEN concepto_lower LIKE '%debito arreglo - mastercard%' THEN 'DEBITO ARREGLO MASTERCARD'
        WHEN concepto_lower LIKE '%contracargo a comercio%' THEN 'CONTRACARGO COMERCIO'
        WHEN concepto_lower LIKE '%arancel clave dni%' THEN 'ARANCEL CLAVE DNI'
        WHEN concepto_lower LIKE '%arancel%' THEN 'ARANCEL'
        WHEN concepto_lower LIKE '%impuesto de sellos%' THEN 'IMPUESTO DE SELLOS'
        WHEN concepto_lower LIKE '%comis.gestion cheque%' THEN 'COMISION GESTION CHEQUE'
        WHEN concepto_lower LIKE '%com.movim mensuales clearing%' THEN 'COMISION CLEARING'
        ELSE LEFT(UPPER(TRIM(concepto_raw)), 40)
      END AS concepto_norm,

      -- SUBCATEGORIA (impuestos)
      CASE
        WHEN concepto_lower LIKE '%p.serv%ente950%' OR concepto_lower LIKE '%afip%'
          OR concepto_lower LIKE '%f.931%' OR concepto_lower LIKE '%f931%'
          OR concepto_lower LIKE '%sicoss%' OR concepto_lower LIKE '%ganancias%'
          OR concepto_lower LIKE '%monotributo%'
          OR concepto_lower LIKE '%iva percepcion%' OR concepto_lower LIKE '%iva%rg 2408%'
          OR concepto_lower LIKE '%pago servicio por atm%'
          OR concepto_lower LIKE '%pago serv%'
          OR concepto_lower LIKE 'iva percepcion%'
          OR concepto_lower LIKE 'iva 21%%'
          OR concepto_lower LIKE 'afip -%'
        THEN 'AFIP'
        WHEN concepto_lower LIKE '%arba%' OR concepto_lower LIKE '%retencion arba%'
          OR concepto_lower LIKE '%iibb%' OR concepto_lower LIKE '%retencion iibb%'
          OR concepto_lower LIKE '%i.brutos%percepcion%' OR concepto_lower LIKE '%iibb%percepcion%'
          OR concepto_lower LIKE '%p.serv%ente270%'
          OR concepto_lower LIKE 'impuesto i.brutos%'
          OR concepto_lower LIKE 'impuesto iibb%'
          OR concepto_lower LIKE 'iibb percepcion%'
        THEN 'ARBA'
        WHEN concepto_lower LIKE '%p.serv%municipali%' OR concepto_lower LIKE '%municipalidad%'
          OR concepto_lower LIKE '%seguridad e higiene%'
        THEN 'Municipal'
        WHEN concepto_lower LIKE '%ley 25413%' OR concepto_lower LIKE '%ley 25.413%'
          OR concepto_lower LIKE '%25413%' OR concepto_lower LIKE '%25.413%'
          OR concepto_lower LIKE '%impuesto s/deb%' OR concepto_lower LIKE '%impuesto s/cred%'
          OR concepto_lower LIKE 'impuesto ley 25.413%'
        THEN 'Imp. al Cheque'
        WHEN concepto_lower LIKE '%contribucion%patronal%' OR concepto_lower LIKE '%aporte%jubilat%'
          OR concepto_lower LIKE '%obra social%' OR concepto_lower LIKE '%sindicato%'
        THEN 'Cargas Sociales'
        ELSE 'Otros'
      END AS subcategoria_imp
    FROM banco_detalle
  ),

  banco_final AS (
    SELECT
      periodo,
      concepto_norm AS concepto,
      categoria,
      CASE WHEN categoria = 'impuestos' THEN subcategoria_imp ELSE NULL END AS subcategoria,
      monto,
      'banco'::text AS fuente,
      banco
    FROM banco_clasificado
  ),

  -- RETIROS (synced from 062)
  retiros_detalle AS (
    SELECT
      TO_CHAR(fecha, 'YYYY-MM') AS periodo,
      CASE
        WHEN COALESCE(concepto, '') LIKE '%N:NADAL ANDREA%'
          OR LOWER(COALESCE(concepto, '')) LIKE '%nadal%andrea%'
        THEN 'TRANSFERENCIA A NADAL ANDREA'
        WHEN COALESCE(concepto, '') LIKE '%N:ZACCARO FABIAN%'
        THEN 'TRANSFERENCIA A ZACCARO FABIAN'
        WHEN COALESCE(concepto, '') LIKE 'DEBITO TRANS.CAJERO AUT%'
        THEN 'DEBITO CAJERO AUTOMATICO'
        WHEN COALESCE(concepto, '') = 'DEBITO EN CUENTA'
        THEN 'DEBITO EN CUENTA'
        WHEN UPPER(COALESCE(concepto, '')) LIKE '%CHEQUE POR VENTANILLA%'
        THEN 'CHEQUE POR VENTANILLA'
        ELSE LEFT(UPPER(TRIM(COALESCE(concepto, ''))), 40)
      END AS concepto,
      'retiros'::text AS categoria,
      CASE
        WHEN COALESCE(concepto, '') LIKE '%N:NADAL ANDREA%'
          OR LOWER(COALESCE(concepto, '')) LIKE '%nadal%andrea%'
        THEN 'Nadal'
        WHEN COALESCE(concepto, '') LIKE '%N:ZACCARO FABIAN%'
        THEN 'Zaccaro'
        ELSE 'Otro'
      END AS subcategoria,
      COALESCE(debito, 0) AS monto,
      'banco'::text AS fuente,
      banco::text AS banco
    FROM movimiento_bancario
    WHERE COALESCE(debito, 0) > 0
      AND fecha >= (p_anio || '-01-01')::date
      AND fecha <  ((p_anio + 1) || '-01-01')::date
      AND (
        COALESCE(concepto, '') LIKE '%N:NADAL ANDREA%'
        OR COALESCE(concepto, '') LIKE '%N:ZACCARO FABIAN%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%nadal%andrea%'
        OR COALESCE(concepto, '') LIKE 'DEBITO TRANS.CAJERO AUT%'
        OR COALESCE(concepto, '') = 'DEBITO EN CUENTA'
        OR UPPER(COALESCE(concepto, '')) LIKE '%CHEQUE POR VENTANILLA%'
      )
      AND COALESCE(concepto, '') NOT LIKE 'DEB LOTE ZACCARO%'
      AND COALESCE(concepto, '') NOT LIKE '%PAGO DE HABERES%'
  ),

  -- TRANSFERENCIAS DÉBITO (synced from 062)
  transf_banco_deb AS (
    SELECT
      TO_CHAR(fecha, 'YYYY-MM') AS periodo,
      CASE
        WHEN LOWER(COALESCE(concepto, '')) LIKE '%inviu%'
          OR LOWER(COALESCE(concepto, '')) LIKE '%invertir%'
          OR LOWER(COALESCE(concepto, '')) LIKE '%iol%invertir%'
        THEN 'INVIU: ' || LEFT(UPPER(TRIM(COALESCE(concepto, ''))), 34)
        WHEN COALESCE(concepto, '') LIKE 'BIP DB TRANSFERENCIA%'
        THEN 'BIP DB TRANSFERENCIA'
        WHEN LOWER(COALESCE(concepto, '')) LIKE '%mercado pago%'
        THEN 'TRANSFERENCIA A MERCADO PAGO'
        WHEN UPPER(COALESCE(concepto, '')) LIKE '%N:NADAL Y ZACCAR%'
        THEN 'TRANSF. PROV→SANT (NADAL Y ZACCARO)'
        WHEN LOWER(COALESCE(concepto, '')) LIKE '%interbank%nadal y zaccaro%'
        THEN 'TRANSF. SANT→PROV (INTERBANK)'
        WHEN LOWER(COALESCE(concepto, '')) LIKE '%nadal y zaccaro%'
          AND COALESCE(concepto, '') LIKE '%30657033770%'
        THEN 'TRANSF. SANT→PROV (CUIT PROPIO)'
        ELSE LEFT(UPPER(TRIM(COALESCE(concepto, ''))), 40)
      END AS concepto,
      'transferencias'::text AS categoria,
      CASE
        WHEN LOWER(COALESCE(concepto, '')) LIKE '%inviu%'
          OR LOWER(COALESCE(concepto, '')) LIKE '%invertir%'
          OR LOWER(COALESCE(concepto, '')) LIKE '%iol%invertir%'
        THEN 'Inviu'
        ELSE 'Entre cuentas propias'
      END AS subcategoria,
      COALESCE(debito, 0) AS monto,
      'banco'::text AS fuente,
      banco::text AS banco
    FROM movimiento_bancario
    WHERE COALESCE(debito, 0) > 0
      AND fecha >= (p_anio || '-01-01')::date
      AND fecha <  ((p_anio + 1) || '-01-01')::date
      AND (
        COALESCE(concepto, '') LIKE 'BIP DB TRANSFERENCIA%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%mercado pago%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%inviu%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%invertir%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%iol%invertir%'
        OR UPPER(COALESCE(concepto, '')) LIKE '%N:NADAL Y ZACCAR%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%interbank%nadal y zaccaro%'
        OR (
          LOWER(COALESCE(concepto, '')) LIKE '%nadal y zaccaro%'
          AND COALESCE(concepto, '') LIKE '%30657033770%'
        )
      )
  ),

  -- TRANSFERENCIAS CRÉDITO (synced from 062)
  transf_banco_cred AS (
    SELECT
      TO_CHAR(fecha, 'YYYY-MM') AS periodo,
      CASE
        WHEN LOWER(COALESCE(concepto, '')) LIKE '%inviu%'
          OR LOWER(COALESCE(concepto, '')) LIKE '%invertir%'
          OR LOWER(COALESCE(concepto, '')) LIKE '%iol%invertir%'
        THEN 'INVIU: ' || LEFT(UPPER(TRIM(COALESCE(concepto, ''))), 34)
        WHEN LOWER(COALESCE(concepto, '')) LIKE '%deposito por caja%'
        THEN 'DEPOSITO POR CAJA'
        WHEN LOWER(COALESCE(concepto, '')) LIKE '%deposito de efectivo%'
        THEN 'DEPOSITO DE EFECTIVO'
        WHEN LOWER(COALESCE(concepto, '')) LIKE '%credito traspaso cajero%'
        THEN 'CREDITO TRASPASO CAJERO AUTOMATICO'
        WHEN LOWER(COALESCE(concepto, '')) LIKE 'dep efvo%'
        THEN 'DEPOSITO EFECTIVO'
        WHEN LOWER(COALESCE(concepto, '')) LIKE '%deposito cheque%'
        THEN 'DEPOSITO CHEQUE'
        WHEN LOWER(COALESCE(concepto, '')) LIKE '%deposito ch/oe%'
        THEN 'DEPOSITO CH/OE'
        WHEN LOWER(COALESCE(concepto, '')) LIKE '%mercado pago%'
        THEN 'CREDITO DESDE MERCADO PAGO'
        WHEN COALESCE(concepto, '') LIKE '%N:NADAL Y ZACCAR%'
        THEN 'CREDITO DESDE NADAL Y ZACCARO SA'
        WHEN COALESCE(concepto, '') LIKE '%30657033770%'
        THEN 'CREDITO DESDE CUENTA PROPIA (CUIT)'
        ELSE LEFT(UPPER(TRIM(COALESCE(concepto, ''))), 40)
      END AS concepto,
      'transferencias'::text AS categoria,
      CASE
        WHEN LOWER(COALESCE(concepto, '')) LIKE '%inviu%'
          OR LOWER(COALESCE(concepto, '')) LIKE '%invertir%'
          OR LOWER(COALESCE(concepto, '')) LIKE '%iol%invertir%'
        THEN 'Inviu'
        ELSE 'Entre cuentas propias'
      END AS subcategoria,
      COALESCE(credito, 0) AS monto,
      'banco'::text AS fuente,
      banco::text AS banco
    FROM movimiento_bancario
    WHERE COALESCE(credito, 0) > 0
      AND fecha >= (p_anio || '-01-01')::date
      AND fecha <  ((p_anio + 1) || '-01-01')::date
      AND (
        LOWER(COALESCE(concepto, '')) LIKE '%deposito por caja%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%deposito de efectivo%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%credito traspaso cajero%'
        OR LOWER(COALESCE(concepto, '')) LIKE 'dep efvo%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%deposito cheque%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%deposito ch/oe%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%mercado pago%'
        OR COALESCE(concepto, '') LIKE '%N:NADAL Y ZACCAR%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%inviu%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%invertir%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%iol%invertir%'
        OR COALESCE(concepto, '') LIKE '%30657033770%'
      )
  ),

  transf_mp AS (
    SELECT
      TO_CHAR(fecha, 'YYYY-MM') AS periodo,
      'MP: ' || COALESCE(tipo_operacion, '') AS concepto,
      'transferencias'::text AS categoria,
      'Entre cuentas propias'::text AS subcategoria,
      ABS(COALESCE(importe, 0)) AS monto,
      'mp'::text AS fuente,
      NULL::text AS banco
    FROM movimiento_mp
    WHERE fecha >= (p_anio || '-01-01')::date
      AND fecha <  ((p_anio + 1) || '-01-01')::date
      AND (
        COALESCE(tipo_operacion, '') ILIKE '%Retiro de dinero%'
        OR COALESCE(tipo_operacion, '') ILIKE '%Anulación%'
        OR (
          COALESCE(tipo_operacion, '') ILIKE '%Transferencia%'
          AND (
            LOWER(COALESCE(tipo_operacion, '')) LIKE '%nadal y zaccaro%'
            OR COALESCE(tipo_operacion, '') LIKE '%30657033770%'
          )
        )
      )
  ),

  mp_clasificado AS (
    SELECT
      TO_CHAR(fecha, 'YYYY-MM') AS periodo,
      'MP: ' || COALESCE(tipo_operacion, '') AS concepto,
      CASE
        WHEN COALESCE(tipo_operacion, '') IN ('Pago', 'Movimiento General')
        THEN 'proveedores'
        WHEN COALESCE(tipo_operacion, '') ILIKE '%Transferencia%'
        THEN 'proveedores'
        WHEN LOWER(COALESCE(tipo_operacion, '')) LIKE '%créditos y débitos%'
          OR LOWER(COALESCE(tipo_operacion, '')) LIKE '%creditos y debitos%'
          OR LOWER(COALESCE(tipo_operacion, '')) LIKE '%retencion%'
          OR LOWER(COALESCE(tipo_operacion, '')) LIKE '%retención%'
          OR LOWER(COALESCE(tipo_operacion, '')) LIKE '%ingresos brutos%'
          OR LOWER(COALESCE(tipo_operacion, '')) LIKE '%iibb%'
          OR LOWER(COALESCE(tipo_operacion, '')) LIKE '%iva%'
          OR LOWER(COALESCE(tipo_operacion, '')) LIKE '%ganancias%'
          OR LOWER(COALESCE(tipo_operacion, '')) LIKE '%impuesto%'
        THEN 'impuestos'
        WHEN COALESCE(tipo_operacion, '') ILIKE '%Costo de Mercado Pago%'
          OR COALESCE(tipo_operacion, '') ILIKE '%Costo por adelanto%'
        THEN 'financieros'
        ELSE 'proveedores'
      END AS categoria,
      CASE
        WHEN COALESCE(tipo_operacion, '') IN ('Pago', 'Movimiento General')
        THEN NULL::text
        WHEN COALESCE(tipo_operacion, '') ILIKE '%Transferencia%'
        THEN NULL::text
        WHEN LOWER(COALESCE(tipo_operacion, '')) LIKE '%créditos y débitos%'
          OR LOWER(COALESCE(tipo_operacion, '')) LIKE '%creditos y debitos%'
        THEN 'Imp. al Cheque'
        WHEN LOWER(COALESCE(tipo_operacion, '')) LIKE '%iibb%'
          OR LOWER(COALESCE(tipo_operacion, '')) LIKE '%ingresos brutos%'
        THEN 'ARBA'
        WHEN LOWER(COALESCE(tipo_operacion, '')) LIKE '%iva%'
        THEN 'AFIP'
        WHEN LOWER(COALESCE(tipo_operacion, '')) LIKE '%ganancias%'
        THEN 'AFIP'
        WHEN LOWER(COALESCE(tipo_operacion, '')) LIKE '%retencion%'
          OR LOWER(COALESCE(tipo_operacion, '')) LIKE '%retención%'
        THEN 'AFIP'
        WHEN LOWER(COALESCE(tipo_operacion, '')) LIKE '%impuesto%'
        THEN 'Otros'
        ELSE NULL::text
      END AS subcategoria,
      ABS(COALESCE(importe, 0)) AS monto,
      'mp'::text AS fuente,
      NULL::text AS banco
    FROM movimiento_mp
    WHERE COALESCE(importe, 0) < 0
      AND fecha >= (p_anio || '-01-01')::date
      AND fecha <  ((p_anio + 1) || '-01-01')::date
      AND COALESCE(tipo_operacion, '') NOT ILIKE '%Retiro de dinero%'
      AND COALESCE(tipo_operacion, '') NOT ILIKE '%Anulación%'
      AND NOT (
        COALESCE(tipo_operacion, '') ILIKE '%Transferencia%'
        AND (
          LOWER(COALESCE(tipo_operacion, '')) LIKE '%nadal y zaccaro%'
          OR COALESCE(tipo_operacion, '') LIKE '%30657033770%'
        )
      )
  ),

  all_movs AS (
    SELECT * FROM banco_final
    UNION ALL SELECT * FROM retiros_detalle
    UNION ALL SELECT * FROM transf_banco_deb
    UNION ALL SELECT * FROM transf_banco_cred
    UNION ALL SELECT * FROM transf_mp
    UNION ALL SELECT * FROM mp_clasificado
  )

  SELECT
    periodo, concepto, categoria, subcategoria,
    SUM(monto) AS monto, fuente, banco
  FROM all_movs
  GROUP BY periodo, concepto, categoria, subcategoria, fuente, banco
  ORDER BY periodo, categoria, monto DESC;

$function$;


-- =============================================================================
-- ROLLBACK (si es necesario revertir):
--
-- -- Paso 1: restaurar get_flujo_fondos sin la columna pagos_tarjetas
-- DROP FUNCTION IF EXISTS public.get_flujo_fondos();
-- -- Luego re-aplicar la definición de 061 (sin cambios de 063)
--
-- -- Paso 2: restaurar get_flujo_fondos_detalle al estado de 062
-- -- Re-aplicar la definición de 062 (sin cambios de 063)
-- =============================================================================
