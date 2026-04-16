-- =============================================================================
-- 062_refactor_get_flujo_fondos_detalle.sql
-- Sync get_flujo_fondos_detalle() con la lógica de clasificación de 061
-- =============================================================================
--
-- Cambios vs. versión anterior:
--   1. CHEQUE POR VENTANILLA → retiros (antes caía en proveedores)
--   2. N:NADAL Y ZACCAR → transferencias (antes estaba en retiros; en 061
--      es transferencia Provincia→Santander a cuenta propia)
--   3. Santander→Provincia: interbank + transferencia con CUIT propio →
--      transferencias (antes caían en proveedores)
--   4. %arancel% genérico → financieros (antes solo matcheaba %arancel clave dni%)
--   5. MP residual → proveedores (antes caía en financieros; sync con 061)
--   6. MP: Costo de Mercado Pago / Costo por adelanto → financieros explícito
--   7. Depósitos adicionales en transf_banco_cred: dep efvo, deposito cheque,
--      deposito ch/oe, créditos con CUIT propio 30657033770
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_flujo_fondos_detalle(p_anio integer)
RETURNS TABLE(periodo text, concepto text, categoria text, subcategoria text, monto numeric, fuente text, banco text)
LANGUAGE sql
STABLE
SET statement_timeout TO '30s'
AS $function$

  -- =========================================================================
  -- BANK DEBITS — excluye transferencias y retiros (van a CTEs separados)
  -- =========================================================================
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

      -- EXCLUDE transfers (→ transf_banco_deb)
      AND COALESCE(concepto, '') NOT LIKE 'BIP DB TRANSFERENCIA%'
      AND LOWER(COALESCE(concepto, '')) NOT LIKE '%mercado pago%'
      AND LOWER(COALESCE(concepto, '')) NOT LIKE '%inviu%'
      AND LOWER(COALESCE(concepto, '')) NOT LIKE '%invertir%'
      AND LOWER(COALESCE(concepto, '')) NOT LIKE '%iol%invertir%'
      AND UPPER(COALESCE(concepto, '')) NOT LIKE '%N:NADAL Y ZACCAR%'
      -- 062: Santander→Provincia interbank a cuenta propia
      AND NOT (LOWER(COALESCE(concepto, '')) LIKE '%interbank%nadal y zaccaro%')
      -- 062: Santander→Provincia transferencia genérica con CUIT
      AND NOT (
        LOWER(COALESCE(concepto, '')) LIKE '%nadal y zaccaro%'
        AND COALESCE(concepto, '') LIKE '%30657033770%'
      )

      -- EXCLUDE retiros (→ retiros_detalle)
      AND COALESCE(concepto, '') NOT LIKE '%N:NADAL ANDREA%'
      AND COALESCE(concepto, '') NOT LIKE '%N:ZACCARO FABIAN%'
      AND COALESCE(concepto, '') NOT LIKE 'DEBITO TRANS.CAJERO AUT%'
      AND COALESCE(concepto, '') <> 'DEBITO EN CUENTA'
      -- 062: CHEQUE POR VENTANILLA → retiros (sync con 061)
      AND UPPER(COALESCE(concepto, '')) NOT LIKE '%CHEQUE POR VENTANILLA%'
  ),

  -- =========================================================================
  -- CLASIFICACIÓN DE DÉBITOS BANCARIOS
  -- CASE synced exactamente con 061 (mismo orden, mismos patrones)
  -- =========================================================================
  banco_clasificado AS (
    SELECT
      periodo, monto, concepto_lower, concepto_raw, banco,

      -- =====================================================================
      -- CATEGORÍA (synced con 061: sueldos → impuestos → financieros → proveedores)
      -- =====================================================================
      CASE
        -- =================================================================
        -- SUELDOS (061 sección 3)
        -- =================================================================
        WHEN concepto_raw LIKE 'DEB LOTE ZACCARO FABIAN%' THEN 'sueldos'
        WHEN concepto_raw LIKE 'DEB LOTE HABERES%' THEN 'sueldos'
        WHEN concepto_raw LIKE 'DEBITO POR PAGO DE HABERES%' THEN 'sueldos'
        WHEN concepto_lower LIKE '%haber%' THEN 'sueldos'
        WHEN concepto_lower LIKE '%sueldo%' THEN 'sueldos'
        WHEN concepto_lower LIKE '%remuner%' THEN 'sueldos'
        WHEN concepto_lower LIKE '%aguinaldo%' THEN 'sueldos'
        WHEN concepto_lower LIKE '%vacacion%' THEN 'sueldos'

        -- =================================================================
        -- IMPUESTOS (061 sección 4)
        -- Retenciones, percepciones, AFIP/ARBA/municipales, cargas sociales
        -- =================================================================

        -- ARBA
        WHEN concepto_lower LIKE '%retencion arba%' THEN 'impuestos'
        WHEN concepto_lower LIKE '%retencion iibb%' THEN 'impuestos'
        WHEN concepto_lower LIKE '%arba%' THEN 'impuestos'

        -- Pagos de servicios impositivos
        WHEN concepto_lower LIKE '%p.serv%ente950%' THEN 'impuestos'
        WHEN concepto_lower LIKE '%p.serv%ente270%' THEN 'impuestos'
        WHEN concepto_lower LIKE '%p.serv%municipali%' THEN 'impuestos'
        WHEN concepto_lower LIKE '%pago servicio por atm%' THEN 'impuestos'
        WHEN concepto_lower LIKE '%pago serv%' THEN 'impuestos'

        -- AFIP y organismos nacionales
        WHEN concepto_lower LIKE '%afip%' THEN 'impuestos'
        WHEN concepto_lower LIKE '%iibb%' THEN 'impuestos'
        WHEN concepto_lower LIKE '%ganancias%' THEN 'impuestos'
        WHEN concepto_lower LIKE '%monotributo%' THEN 'impuestos'
        WHEN concepto_lower LIKE '%municipalidad%' THEN 'impuestos'
        WHEN concepto_lower LIKE '%seguridad e higiene%' THEN 'impuestos'

        -- Ley 25413 (impuesto al cheque)
        WHEN concepto_lower LIKE '%ley 25413%'
          OR concepto_lower LIKE '%ley 25.413%'
          OR concepto_lower LIKE '%25413%'
          OR concepto_lower LIKE '%25.413%'
          THEN 'impuestos'

        -- Cargas sociales
        WHEN concepto_lower LIKE '%f.931%'
          OR concepto_lower LIKE '%f931%'
          THEN 'impuestos'
        WHEN concepto_lower LIKE '%sicoss%' THEN 'impuestos'

        -- Impuesto sobre débitos/créditos
        WHEN concepto_lower LIKE '%impuesto s/deb%'
          OR concepto_lower LIKE '%impuesto s/cred%'
          THEN 'impuestos'

        -- Aportes patronales, obra social, sindicato
        WHEN concepto_lower LIKE '%contribucion%patronal%' THEN 'impuestos'
        WHEN concepto_lower LIKE '%aporte%jubilat%' THEN 'impuestos'
        WHEN concepto_lower LIKE '%obra social%' THEN 'impuestos'
        WHEN concepto_lower LIKE '%sindicato%' THEN 'impuestos'

        -- Percepciones IIBB e IVA
        WHEN concepto_lower LIKE '%i.brutos%percepcion%'
          OR concepto_lower LIKE '%iibb%percepcion%'
          THEN 'impuestos'
        WHEN concepto_lower LIKE '%iva percepcion%'
          OR concepto_lower LIKE '%iva%rg 2408%'
          THEN 'impuestos'

        -- Formatos Santander
        WHEN concepto_lower LIKE 'impuesto i.brutos%' THEN 'impuestos'
        WHEN concepto_lower LIKE 'iva 21%%' THEN 'impuestos'
        WHEN concepto_lower LIKE 'impuesto ley 25.413%' THEN 'impuestos'
        WHEN concepto_lower LIKE 'impuesto iibb%' THEN 'impuestos'
        WHEN concepto_lower LIKE 'iibb percepcion%' THEN 'impuestos'
        WHEN concepto_lower LIKE 'iva percepcion%' THEN 'impuestos'
        WHEN concepto_lower LIKE 'afip -%' THEN 'impuestos'

        -- =================================================================
        -- GASTOS FINANCIEROS (061 sección 5)
        -- Préstamos, VISA/MC, comisiones, intereses, seguros, aranceles
        -- =================================================================

        -- Préstamos bancarios
        WHEN concepto_lower LIKE '%amortizacion%prestamo%'
          OR concepto_lower LIKE '%cuota prestamo%'
          OR concepto_lower LIKE '%cuota de prestamo%'
          OR concepto_lower LIKE '%pago cuota de prestamo%'
          THEN 'financieros'

        -- Pagos VISA/tarjetas
        WHEN concepto_lower LIKE 'pago visa%'
          OR concepto_lower LIKE '%pago tarjeta de credito visa%'
          OR concepto_lower LIKE '%pago liquidacion visa%'
          OR concepto_lower LIKE '%liquidacion visa%'
          THEN 'financieros'

        -- Comisiones bancarias
        WHEN concepto_lower LIKE '%comision%'
          OR concepto_lower LIKE '%comis.gestion cheque%'
          OR concepto_lower LIKE '%com. mant.%'
          OR concepto_lower LIKE '%com mant%'
          OR concepto_lower LIKE '%com.movim mensuales clearing%'
          THEN 'financieros'

        -- Intereses, mantenimiento, seguros
        WHEN concepto_lower LIKE '%interes%' THEN 'financieros'
        WHEN concepto_lower LIKE '%mantenimiento%' THEN 'financieros'
        WHEN concepto_lower LIKE '%seguro%' THEN 'financieros'

        -- Sellados
        WHEN concepto_lower LIKE '%sellado%'
          OR concepto_lower LIKE '%impuesto de sellos%'
          THEN 'financieros'

        -- Procesamiento tarjetas (VISA/MC en Santander — costo del comercio)
        WHEN concepto_lower LIKE '%cargo a comercios visa%'
          OR concepto_lower LIKE '%cargo a comercios mastercard%'
          THEN 'financieros'
        WHEN concepto_lower LIKE '%debito arreglo - visa%'
          OR concepto_lower LIKE '%debito arreglo - mastercard%'
          THEN 'financieros'
        WHEN concepto_lower LIKE '%contracargo a comercio%'
          THEN 'financieros'

        -- 062: Aranceles genérico (antes solo matcheaba %arancel clave dni%)
        WHEN concepto_lower LIKE '%arancel%' THEN 'financieros'

        -- =================================================================
        -- PROVEEDORES (residual)
        -- =================================================================
        ELSE 'proveedores'
      END AS categoria,

      -- =====================================================================
      -- CONCEPTO NORMALIZADO (para display en la tabla de detalle)
      -- =====================================================================
      CASE
        -- Impuestos
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
        -- Sueldos
        WHEN concepto_raw LIKE 'DEBITO POR PAGO DE HABERES%' THEN 'DEBITO POR PAGO DE HABERES'
        WHEN concepto_raw LIKE 'DEB LOTE ZACCARO FABIAN%' THEN 'DEB LOTE ZACCARO FABIAN'
        WHEN concepto_lower LIKE '%lote haberes%' THEN 'LOTE HABERES'
        WHEN concepto_lower LIKE '%pago de haberes%' OR concepto_lower LIKE '%pago haberes%'
        THEN 'PAGO DE HABERES'
        -- Percepciones
        WHEN concepto_lower LIKE '%i.brutos%percepcion%' OR concepto_lower LIKE '%iibb%percepcion%'
          OR concepto_lower LIKE 'iibb percepcion%'
        THEN 'PERCEPCION IIBB'
        WHEN concepto_lower LIKE '%iva percepcion%' OR concepto_lower LIKE '%iva%rg 2408%'
          OR concepto_lower LIKE 'iva percepcion%'
        THEN 'PERCEPCION IVA (RG 2408)'
        -- Formatos Santander
        WHEN concepto_lower LIKE 'iva 21%%' THEN 'IVA 21%'
        WHEN concepto_lower LIKE 'impuesto i.brutos%' THEN 'IMPUESTO INGRESOS BRUTOS'
        WHEN concepto_lower LIKE 'impuesto iibb%' THEN 'IMPUESTO IIBB'
        WHEN concepto_lower LIKE 'afip -%' THEN 'AFIP'
        WHEN concepto_lower LIKE '%pago servicio por atm%' THEN 'PAGO SERVICIO POR ATM (AFIP)'
        WHEN concepto_lower LIKE '%pago servicios varios%' THEN 'PAGO SERVICIOS VARIOS (AFIP)'
        -- Proveedores especiales
        WHEN concepto_lower LIKE '%federacion patr%' THEN 'FEDERACION PATRONAL (Seguro)'
        -- Financieros
        WHEN concepto_lower LIKE '%com. mant.%' OR concepto_lower LIKE '%com mant%'
        THEN 'COMISION MANTENIMIENTO'
        WHEN concepto_lower LIKE '%cargo a comercios visa%' THEN 'CARGO COMERCIOS VISA'
        WHEN concepto_lower LIKE '%cargo a comercios mastercard%' THEN 'CARGO COMERCIOS MASTERCARD'
        WHEN concepto_lower LIKE '%debito arreglo - visa%' THEN 'DEBITO ARREGLO VISA'
        WHEN concepto_lower LIKE '%debito arreglo - mastercard%' THEN 'DEBITO ARREGLO MASTERCARD'
        WHEN concepto_lower LIKE '%contracargo a comercio%' THEN 'CONTRACARGO COMERCIO'
        WHEN concepto_lower LIKE '%pago tarjeta de credito visa%' THEN 'PAGO TARJETA VISA'
        WHEN concepto_lower LIKE '%pago liquidacion visa%' THEN 'PAGO LIQUIDACION VISA'
        WHEN concepto_lower LIKE '%liquidacion visa%' THEN 'LIQUIDACION VISA'
        WHEN concepto_lower LIKE 'pago visa%' THEN 'PAGO VISA'
        -- 062: aranceles — primero específico, luego genérico
        WHEN concepto_lower LIKE '%arancel clave dni%' THEN 'ARANCEL CLAVE DNI'
        WHEN concepto_lower LIKE '%arancel%' THEN 'ARANCEL'
        WHEN concepto_lower LIKE '%impuesto de sellos%' THEN 'IMPUESTO DE SELLOS'
        WHEN concepto_lower LIKE '%comis.gestion cheque%' THEN 'COMISION GESTION CHEQUE'
        WHEN concepto_lower LIKE '%com.movim mensuales clearing%' THEN 'COMISION CLEARING'
        ELSE LEFT(UPPER(TRIM(concepto_raw)), 40)
      END AS concepto_norm,

      -- =====================================================================
      -- SUBCATEGORIA (solo para impuestos)
      -- =====================================================================
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

  -- Final bank rows
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

  -- =========================================================================
  -- RETIROS SOCIOS
  -- 062: Agregado CHEQUE POR VENTANILLA (antes caía en proveedores)
  -- 062: Removido N:NADAL Y ZACCAR (es transferencia en 061, no retiro)
  -- =========================================================================
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
        -- 062: nuevo patrón
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
        -- 062: N:NADAL Y ZACCAR removido (ahora en transf_banco_deb)
        OR COALESCE(concepto, '') LIKE 'DEBITO TRANS.CAJERO AUT%'
        OR COALESCE(concepto, '') = 'DEBITO EN CUENTA'
        -- 062: nuevo
        OR UPPER(COALESCE(concepto, '')) LIKE '%CHEQUE POR VENTANILLA%'
      )
      AND COALESCE(concepto, '') NOT LIKE 'DEB LOTE ZACCARO%'
      AND COALESCE(concepto, '') NOT LIKE '%PAGO DE HABERES%'
  ),

  -- =========================================================================
  -- TRANSFERENCIAS (débitos bancarios)
  -- 062: Agregado N:NADAL Y ZACCAR (movido desde retiros)
  -- 062: Agregado Santander→Provincia (interbank + CUIT propio)
  -- =========================================================================
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
        -- 062: Provincia→Santander (N:NADAL Y ZACCAR, movido desde retiros)
        WHEN UPPER(COALESCE(concepto, '')) LIKE '%N:NADAL Y ZACCAR%'
        THEN 'TRANSF. PROV→SANT (NADAL Y ZACCARO)'
        -- 062: Santander→Provincia interbank
        WHEN LOWER(COALESCE(concepto, '')) LIKE '%interbank%nadal y zaccaro%'
        THEN 'TRANSF. SANT→PROV (INTERBANK)'
        -- 062: Santander→Provincia con CUIT
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
        -- 062: Provincia→Santander
        OR UPPER(COALESCE(concepto, '')) LIKE '%N:NADAL Y ZACCAR%'
        -- 062: Santander→Provincia
        OR LOWER(COALESCE(concepto, '')) LIKE '%interbank%nadal y zaccaro%'
        OR (
          LOWER(COALESCE(concepto, '')) LIKE '%nadal y zaccaro%'
          AND COALESCE(concepto, '') LIKE '%30657033770%'
        )
      )
  ),

  -- =========================================================================
  -- TRANSFERENCIAS (créditos bancarios)
  -- 062: Agregado patrones de depósito y créditos con CUIT propio
  -- =========================================================================
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
        -- 062: patrones adicionales de depósito (sync con 061)
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
        -- 062: créditos desde cuenta propia con CUIT
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
        -- 062: depósitos adicionales
        OR LOWER(COALESCE(concepto, '')) LIKE 'dep efvo%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%deposito cheque%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%deposito ch/oe%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%mercado pago%'
        OR COALESCE(concepto, '') LIKE '%N:NADAL Y ZACCAR%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%inviu%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%invertir%'
        OR LOWER(COALESCE(concepto, '')) LIKE '%iol%invertir%'
        -- 062: créditos desde cuenta propia
        OR COALESCE(concepto, '') LIKE '%30657033770%'
      )
  ),

  -- =========================================================================
  -- MP TRANSFERENCIAS (sin cambios)
  -- =========================================================================
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

  -- =========================================================================
  -- MP EGRESOS CLASIFICADOS
  -- 062: Synced con 061:
  --   - Costo de Mercado Pago / Costo por adelanto → financieros (explícito)
  --   - ELSE → proveedores (antes era financieros)
  -- =========================================================================
  mp_clasificado AS (
    SELECT
      TO_CHAR(fecha, 'YYYY-MM') AS periodo,
      'MP: ' || COALESCE(tipo_operacion, '') AS concepto,
      CASE
        -- Proveedores: pagos directos y transferencias a terceros
        WHEN COALESCE(tipo_operacion, '') IN ('Pago', 'Movimiento General')
        THEN 'proveedores'
        WHEN COALESCE(tipo_operacion, '') ILIKE '%Transferencia%'
        THEN 'proveedores'

        -- Impuestos: retenciones, percepciones, débitos/créditos fiscales
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

        -- 062: Gastos financieros explícitos (sync con 061)
        WHEN COALESCE(tipo_operacion, '') ILIKE '%Costo de Mercado Pago%'
          OR COALESCE(tipo_operacion, '') ILIKE '%Costo por adelanto%'
        THEN 'financieros'

        -- 062: Residual → proveedores (antes era financieros, sync con 061)
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

  -- =========================================================================
  -- UNION ALL + GROUP BY
  -- =========================================================================
  all_movs AS (
    SELECT * FROM banco_final
    UNION ALL
    SELECT * FROM retiros_detalle
    UNION ALL
    SELECT * FROM transf_banco_deb
    UNION ALL
    SELECT * FROM transf_banco_cred
    UNION ALL
    SELECT * FROM transf_mp
    UNION ALL
    SELECT * FROM mp_clasificado
  )

  SELECT
    periodo,
    concepto,
    categoria,
    subcategoria,
    SUM(monto) AS monto,
    fuente,
    banco
  FROM all_movs
  GROUP BY periodo, concepto, categoria, subcategoria, fuente, banco
  ORDER BY periodo, categoria, monto DESC;

$function$;


-- =============================================================================
-- ROLLBACK (si es necesario revertir al estado anterior):
--
-- -- Restaurar la versión previa ejecutando el SQL original de la función
-- -- que está en el dump de pg_get_functiondef() tomado antes de aplicar 062.
-- -- No hay cambio de tipo de retorno, así que un simple CREATE OR REPLACE
-- -- con la definición anterior es suficiente.
-- =============================================================================
