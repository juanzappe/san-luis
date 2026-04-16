-- =============================================================================
-- 061_refactor_get_flujo_fondos.sql
-- Rewrite completo de get_flujo_fondos()
-- =============================================================================
--
-- Cambios principales vs. versión anterior (056):
--   1. CASE clasificador unificado (era 4x repetido, ahora 1x)
--   2. Nueva columna: financiamiento_recibido (préstamos bancarios + MP)
--   3. Netting: REVERSA RETENCION ARBA y REV. IMP LEY 25413 restan de impuestos
--   4. Netting: DEVOLUCION PAGO CH/OE resta de proveedores
--   5. PAGO LIQUIDACION VISA ($60.6M) movido de proveedores → gastos financieros
--   6. Transferencias ampliadas: N:NADAL Y ZACCAR, interbank a cuenta propia,
--      BIP DB TRANSFERENCIA genérico, Santander→Provincia con CUIT propio
--   7. Depósitos de efectivo: patrones adicionales excluidos de cobros
--      (dep efvo, deposito cheque, deposito ch/oe)
--   8. Créditos propios: exclusión completa via %30657033770%
--   9. MP "Retiro de dinero" marcado como transferencia explícita
--  10. MP "Préstamo acreditado" → financiamiento_recibido
-- =============================================================================

-- DROP necesario porque se agrega columna financiamiento_recibido al retorno
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
-- CTE 1: MESES — genera todos los períodos YYYY-MM con datos desde 2024-01
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
-- Cada débito se clasifica UNA sola vez con un CASE secuencial.
-- El orden importa: transferencias → retiros → sueldos → impuestos →
-- gastos financieros → proveedores (residual).
-- ===========================================================================
banco_deb_clasificado AS (
  SELECT
    TO_CHAR(fecha, 'YYYY-MM') AS p,
    banco,
    COALESCE(debito, 0) AS monto,
    CASE
      -- =================================================================
      -- 1. TRANSFERENCIAS ENTRE CUENTAS (no es egreso real del negocio)
      --    Dinero que cambia de ubicación pero sigue siendo de la empresa.
      -- =================================================================

      -- INVIU: broker de inversiones, movimiento hacia/desde FCI
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%inviu%'
        THEN 'transferencias'

      -- BIP DB TRANSFERENCIA (sin destino detallado en el concepto).
      -- Conservadoramente tratado como transferencia — la mayoría son
      -- movimientos propios Provincia→Santander sin nombre destino.
      WHEN COALESCE(concepto, '') LIKE 'BIP DB TRANSFERENCIA%'
        THEN 'transferencias'

      -- Provincia → Santander: transferencia con nombre empresa destino
      -- Ej: "BIP DB.TR.28/07-C.544342 D:30657033770 N:NADAL Y ZACCAR"
      WHEN UPPER(COALESCE(concepto, '')) LIKE '%N:NADAL Y ZACCAR%'
        THEN 'transferencias'

      -- Santander → Provincia: pago CCI a cuenta propia
      -- Ej: "Pago cci 24hs no gravada interbank A nadal y zaccaro sa / - var / 30657033770"
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%interbank%nadal y zaccaro%'
        THEN 'transferencias'

      -- Santander → Provincia: transferencia genérica a cuenta propia con CUIT
      -- Ej: "Transferencia no gravada A nadal y zaccaro sa / - var / 30657033770"
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%nadal y zaccaro%'
        AND COALESCE(concepto, '') LIKE '%30657033770%'
        THEN 'transferencias'

      -- Débitos que representan retiros hacia Mercado Pago
      -- (no hay registros actualmente pero cubrimos el patrón por si aparecen)
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%mercado pago%'
        THEN 'transferencias'

      -- =================================================================
      -- 2. RETIROS SOCIOS
      --    Dinero que sale hacia los dueños de la empresa.
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
      --    Pagos de haberes, aguinaldo, vacaciones.
      --    Nota: DEB LOTE ZACCARO FABIAN es pago de nómina completa
      --    (no retiro de socio — el lote contiene haberes de todos).
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
      --    Retenciones, percepciones, pagos AFIP/ARBA/municipales,
      --    cargas sociales (F.931, SICOSS, obra social, sindicato).
      -- =================================================================

      -- ARBA (retenciones e IIBB provincial)
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%retencion arba%'
        THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%retencion iibb%'
        THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%arba%'
        THEN 'impuestos'

      -- Pagos de servicios impositivos (Provincia y Santander)
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

      -- AFIP y organismos nacionales
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

      -- Ley 25413 (impuesto al cheque)
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%ley 25413%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%ley 25.413%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%25413%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%25.413%'
        THEN 'impuestos'

      -- Cargas sociales (F.931 / SICOSS)
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%f.931%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%f931%'
        THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%sicoss%'
        THEN 'impuestos'

      -- Impuesto sobre débitos/créditos
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%impuesto s/deb%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%impuesto s/cred%'
        THEN 'impuestos'

      -- Aportes patronales, jubilatorios, obra social, sindicato
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%contribucion%patronal%'
        THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%aporte%jubilat%'
        THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%obra social%'
        THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%sindicato%'
        THEN 'impuestos'

      -- Percepciones IIBB e IVA
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%i.brutos%percepcion%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%iibb%percepcion%'
        THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%iva percepcion%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%iva%rg 2408%'
        THEN 'impuestos'

      -- Formatos Santander
      WHEN LOWER(COALESCE(concepto, '')) LIKE 'impuesto i.brutos%'
        THEN 'impuestos'
      WHEN LOWER(COALESCE(concepto, '')) LIKE 'iva 21%'
        THEN 'impuestos'

      -- =================================================================
      -- 5. GASTOS FINANCIEROS
      --    Préstamos, VISA/MC, comisiones, intereses, seguros bancarios,
      --    aranceles, contracargos.
      --    FIX: PAGO LIQUIDACION VISA antes caía en proveedores ($60.6M).
      -- =================================================================

      -- Préstamos bancarios
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%amortizacion%prestamo%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%cuota prestamo%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%cuota de prestamo%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%pago cuota de prestamo%'
        THEN 'gastos_financieros'

      -- Pagos VISA/tarjetas — INCLUYE PAGO LIQUIDACION VISA (antes en proveedores)
      WHEN LOWER(COALESCE(concepto, '')) LIKE 'pago visa%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%pago tarjeta de credito visa%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%pago liquidacion visa%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%liquidacion visa%'
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

      -- Sellados e impuesto de sellos (es costo financiero, no impuesto operacional)
      WHEN LOWER(COALESCE(concepto, '')) LIKE '%sellado%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%impuesto de sellos%'
        THEN 'gastos_financieros'

      -- Procesamiento tarjetas (VISA/MC/AMEX en Santander)
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
      -- 6. PROVEEDORES (residual)
      --    Todo lo que no matcheó arriba: cheques, transferencias a
      --    terceros, débitos genéricos a proveedores.
      -- =================================================================
      ELSE 'proveedores'
    END AS categoria
  FROM movimiento_bancario
  WHERE COALESCE(debito, 0) > 0
    AND fecha >= '2024-01-01'
),

-- ===========================================================================
-- CTE 3: NETTING — Créditos bancarios que son reversas/devoluciones
-- Estos montos se restan de sus categorías de egreso correspondientes
-- en lugar de sumarse como cobros.
-- ===========================================================================
netting AS (
  SELECT
    TO_CHAR(fecha, 'YYYY-MM') AS p,
    CASE
      -- Reversa retención ARBA → resta de impuestos
      WHEN UPPER(COALESCE(concepto, '')) = 'REVERSA RETENCION ARBA'
        THEN 'impuestos'
      -- Reversa impuesto Ley 25413 débito/crédito → resta de impuestos
      WHEN UPPER(COALESCE(concepto, '')) LIKE 'REV.%IMP.%LEY 25413%'
        THEN 'impuestos'
      -- Devolución cheque/orden de pago → resta de proveedores
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
-- CTE 4: AGREGACIÓN DE DÉBITOS BANCARIOS por período
-- ===========================================================================
banco_agg AS (
  SELECT
    p,
    -- Egresos operacionales brutos
    SUM(CASE WHEN categoria = 'proveedores' THEN monto ELSE 0 END) AS proveedores,
    SUM(CASE WHEN categoria = 'sueldos' THEN monto ELSE 0 END) AS sueldos,
    SUM(CASE WHEN categoria = 'impuestos' THEN monto ELSE 0 END) AS impuestos,
    SUM(CASE WHEN categoria = 'gastos_financieros' THEN monto ELSE 0 END) AS financieros,
    -- No operacionales
    SUM(CASE WHEN categoria = 'retiros_socios' THEN monto ELSE 0 END) AS retiros,
    SUM(CASE WHEN categoria = 'transferencias' THEN monto ELSE 0 END) AS transferencias_out,
    -- Por banco (solo operacionales, para drill-down)
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
-- CTE 5: COBROS EFECTIVO — ventas contado en caja (POS)
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

-- ===========================================================================
-- CTE 6: COBROS BANCO — créditos excluyendo:
--   - Depósitos de efectivo propio (ya contados en caja)
--   - Transferencias desde cuentas propias (CUIT 30657033770)
--   - Transferencias desde MP (ya contado en cobros_mp)
--   - INVIU (broker inversiones)
--   - Acreditaciones de préstamos (van a financiamiento_recibido)
--   - Reversas/devoluciones (van a netting)
-- ===========================================================================
banco_cred AS (
  SELECT TO_CHAR(fecha, 'YYYY-MM') AS p,
    banco,
    SUM(COALESCE(credito, 0)) AS cobros
  FROM movimiento_bancario
  WHERE COALESCE(credito, 0) > 0
    AND fecha >= '2024-01-01'
    -- Excluir depósitos de efectivo (double-count con cobros_efectivo)
    AND LOWER(COALESCE(concepto, '')) NOT LIKE '%deposito por caja%'
    AND LOWER(COALESCE(concepto, '')) NOT LIKE '%deposito de efectivo%'
    AND LOWER(COALESCE(concepto, '')) NOT LIKE '%credito traspaso cajero%'
    AND LOWER(COALESCE(concepto, '')) NOT LIKE 'dep efvo%'
    AND LOWER(COALESCE(concepto, '')) NOT LIKE '%deposito cheque%'
    AND LOWER(COALESCE(concepto, '')) NOT LIKE '%deposito ch/oe%'
    -- Excluir transferencias desde MP (ya contado en cobros_mp)
    AND LOWER(COALESCE(concepto, '')) NOT LIKE '%mercado pago%'
    -- Excluir transferencias desde cuentas propias (CUIT de la empresa)
    AND COALESCE(concepto, '') NOT LIKE '%30657033770%'
    AND COALESCE(concepto, '') NOT LIKE '%N:NADAL Y ZACCAR%'
    -- Excluir INVIU (broker inversiones)
    AND LOWER(COALESCE(concepto, '')) NOT LIKE '%inviu%'
    -- Excluir acreditaciones de préstamos (van a financiamiento_recibido)
    AND LOWER(COALESCE(concepto, '')) NOT LIKE '%acreditacion%prestamo%'
    -- Excluir reversas/devoluciones (van a netting)
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

-- ===========================================================================
-- CTE 7: FINANCIAMIENTO RECIBIDO — préstamos bancarios + MP
-- Separado de cobros operacionales porque no es ingreso del negocio.
-- ===========================================================================
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

-- ===========================================================================
-- CTE 8: COBROS MP — ingresos excluyendo transferencias propias
-- Las "Transferencia recibida [Nombre Persona]" son cobros de clientes (OK).
-- Solo se excluyen las que mencionan nadal y zaccaro o el CUIT propio.
-- ===========================================================================
mp_ing AS (
  SELECT TO_CHAR(fecha, 'YYYY-MM') AS p,
    SUM(COALESCE(importe, 0)) AS ing
  FROM movimiento_mp
  WHERE COALESCE(importe, 0) > 0
    AND fecha >= '2024-01-01'
    -- Excluir transferencias propias
    AND NOT (
      COALESCE(tipo_operacion, '') ILIKE '%Transferencia%'
      AND (
        LOWER(COALESCE(tipo_operacion, '')) LIKE '%nadal y zaccaro%'
        OR COALESCE(tipo_operacion, '') LIKE '%30657033770%'
      )
    )
    -- Excluir préstamos (van a financiamiento_recibido)
    AND COALESCE(tipo_operacion, '') NOT ILIKE '%Préstamo acreditado%'
  GROUP BY 1
),

-- ===========================================================================
-- CTE 9: EGRESOS MP — clasificados en las 6 categorías
-- tipo_operacion es la columna clave; el nombre del destinatario viene
-- embebido en ella para transferencias (ej: "Transferencia recibida Perez, Juan").
-- ===========================================================================
mp_egresos AS (
  SELECT
    TO_CHAR(fecha, 'YYYY-MM') AS p,
    CASE
      -- Transferencias (retiros MP → banco propio, no es egreso real)
      WHEN tipo_operacion ILIKE '%Retiro de dinero%'
        THEN 'transferencias'

      -- Transferencias a cuentas propias
      WHEN tipo_operacion ILIKE '%Transferencia%'
        AND (
          LOWER(COALESCE(tipo_operacion, '')) LIKE '%nadal y zaccaro%'
          OR tipo_operacion LIKE '%30657033770%'
        )
        THEN 'transferencias'

      -- Proveedores: pagos directos y movimientos generales
      WHEN tipo_operacion IN ('Pago', 'Movimiento General')
        THEN 'proveedores'

      -- Proveedores: transferencias a terceros (no a cuenta propia)
      WHEN tipo_operacion ILIKE '%Transferencia%'
        AND NOT (
          LOWER(COALESCE(tipo_operacion, '')) LIKE '%nadal y zaccaro%'
          OR tipo_operacion LIKE '%30657033770%'
        )
        THEN 'proveedores'

      -- Impuestos: retenciones, percepciones, débitos/créditos fiscales
      WHEN tipo_operacion ILIKE '%Créditos y Débitos%'
        OR LOWER(tipo_operacion) LIKE '%retencion%'
        OR LOWER(tipo_operacion) LIKE '%retención%'
        OR LOWER(tipo_operacion) LIKE '%ingresos brutos%'
        OR LOWER(tipo_operacion) LIKE '%iibb%'
        OR LOWER(tipo_operacion) LIKE '%iva%'
        OR LOWER(tipo_operacion) LIKE '%ganancias%'
        OR LOWER(tipo_operacion) LIKE '%impuesto%'
        THEN 'impuestos'

      -- Gastos financieros: costos de la plataforma MP
      WHEN tipo_operacion ILIKE '%Costo de Mercado Pago%'
        OR tipo_operacion ILIKE '%Costo por adelanto%'
        THEN 'gastos_financieros'

      -- Residual: devoluciones, compras ML, débitos por deuda → proveedores
      ELSE 'proveedores'
    END AS categoria,
    ABS(COALESCE(importe, 0)) AS monto
  FROM movimiento_mp
  WHERE COALESCE(importe, 0) < 0
    AND fecha >= '2024-01-01'
    -- Excluir anulaciones (son reversas de cobros, no egresos)
    AND tipo_operacion NOT ILIKE '%Anulación%'
),

mp_agg AS (
  SELECT
    p,
    SUM(CASE WHEN categoria = 'proveedores' THEN monto ELSE 0 END) AS proveedores,
    SUM(CASE WHEN categoria = 'impuestos' THEN monto ELSE 0 END) AS impuestos,
    SUM(CASE WHEN categoria = 'gastos_financieros' THEN monto ELSE 0 END) AS financieros,
    SUM(CASE WHEN categoria = 'transferencias' THEN monto ELSE 0 END) AS transferencias_out
  FROM mp_egresos
  GROUP BY p
)

-- ===========================================================================
-- FINAL SELECT
-- Consolida cobros, egresos (con netting), retiros, transferencias y
-- financiamiento en una fila por período.
-- ===========================================================================
SELECT
  m.p,

  -- COBROS OPERACIONALES
  COALESCE(c.efectivo, 0),
  COALESCE(bcp.cobros, 0) + COALESCE(bcs.cobros, 0),
  COALESCE(bcp.cobros, 0),
  COALESCE(bcs.cobros, 0),
  COALESCE(mi.ing, 0),

  -- EGRESOS OPERACIONALES (banco + MP, con netting aplicado)
  -- Proveedores: bruto - devoluciones CH/OE
  GREATEST(COALESCE(ba.proveedores, 0) + COALESCE(mp.proveedores, 0)
           - COALESCE(net.netting_proveedores, 0), 0),
  -- Sueldos: solo banco (no hay sueldos por MP)
  COALESCE(ba.sueldos, 0),
  -- Impuestos: bruto - reversas ARBA - reversas Ley 25413
  GREATEST(COALESCE(ba.impuestos, 0) + COALESCE(mp.impuestos, 0)
           - COALESCE(net.netting_impuestos, 0), 0),
  -- Gastos financieros
  COALESCE(ba.financieros, 0) + COALESCE(mp.financieros, 0),

  -- POR BANCO (solo operacionales, netting no se aplica por banco individual)
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


-- =============================================================================
-- RESUMEN DE CAMBIOS (para commit message):
--
-- refactor: rewrite get_flujo_fondos() con clasificador unificado y netting
--
-- - Unifica CASE clasificador de egresos: de 4 copias (~240 líneas) a 1 (~100 líneas)
-- - Agrega columna financiamiento_recibido (préstamos bancarios $106.6M + MP $3.8M)
-- - Netting: REVERSA RETENCION ARBA ($44.8M) y REV IMP LEY 25413 ($578k) restan de impuestos
-- - Netting: DEVOLUCION PAGO CH/OE ($32M) resta de proveedores
-- - Fix: PAGO LIQUIDACION VISA ($60.6M) movido de proveedores a gastos financieros
-- - Fix: transferencias ampliadas — BIP DB.TR N:NADAL Y ZACCAR ($24.7M),
--   Pago CCI interbank a cuenta propia ($9M), Santander→Provincia con CUIT
-- - Fix: depósitos de efectivo — patrones adicionales excluidos de cobros
--   (dep efvo, deposito cheque, deposito ch/oe)
-- - Fix: créditos propios excluidos via %30657033770% (catch-all para CUIT empresa)
-- - MP: "Retiro de dinero" ($318M) marcado como transferencia explícita
-- - MP: "Préstamo acreditado" ($3.8M) separado a financiamiento_recibido
-- - Excluye acreditaciones de préstamos y reversas/devoluciones de cobros banco
-- =============================================================================
