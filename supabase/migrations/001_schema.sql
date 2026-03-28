-- ============================================================================
-- San Luis — Schema de base de datos v2
-- Nadal y Zaccaro S.A. (Confitería San Luis)
-- 27 tablas + 21 ENUMs + 14 índices
-- Fecha: 2026-03-28
-- ============================================================================

-- ============================================================================
-- TIPOS ENUM
-- ============================================================================

CREATE TYPE tipo_costo_enum AS ENUM ('fijo', 'variable');

CREATE TYPE fuente_venta_enum AS ENUM ('pos', 'arca');

CREATE TYPE estado_factura_emitida_enum AS ENUM ('pendiente', 'cobrada', 'parcial', 'anulada');

CREATE TYPE estado_factura_recibida_enum AS ENUM ('pendiente', 'pagada', 'parcial', 'anulada');

CREATE TYPE fuente_egreso_enum AS ENUM (
    'arca', 'payroll', 'banco_provincia', 'banco_santander',
    'arba', 'municipio', 'contador', 'caja_chica', 'mp'
);

CREATE TYPE fuente_liquidacion_enum AS ENUM ('transferencia', 'f931', 'recibo');

CREATE TYPE banco_enum AS ENUM ('provincia', 'santander');

CREATE TYPE moneda_enum AS ENUM ('ARS', 'USD');

CREATE TYPE tipo_tenencia_enum AS ENUM (
    'cuenta_bancaria', 'caja_pesos', 'caja_dolares', 'plazo_fijo',
    'fci', 'cheque', 'billetera_digital', 'broker'
);

CREATE TYPE tipo_inversion_enum AS ENUM ('bono', 'accion', 'fci', 'plazo_fijo', 'moneda', 'otro');

CREATE TYPE estado_inversion_enum AS ENUM ('vigente', 'vendida', 'vencida');

CREATE TYPE tipo_impuesto_enum AS ENUM (
    'iva', 'ganancias', 'iibb', 'tasa_seguridad_higiene',
    'tasa_publicidad_propaganda', 'tasa_ocupacion_espacio_publico', 'debitos_creditos'
);

CREATE TYPE estado_impuesto_enum AS ENUM ('pendiente', 'pagado', 'parcial', 'vencido');

CREATE TYPE fuente_impuesto_enum AS ENUM ('arca', 'arba', 'municipio');

CREATE TYPE plataforma_social_enum AS ENUM ('instagram', 'facebook');

CREATE TYPE tipo_indicador_macro_enum AS ENUM (
    'ipc', 'dolar_oficial', 'dolar_mep', 'dolar_ccl', 'tasa_bcra', 'emae'
);

CREATE TYPE seccion_balance_enum AS ENUM (
    'activo_corriente', 'activo_no_corriente', 'pasivo_corriente',
    'pasivo_no_corriente', 'patrimonio_neto'
);

CREATE TYPE seccion_eerr_enum AS ENUM (
    'ingresos', 'costo_operativo', 'gasto_administracion', 'gasto_comercializacion',
    'gasto_financiero', 'otros_ingresos', 'impuestos', 'resultado'
);

CREATE TYPE estado_accion_comercial_enum AS ENUM ('planificada', 'activa', 'finalizada');

CREATE TYPE tipo_archivo_enum AS ENUM ('csv', 'excel', 'txt', 'pdf', 'zip', 'api', 'manual', 'png');

CREATE TYPE estado_fuente_datos_enum AS ENUM ('actualizado', 'desactualizado', 'error');


-- ============================================================================
-- GRUPO 1: ENTIDADES DE REFERENCIA (sin FKs)
-- ============================================================================

-- Ficha de la empresa Nadal y Zaccaro S.A.
CREATE TABLE empresa (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    razon_social        TEXT NOT NULL,
    nombre_fantasia     TEXT,
    cuit                TEXT NOT NULL,
    domicilio_legal     TEXT,
    actividad_principal TEXT,
    fecha_estatuto      DATE,
    fecha_vto_vigencia  DATE,
    matricula           TEXT,
    legajo              TEXT,
    numero_comercio_apr TEXT,
    regimen_iva         TEXT,
    regimen_ganancias   TEXT,
    regimen_iibb        TEXT,
    capital_acciones    NUMERIC(15,2),
    capital_suscripto   NUMERIC(15,2),
    capital_integrado   NUMERIC(15,2),
    datos_contacto      TEXT,
    responsables        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE empresa IS 'Ficha institucional de Nadal y Zaccaro S.A. (Confitería San Luis)';

-- Unidades de negocio: Servicios, Mostrador, Terraza, Decoración
CREATE TABLE unidad_negocio (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre      TEXT NOT NULL,
    activa      BOOLEAN NOT NULL DEFAULT true,
    descripcion TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE unidad_negocio IS 'Unidades de negocio: Servicios (catering), Mostrador, Terraza, Decoración';

-- Categorías de egreso con clasificación fijo/variable para análisis de costos
CREATE TABLE categoria_egreso (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre          TEXT NOT NULL,
    tipo_costo      tipo_costo_enum NOT NULL,
    fuente_default  TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE categoria_egreso IS 'Categorías de egresos con tipo de costo (fijo/variable) para análisis de costos';


-- ============================================================================
-- GRUPO 2: REFERENCIA CON FKs SIMPLES
-- ============================================================================

-- Categorías/familias de producto del POS
CREATE TABLE categoria_producto (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    unidad_negocio_id   BIGINT REFERENCES unidad_negocio(id),
    nombre              TEXT NOT NULL,
    codigo_pos          TEXT,
    activa              BOOLEAN NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE categoria_producto IS 'Categorías/familias de producto del sistema POS (ej: FACTURAS SURTIDAS, SERVICIO DE CATERING)';


-- ============================================================================
-- GRUPO 3: PERSONAS Y ORGANIZACIONES
-- ============================================================================

-- Clientes extraídos de ARCA ventas y POS
CREATE TABLE cliente (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    razon_social    TEXT NOT NULL,
    cuit            TEXT,
    tipo_doc        INTEGER,
    domicilio       TEXT,
    telefono        TEXT,
    email           TEXT,
    condicion_pago  TEXT,
    notas           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE cliente IS 'Clientes de la empresa, extraídos de comprobantes ARCA y tickets POS';

-- Proveedores extraídos de ARCA compras
CREATE TABLE proveedor (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    razon_social    TEXT NOT NULL,
    cuit            TEXT,
    tipo_doc        INTEGER,
    domicilio       TEXT,
    telefono        TEXT,
    email           TEXT,
    condicion_pago  TEXT,
    rubro           TEXT,
    notas           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE proveedor IS 'Proveedores de la empresa, extraídos de comprobantes ARCA compras';

-- Empleados con relación jerárquica (organigrama)
CREATE TABLE empleado (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre              TEXT NOT NULL,
    cuil                TEXT,
    cuenta_bancaria     TEXT,
    fecha_ingreso       DATE,
    puesto              TEXT,
    unidad_negocio_id   BIGINT REFERENCES unidad_negocio(id),
    reporta_a_id        BIGINT REFERENCES empleado(id),
    activo              BOOLEAN NOT NULL DEFAULT true,
    notas               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE empleado IS 'Empleados con relación jerárquica para organigrama. Fuente: transferencias XLSX y carga manual';


-- ============================================================================
-- GRUPO 4: FINANCIERO (tablas sin FKs a otras tablas de negocio)
-- ============================================================================

-- Movimientos de extractos bancarios (Banco Provincia TXT + Banco Santander PDF)
CREATE TABLE movimiento_bancario (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fecha       DATE NOT NULL,
    banco       banco_enum NOT NULL,
    cuenta      TEXT,
    cbu         TEXT,
    moneda      moneda_enum NOT NULL DEFAULT 'ARS',
    comprobante TEXT,
    concepto    TEXT,
    debito      NUMERIC(15,2),
    credito     NUMERIC(15,2),
    importe     NUMERIC(15,2) NOT NULL,
    fecha_valor DATE,
    saldo       NUMERIC(15,2),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE movimiento_bancario IS 'Movimientos bancarios: Banco Provincia (TXT, cuenta 50080/7) y Banco Santander (PDF, cuenta 019-006261/3)';

-- Movimientos de caja del sistema POS (~56k registros/año)
CREATE TABLE movimiento_caja (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fecha           TIMESTAMPTZ NOT NULL,
    condicion_pago  TEXT,
    documento       TEXT,
    punto_venta     INTEGER,
    numero          INTEGER,
    importe         NUMERIC(15,2) NOT NULL,
    tipo            TEXT,
    observacion     TEXT,
    tarjeta         TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE movimiento_caja IS 'Movimientos de caja del POS: efectivo, débito, crédito, QR, MP. ~56k registros/año';

-- Movimientos de Mercado Pago (~5.4k registros/año)
CREATE TABLE movimiento_mp (
    id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fecha                   TIMESTAMPTZ NOT NULL,
    tipo_operacion          TEXT,
    numero_movimiento       TEXT,
    operacion_relacionada   TEXT,
    importe                 NUMERIC(15,2) NOT NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE movimiento_mp IS 'Movimientos de Mercado Pago: cobros, pagos, rendimientos, impuestos. Fuente: XLSX mensual';

-- Foto de saldos y tenencias financieras
CREATE TABLE tenencia (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fecha           DATE NOT NULL,
    tipo            tipo_tenencia_enum NOT NULL,
    denominacion    TEXT,
    moneda          moneda_enum NOT NULL DEFAULT 'ARS',
    saldo           NUMERIC(15,2),
    saldo_ars       NUMERIC(15,2),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE tenencia IS 'Foto periódica de saldos: cuentas bancarias, caja, plazo fijo, FCI, cheques, billeteras digitales';

-- Posiciones de inversión financiera (broker InvertirOnline)
CREATE TABLE inversion (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    broker              TEXT,
    cuenta_comitente    TEXT,
    ticker              TEXT,
    nombre              TEXT,
    tipo                tipo_inversion_enum,
    moneda              moneda_enum NOT NULL DEFAULT 'ARS',
    cantidad            NUMERIC(15,4),
    garantia            NUMERIC(15,4),
    disponibles         NUMERIC(15,4),
    precio_compra       NUMERIC(15,4),
    costo_total         NUMERIC(15,2),
    valuacion_precio    NUMERIC(15,4),
    valuacion_monto     NUMERIC(15,2),
    valuacion_usd       NUMERIC(15,2),
    resultado           NUMERIC(15,2),
    variacion_pct       NUMERIC(8,4),
    fecha_valuacion     DATE,
    estado              estado_inversion_enum NOT NULL DEFAULT 'vigente',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE inversion IS 'Posiciones de inversión del broker (InvertirOnline, comitente 243279). Bonos, acciones, FCI, moneda';

-- Movimientos de cuenta corriente del broker
CREATE TABLE inversion_movimiento (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fecha_concertacion  DATE,
    fecha_liquidacion   DATE,
    descripcion         TEXT,
    tipo_operacion      TEXT,
    ticker              TEXT,
    cantidad_vn         NUMERIC(15,4),
    precio              NUMERIC(15,4),
    importe_bruto       NUMERIC(15,2),
    importe_neto        NUMERIC(15,2),
    saldo               NUMERIC(15,2),
    moneda              moneda_enum NOT NULL DEFAULT 'ARS',
    seccion             TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE inversion_movimiento IS 'Movimientos de cuenta corriente del broker: compras, ventas, cobros de renta, amortizaciones';


-- ============================================================================
-- GRUPO 5: COMPROBANTES ARCA
-- ============================================================================

-- Comprobantes emitidos (fuente: ARCA ventas CSV y Libro IVA Ventas ZIP)
CREATE TABLE factura_emitida (
    id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fecha_emision           DATE NOT NULL,
    tipo_comprobante        INTEGER NOT NULL,
    punto_venta             INTEGER,
    numero_desde            INTEGER,
    numero_hasta            INTEGER,
    cod_autorizacion        TEXT,
    tipo_doc_receptor       INTEGER,
    nro_doc_receptor        TEXT,
    denominacion_receptor   TEXT,
    moneda                  TEXT DEFAULT '$',
    tipo_cambio             NUMERIC(10,4),
    iva_0_neto              NUMERIC(15,2),
    iva_2_5                 NUMERIC(15,2),
    iva_2_5_neto            NUMERIC(15,2),
    iva_5                   NUMERIC(15,2),
    iva_5_neto              NUMERIC(15,2),
    iva_10_5                NUMERIC(15,2),
    iva_10_5_neto           NUMERIC(15,2),
    iva_21                  NUMERIC(15,2),
    iva_21_neto             NUMERIC(15,2),
    iva_27                  NUMERIC(15,2),
    iva_27_neto             NUMERIC(15,2),
    imp_neto_gravado_total  NUMERIC(15,2),
    imp_neto_no_gravado     NUMERIC(15,2),
    imp_op_exentas          NUMERIC(15,2),
    otros_tributos          NUMERIC(15,2),
    total_iva               NUMERIC(15,2),
    imp_total               NUMERIC(15,2),
    estado                  estado_factura_emitida_enum NOT NULL DEFAULT 'pendiente',
    fecha_vencimiento_pago  DATE,
    fecha_cobro             DATE,
    cliente_id              BIGINT REFERENCES cliente(id),
    unidad_negocio_id       BIGINT REFERENCES unidad_negocio(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE factura_emitida IS 'Comprobantes emitidos (ARCA ventas). 6 alícuotas IVA, estado de cobranza para cuentas por cobrar';

-- Comprobantes recibidos de proveedores (fuente: ARCA compras CSV)
CREATE TABLE factura_recibida (
    id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fecha_emision           DATE NOT NULL,
    tipo_comprobante        INTEGER NOT NULL,
    punto_venta             INTEGER,
    numero_desde            INTEGER,
    numero_hasta            INTEGER,
    cod_autorizacion        TEXT,
    tipo_doc_emisor         INTEGER,
    nro_doc_emisor          TEXT,
    denominacion_emisor     TEXT,
    tipo_doc_receptor       INTEGER,
    nro_doc_receptor        TEXT,
    moneda                  TEXT DEFAULT '$',
    tipo_cambio             NUMERIC(10,4),
    iva_0_neto              NUMERIC(15,2),
    iva_2_5                 NUMERIC(15,2),
    iva_2_5_neto            NUMERIC(15,2),
    iva_5                   NUMERIC(15,2),
    iva_5_neto              NUMERIC(15,2),
    iva_10_5                NUMERIC(15,2),
    iva_10_5_neto           NUMERIC(15,2),
    iva_21                  NUMERIC(15,2),
    iva_21_neto             NUMERIC(15,2),
    iva_27                  NUMERIC(15,2),
    iva_27_neto             NUMERIC(15,2),
    imp_neto_gravado_total  NUMERIC(15,2),
    imp_neto_no_gravado     NUMERIC(15,2),
    imp_op_exentas          NUMERIC(15,2),
    otros_tributos          NUMERIC(15,2),
    total_iva               NUMERIC(15,2),
    imp_total               NUMERIC(15,2),
    estado                  estado_factura_recibida_enum NOT NULL DEFAULT 'pendiente',
    fecha_vencimiento_pago  DATE,
    fecha_pago              DATE,
    proveedor_id            BIGINT REFERENCES proveedor(id),
    categoria_egreso_id     BIGINT REFERENCES categoria_egreso(id),
    categoria_corregida     BOOLEAN NOT NULL DEFAULT false,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE factura_recibida IS 'Comprobantes recibidos de proveedores (ARCA compras). Categorización de egreso auto+manual';


-- ============================================================================
-- GRUPO 6: VENTAS
-- ============================================================================

-- Header de cada ticket/factura de venta (POS + ARCA servicios)
CREATE TABLE venta (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_venta_pos        TEXT,
    fecha               TIMESTAMPTZ NOT NULL,
    unidad_negocio_id   BIGINT REFERENCES unidad_negocio(id),
    fuente              fuente_venta_enum NOT NULL,
    tipo_comprobante    TEXT,
    punto_venta         INTEGER,
    numero              INTEGER,
    comprobante         TEXT,
    condicion_venta     TEXT,
    condicion_pago      TEXT,
    cliente_id          BIGINT REFERENCES cliente(id),
    cliente_nombre      TEXT,
    cliente_cuit        TEXT,
    monto_total         NUMERIC(15,2),
    monto_neto          NUMERIC(15,2),
    monto_iva           NUMERIC(15,2),
    anulado             BOOLEAN NOT NULL DEFAULT false,
    operador            TEXT,
    factura_emitida_id  BIGINT REFERENCES factura_emitida(id),
    notas               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE venta IS 'Header de tickets/facturas de venta. Fuente POS (mostrador) o ARCA (servicios). ~5k registros/mes';

-- Líneas de detalle por producto dentro de cada ticket
CREATE TABLE venta_detalle (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    venta_id            BIGINT NOT NULL REFERENCES venta(id),
    id_producto_pos     TEXT,
    codigo_producto     TEXT,
    producto            TEXT,
    costo               NUMERIC(15,2),
    precio_unitario     NUMERIC(15,2),
    cantidad            NUMERIC(10,3),
    neto                NUMERIC(15,2),
    descuentos          NUMERIC(15,2),
    impuestos           NUMERIC(15,2),
    familia             TEXT,
    proveedor_pos       TEXT,
    ean                 TEXT,
    alicuota_iva        NUMERIC(5,2),
    alicuota_dgr        NUMERIC(5,2),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE venta_detalle IS 'Detalle por producto de cada ticket de venta. 31 columnas del POS XLSX mapeadas aquí';


-- ============================================================================
-- GRUPO 7: PERSONAL
-- ============================================================================

-- Liquidaciones de sueldo (transferencias XLSX + F931 + recibos)
CREATE TABLE liquidacion_sueldo (
    id                          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    empleado_id                 BIGINT NOT NULL REFERENCES empleado(id),
    periodo                     TEXT NOT NULL,
    sueldo_bruto                NUMERIC(15,2),
    aportes_empleado            NUMERIC(15,2),
    sueldo_neto                 NUMERIC(15,2),
    contribuciones_patronales   NUMERIC(15,2),
    art                         NUMERIC(15,2),
    costo_total_empresa         NUMERIC(15,2),
    horas_extra                 NUMERIC(10,2),
    dias_ausencia               INTEGER,
    cuenta_beneficiario         TEXT,
    situacion_transferencia     TEXT,
    fecha_transferencia         DATE,
    fuente                      fuente_liquidacion_enum NOT NULL DEFAULT 'transferencia',
    notas                       TEXT,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE liquidacion_sueldo IS 'Liquidaciones de sueldo. Fuente primaria: transferencias XLSX (solo neto+CBU). Campos bruto/aportes desde F931';


-- ============================================================================
-- GRUPO 8: IMPUESTOS
-- ============================================================================

-- Obligaciones impositivas: IVA, Ganancias, IIBB, tasas municipales
CREATE TABLE impuesto_obligacion (
    id                          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tipo                        tipo_impuesto_enum NOT NULL,
    periodo                     TEXT NOT NULL,
    monto_determinado           NUMERIC(15,2),
    saldo_favor                 NUMERIC(15,2),
    posicion_neta               NUMERIC(15,2),
    compensaciones_recibidas    NUMERIC(15,2),
    compensaciones_enviadas     NUMERIC(15,2),
    estado                      estado_impuesto_enum NOT NULL DEFAULT 'pendiente',
    fecha_vencimiento           DATE,
    fecha_2do_vto               DATE,
    recargo_2do_vto             NUMERIC(15,2),
    numero_boleta               TEXT,
    numero_tasa                 TEXT,
    formulario                  TEXT,
    codigo_impuesto             TEXT,
    fuente                      fuente_impuesto_enum,
    observaciones               TEXT,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE impuesto_obligacion IS 'Obligaciones impositivas: IVA, Ganancias, IIBB (ARBA), tasas municipales (seg e higiene, publicidad, ocupación)';

-- Pagos de impuestos (fuente: ARCA VEP CSV)
CREATE TABLE pago_impuesto (
    id                          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    impuesto_obligacion_id      BIGINT REFERENCES impuesto_obligacion(id),
    fecha_pago                  DATE NOT NULL,
    monto                       NUMERIC(15,2) NOT NULL,
    medio_pago                  TEXT,
    numero_vep                  TEXT,
    formulario                  TEXT,
    version                     TEXT,
    observaciones               TEXT,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE pago_impuesto IS 'Pagos de impuestos vía VEP. Fuente: CSV de impuestos nacionales con wrapping ="..." ';


-- ============================================================================
-- GRUPO 9: EGRESOS (último por tener más FKs)
-- ============================================================================

-- Registro unificado de todos los egresos de la empresa
CREATE TABLE egreso (
    id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fecha                   DATE NOT NULL,
    concepto                TEXT,
    monto                   NUMERIC(15,2) NOT NULL,
    categoria_egreso_id     BIGINT REFERENCES categoria_egreso(id),
    fuente                  fuente_egreso_enum NOT NULL,
    factura_recibida_id     BIGINT REFERENCES factura_recibida(id),
    liquidacion_sueldo_id   BIGINT REFERENCES liquidacion_sueldo(id),
    movimiento_bancario_id  BIGINT REFERENCES movimiento_bancario(id),
    pago_impuesto_id        BIGINT REFERENCES pago_impuesto(id),
    categoria_corregida     BOOLEAN NOT NULL DEFAULT false,
    notas                   TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE egreso IS 'Hub central de egresos. Vincula 7+ fuentes: ARCA, sueldos, bancos, impuestos, caja chica, MP';


-- ============================================================================
-- GRUPO 10: MARKETING, MACRO, EECC Y SISTEMA
-- ============================================================================

-- Acciones comerciales y promociones
CREATE TABLE accion_comercial (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    titulo              TEXT NOT NULL,
    descripcion         TEXT,
    fecha_inicio        DATE,
    fecha_fin           DATE,
    unidad_negocio_id   BIGINT REFERENCES unidad_negocio(id),
    estado              estado_accion_comercial_enum NOT NULL DEFAULT 'planificada',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE accion_comercial IS 'Acciones comerciales y promociones por unidad de negocio';

-- Métricas de redes sociales (Instagram/Facebook)
CREATE TABLE metrica_red_social (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fecha           DATE NOT NULL,
    plataforma      plataforma_social_enum NOT NULL,
    seguidores      INTEGER,
    alcance         INTEGER,
    engagement      NUMERIC(8,4),
    publicaciones   INTEGER,
    interacciones   INTEGER,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE metrica_red_social IS 'Métricas de redes sociales. Fuente: API Instagram Graph / Meta Business Suite';

-- Indicadores macroeconómicos (IPC, dólar, tasa BCRA)
CREATE TABLE indicador_macro (
    id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tipo                    tipo_indicador_macro_enum NOT NULL,
    fecha                   DATE NOT NULL,
    valor                   NUMERIC(15,4) NOT NULL,
    variacion_mensual       NUMERIC(8,4),
    variacion_interanual    NUMERIC(8,4),
    fuente_api              TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE indicador_macro IS 'Indicadores macro: IPC (ajuste por inflación), dólar oficial/MEP/CCL, tasa BCRA, EMAE';

-- Rubros del balance por ejercicio contable
CREATE TABLE balance_rubro (
    id                          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ejercicio                   TEXT NOT NULL,
    fecha_cierre                DATE NOT NULL,
    seccion                     seccion_balance_enum NOT NULL,
    nota_numero                 INTEGER,
    rubro                       TEXT NOT NULL,
    subrubro                    TEXT,
    monto                       NUMERIC(15,2),
    monto_ejercicio_anterior    NUMERIC(15,2),
    orden                       INTEGER,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE balance_rubro IS 'Rubros del balance general por ejercicio. Fuente: EECC del contador (PDF/XLSX)';

-- Estado de resultados del contador (no el calculado por la app)
CREATE TABLE estado_resultados_contable (
    id                          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ejercicio                   TEXT NOT NULL,
    fecha_cierre                DATE NOT NULL,
    linea                       TEXT NOT NULL,
    seccion                     seccion_eerr_enum NOT NULL,
    monto                       NUMERIC(15,2),
    monto_ejercicio_anterior    NUMERIC(15,2),
    anexo_referencia            TEXT,
    orden                       INTEGER,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE estado_resultados_contable IS 'Estado de resultados del contador. Fuente: EECC PDF/XLSX. El EERR calculado se arma en la app';

-- Registro de fuentes de datos importadas
CREATE TABLE fuente_datos (
    id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre                  TEXT NOT NULL,
    tipo_archivo            tipo_archivo_enum NOT NULL,
    encoding                TEXT,
    separador               TEXT,
    modulo_destino          TEXT,
    ultima_actualizacion    TIMESTAMPTZ,
    registros_cargados      INTEGER DEFAULT 0,
    ultimo_error            TEXT,
    estado                  estado_fuente_datos_enum NOT NULL DEFAULT 'desactualizado',
    frecuencia_esperada     TEXT,
    notas_formato           TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE fuente_datos IS 'Gestión de datasets importados: estado, encoding, errores, frecuencia de actualización';


-- ============================================================================
-- ÍNDICES RECOMENDADOS
-- ============================================================================

-- Ventas: consultas por período y unidad de negocio
CREATE INDEX idx_venta_fecha_unidad_fuente
    ON venta (fecha, unidad_negocio_id, fuente);

-- Detalle de ventas: análisis por producto y familia
CREATE INDEX idx_venta_detalle_venta_producto
    ON venta_detalle (venta_id, codigo_producto, familia);

-- Facturas emitidas: aging de cuentas por cobrar
CREATE INDEX idx_factura_emitida_cliente_estado_vto
    ON factura_emitida (cliente_id, estado, fecha_vencimiento_pago);

-- Facturas recibidas: aging de cuentas por pagar
CREATE INDEX idx_factura_recibida_proveedor_estado_vto
    ON factura_recibida (proveedor_id, estado, fecha_vencimiento_pago);

-- Egresos: filtros frecuentes por fecha, categoría y fuente
CREATE INDEX idx_egreso_fecha_categoria_fuente
    ON egreso (fecha, categoria_egreso_id, fuente);

-- Movimientos bancarios: flujo de fondos por banco y cuenta
CREATE INDEX idx_movimiento_bancario_fecha_banco_cuenta
    ON movimiento_bancario (fecha, banco, cuenta);

-- Movimientos de caja: análisis por medio de pago
CREATE INDEX idx_movimiento_caja_fecha_condicion
    ON movimiento_caja (fecha, condicion_pago);

-- Movimientos Mercado Pago: análisis por tipo de operación
CREATE INDEX idx_movimiento_mp_fecha_tipo
    ON movimiento_mp (fecha, tipo_operacion);

-- Liquidaciones de sueldo: consulta por empleado y período
CREATE INDEX idx_liquidacion_sueldo_empleado_periodo
    ON liquidacion_sueldo (empleado_id, periodo);

-- Indicadores macro: ajuste por IPC y consultas de tipo+fecha
CREATE INDEX idx_indicador_macro_tipo_fecha
    ON indicador_macro (tipo, fecha);

-- Obligaciones impositivas: calendario y alertas de vencimiento
CREATE INDEX idx_impuesto_obligacion_tipo_periodo_estado
    ON impuesto_obligacion (tipo, periodo, estado);

-- Inversiones: portfolio activo por ticker
CREATE INDEX idx_inversion_ticker_estado
    ON inversion (ticker, estado);

-- Movimientos broker: por fecha y ticker
CREATE INDEX idx_inversion_movimiento_fecha_ticker
    ON inversion_movimiento (fecha_liquidacion, ticker);

-- Balance: consulta por ejercicio y sección
CREATE INDEX idx_balance_rubro_ejercicio_seccion
    ON balance_rubro (ejercicio, seccion);
