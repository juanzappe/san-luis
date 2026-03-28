# Validación del Modelo de Datos vs Datasets Reales
## Hallazgos y Ajustes Necesarios

**Fecha:** 28 de marzo de 2026

---

## Datasets analizados

| # | Archivo | Fuente | Registros | Observación |
|---|---------|--------|-----------|-------------|
| 1 | TOTAL_EGRESOS_2026_FEBRERO.csv | ARCA compras | 175 | 30 columnas, semicolon-separated |
| 2 | TOTAL_INGRESOS_2026_FEBRERO.csv | ARCA ventas | 2.466 | 28 columnas |
| 3 | RESULTADOS_BUSQUEDA.zip | ARCA libro IVA compras | — | Fixed-width: CABECERA.txt + DETALLE.txt |
| 4 | RESULTADOS_BUSQUEDA__1_.zip | ARCA libro IVA ventas | — | Fixed-width: VENTAS.txt + ALICUOTAS.txt |
| 5 | MOSTRADOR_FEBRERO_2026.xlsx | POS | 4.766 | Detalle por producto y ticket |
| 6 | movcaja_3_26_2026_3_07_26_PM.xlsx | POS caja | 56.185 | Movimientos con medio de pago |
| 7 | MP_FEBRERO_2026.xlsx | Mercado Pago | 5.455 | Cobros, pagos, rendimientos |
| 8 | 5208500807_20260302_extractos.txt | Banco Provincia | 1.022 | CSV con FECHA,CONCEPTO,IMPORTE,Saldo |
| 9 | 2026-02-27_00720019005000062613.pdf | Banco Santander | ~17 mov | PDF con Fecha,Comprobante,Movimiento,Débito,Crédito,Saldo |
| 10 | SUELDOS_ENERO_2026.xlsx | Banco (transferencias) | 16 | Solo datos de transferencia, no liquidación |
| 11 | impuestos_nacionales_hasta_febrero26.csv | ARCA (VEPs) | 218 | Pagos de impuestos nacionales |
| 12 | IIBB_2025_2026FEB.png | ARBA | 16 períodos | Screenshot con saldos a favor y compensaciones |
| 13 | Boleta_seg_e_higiene.pdf | Municipio (APR) | 1 | Tasa N°05 - Seg. e Higiene |
| 14 | Ocupación_espacio_público_Cuota_6_2025.pdf | Municipio (APR) | 1 | Tasa N°74 - Espacio público |
| 15 | Publicidad_y_propaganda_Cuota_2_2026.pdf | Municipio (APR) | 1 | Tasa N°07 - Publicidad |
| 16 | Tenencias-243279_nadal_y_zaccaro_SA_-2026-03-26.xlsx | Broker (InvertirOnline) | — | Tenencias con Ticker, Cantidad, Precio, Moneda |
| 17 | inviu-voucher-2026-03-27T00_15_02_902Z.xlsx | Broker (InvertirOnline) | — | Cuenta corriente del broker |
| 18 | EECC_NADAL_Y_ZACCARO_2024.pdf | Contador | 14 págs | Balance, EERR, Flujo, Notas, Anexos |

---

## AJUSTES NECESARIOS AL MODELO

### 1. factura_recibida — AGREGAR columnas de IVA por alícuota

El CSV de ARCA compras tiene IVA desglosado en 6 alícuotas. El modelo solo tenía `monto_iva` genérico.

**Columnas a agregar:**
```
iva_0_neto          decimal   Imp. Neto Gravado IVA 0%
iva_2_5             decimal   IVA 2,5%
iva_2_5_neto        decimal   Imp. Neto Gravado IVA 2,5%
iva_5               decimal   IVA 5%
iva_5_neto          decimal   Imp. Neto Gravado IVA 5%
iva_10_5            decimal   IVA 10,5%
iva_10_5_neto       decimal   Imp. Neto Gravado IVA 10,5%
iva_21              decimal   IVA 21%
iva_21_neto         decimal   Imp. Neto Gravado IVA 21%
iva_27              decimal   IVA 27%
iva_27_neto         decimal   Imp. Neto Gravado IVA 27%
imp_neto_no_gravado decimal   Imp. Neto No Gravado
imp_op_exentas      decimal   Imp. Op. Exentas
otros_tributos      decimal   Otros Tributos
cod_autorizacion    texto     Cód. Autorización (CAE/CAI)
tipo_doc_emisor     entero    Tipo Doc. Emisor (80=CUIT, etc.)
moneda              texto     Moneda ("$", "USD")
tipo_cambio         decimal   Tipo de cambio
```

### 2. factura_emitida — AGREGAR mismas columnas de IVA

Misma estructura de IVA por alícuota, más:
```
tipo_doc_receptor   entero    Tipo Doc. Receptor (80=CUIT, 99=CF)
cod_autorizacion    texto     CAE
moneda              texto     Moneda
tipo_cambio         decimal   Tipo de cambio
```

### 3. NUEVA TABLA: venta_detalle — Detalle de producto por ticket POS

El POS tiene detalle por producto (no solo totales). Esto es MUY valioso para análisis.

```
venta_detalle
├── id                    PK
├── venta_id              FK → venta
├── id_producto_pos       texto     ID del producto en el POS
├── codigo_producto       texto     Código del producto (sCodProducto)
├── producto              texto     Nombre del producto ("FACTURAS SURTIDAS", "SERVICIO DE CATERING")
├── costo                 decimal   Costo del producto
├── precio_unitario       decimal   Precio unitario
├── cantidad              decimal   Cantidad vendida
├── neto                  decimal   Neto de la línea
├── descuentos            decimal   Descuentos aplicados
├── impuestos             decimal   Impuestos de la línea
├── familia               texto     Familia/categoría ("GENERAL", etc.)
├── proveedor_pos         texto     Proveedor según POS
├── alicuota_iva          decimal   Alícuota IVA (21, 10.5, etc.)
└── alicuota_dgr          decimal   Alícuota DGR
```

**Impacto:** La tabla `venta` sigue siendo el header del ticket. `venta_detalle` son las líneas.

### 4. venta — AGREGAR campos del POS

```
id_venta_pos        texto     UUID del POS (idVenta)
tipo_comprobante    texto     "FCA", "FCB", etc.
comprobante         texto     "0008-00001736"
condicion_venta     texto     "CDO" (contado)
condicion_pago      texto     ".CREDITO", "EFECTIVO", ".DEBITO"
cliente_nombre      texto     Nombre del cliente del ticket
cliente_cuit        texto     CUIT del cliente del ticket
anulado             booleano  Si fue anulado
operador            texto     Usuario que creó la venta
```

### 5. NUEVA TABLA: movimiento_caja — Movimientos de caja del POS

56.185 registros. Cada transacción de caja con medio de pago.

```
movimiento_caja
├── id                    PK
├── fecha                 timestamp
├── condicion_pago        texto     ".DEBITO", ".CREDITO", "EFECTIVO", "QR"
├── documento             texto     "FCB", "FCA"
├── punto_venta           entero    PV
├── numero                entero    Número de comprobante
├── importe               decimal
├── tipo                  texto     "Venta Contado", "Ingreso", "Egreso"
├── observacion           texto     Descripción
└── tarjeta               texto     Marca de tarjeta (nullable)
```

**Impacto:** Esto es clave para el flujo de fondos diario y para saber cuánto entra por cada medio de pago.

### 6. NUEVA TABLA: movimiento_mp — Movimientos de Mercado Pago

5.455 registros. MP es mucho más que una billetera — tiene cobros, pagos, rendimientos.

```
movimiento_mp
├── id                    PK
├── fecha                 timestamp    "2026-02-02T03:15:30Z"
├── tipo_operacion        texto        "Cobro", "Pago", "Rendimiento positivo de la inversión", etc.
├── numero_movimiento     texto        ID de MP
├── operacion_relacionada texto        ID de operación relacionada
└── importe               decimal      Positivo=ingreso, Negativo=egreso
```

**Alternativa:** Podría ir dentro de `movimiento_bancario` con un campo `origen = 'mp'`, pero la estructura es tan distinta que conviene tabla separada.

### 7. movimiento_bancario — AJUSTES por dos bancos con formatos distintos

**Banco Provincia (TXT):** FECHA, CONCEPTO, IMPORTE (+ o -), Fecha Valor, Saldo
**Banco Santander (PDF):** Fecha, Comprobante, Movimiento, Débito, Crédito, Saldo

Ajustar la tabla:
```
movimiento_bancario (ajustado)
├── id                    PK
├── fecha                 fecha
├── banco                 texto        "provincia" / "santander"
├── cuenta                texto        Nro de cuenta / CBU
├── moneda                enum         ARS / USD
├── comprobante           texto        Nro de comprobante (nullable)
├── concepto              texto        Descripción del movimiento
├── debito                decimal      Monto debitado (nullable)
├── credito               decimal      Monto acreditado (nullable)
├── importe               decimal      Positivo=crédito, Negativo=débito
├── fecha_valor            fecha        Fecha valor (Provincia tiene esto)
└── saldo                 decimal      Saldo post-movimiento
```

### 8. liquidacion_sueldo — REALIDAD vs MODELO

El archivo de sueldos es solo la transferencia bancaria (quién cobró cuánto). No tiene el desglose de bruto, aportes, contribuciones.

**Opciones:**
- A) Aceptar que por ahora solo se carga el neto transferido (más simple)
- B) Agregar campos de transferencia: cuenta_beneficiario, situacion ("Abonado")
- C) Esperar a tener el F931 real para el desglose completo

**Recomendación:** Empezar con opción A, agregar datos del F931 cuando estén disponibles.

### 9. impuesto_obligacion — AGREGAR más tipos municipales

Los PDFs muestran que hay más tasas municipales de las previstas:
```
tipo enum AGREGAR:
  'tasa_publicidad_propaganda'    (Tasa N°07)
  'tasa_ocupacion_espacio_publico' (Tasa N°74)
```

También agregar campos de las boletas APR:
```
numero_boleta       texto     "004/26985067483"
numero_tasa         texto     "05", "07", "74"
numero_comercio     texto     "45050"
recargo_2do_vto     decimal   Recargo por 2do vencimiento
fecha_2do_vto       fecha     Fecha del 2do vencimiento
```

### 10. impuesto_obligacion — Ajuste para IIBB (ARBA)

La imagen de IIBB muestra campos específicos:
```
saldo_favor_contribuyente  decimal
compensaciones_recibidas   decimal
compensaciones_enviadas    decimal
```

### 11. impuesto_obligacion — Ajuste para VEPs nacionales

El CSV de impuestos nacionales tiene:
```
formulario          texto     "800", "F931", etc.
version             texto     Version del formulario
codigo_impuesto     texto     "217 - SICORE-IMPTO.A LAS GANANCIAS", "30 - IVA"
observaciones       texto     "02 - Comprobante general"
```

Agregar `formulario`, `codigo_impuesto`, `observaciones` a la tabla.

### 12. inversion — AGREGAR campos del broker

```
ticker              texto     "AL30", "GGAL", "ARS", "USD"
broker              texto     "invertironline"
cuenta_comitente    texto     "243279"
garantia            decimal   Cantidad en garantía
disponibles         decimal   Cantidad disponible
```

### 13. NUEVA TABLA: inversion_movimiento — Movimientos del broker

```
inversion_movimiento
├── id                    PK
├── fecha_concertacion    fecha
├── fecha_liquidacion     fecha
├── descripcion           texto        "Recibo de Cobro / 257396"
├── tipo_operacion        texto        "Recibo de Cobro", "APCOLCON", "APCOLFUT"
├── ticker                texto        "$", "ARS", bono, etc.
├── cantidad_vn           decimal
├── precio                decimal
├── importe_bruto         decimal
├── importe_neto          decimal
├── saldo                 decimal      Saldo post-movimiento
└── moneda                enum         ARS / USD
```

### 14. balance_rubro — AJUSTAR a la estructura real del EECC

El EECC tiene notas detalladas (Nota 1 a 10) con subrubros. Agregar:
```
nota_numero         entero    Número de nota (1-10)
subrubro            texto     "Caja", "Banco Provincia Buenos Aires", etc.
ejercicio_anterior  decimal   Monto del ejercicio anterior (comparativo)
```

### 15. NUEVA TABLA: estado_resultados_contable

Para cargar el EERR del contador (no el calculado desde operaciones):
```
estado_resultados_contable
├── id                    PK
├── ejercicio             texto     "2024"
├── linea                 texto     "Ingresos por ventas y servicios"
├── monto                 decimal
├── monto_ejercicio_ant   decimal   Comparativo
├── seccion               enum      costo_operativo / gasto_admin / gasto_comerc / gasto_financiero / otros / impuestos
├── orden                 entero    Orden de presentación
```

---

## RESUMEN DE CAMBIOS

| Acción | Tabla | Detalle |
|--------|-------|---------|
| MODIFICAR | factura_recibida | +17 campos (IVA por alícuota, CAE, moneda) |
| MODIFICAR | factura_emitida | +14 campos (IVA por alícuota, CAE, moneda) |
| MODIFICAR | venta | +9 campos (datos POS: UUID, comprobante, pago, cliente) |
| MODIFICAR | movimiento_bancario | +3 campos (banco, moneda, fecha_valor) |
| MODIFICAR | impuesto_obligacion | +8 campos (boleta, compensaciones, formulario) |
| MODIFICAR | inversion | +4 campos (ticker, broker, comitente, garantía) |
| MODIFICAR | balance_rubro | +3 campos (nota, subrubro, ejercicio_anterior) |
| AGREGAR | venta_detalle | NUEVA — detalle de producto por ticket |
| AGREGAR | movimiento_caja | NUEVA — 56k registros de caja POS |
| AGREGAR | movimiento_mp | NUEVA — 5.4k movimientos Mercado Pago |
| AGREGAR | inversion_movimiento | NUEVA — movimientos del broker |
| AGREGAR | estado_resultados_contable | NUEVA — EERR cargado del contador |

**Total tablas: 22 → 27**

---

## FORMATOS DE IMPORTACIÓN A SOPORTAR

| Fuente | Formato | Encoding | Separador | Notas |
|--------|---------|----------|-----------|-------|
| ARCA compras (CSV) | CSV | UTF-8 BOM | ; (semicolon) | Coma decimal, punto miles |
| ARCA ventas (CSV) | CSV | UTF-8 BOM | ; (semicolon) | Coma decimal, punto miles |
| ARCA libro IVA compras | ZIP → TXT fixed-width | Latin-1 | Posicional | CABECERA + DETALLE |
| ARCA libro IVA ventas | ZIP → TXT fixed-width | Latin-1 | Posicional | VENTAS + ALICUOTAS |
| POS mostrador | XLSX | — | — | Hoja "ventas_detalle" |
| POS caja | XLSX | — | — | Hoja "movcaja" |
| Mercado Pago | XLSX | — | — | Timestamps ISO 8601 |
| Banco Provincia | TXT | Latin-1 | , (comma) | Header de 10 líneas a skipear |
| Banco Santander | PDF | — | — | Requiere parseo de PDF |
| Sueldos | XLSX | — | — | Header en fila 2, fila 1 es título |
| Impuestos nacionales | CSV | UTF-8 BOM | , (comma) | Valores con ="..." wrapping |
| ARBA (IIBB) | Screenshot PNG | — | — | Requiere carga manual o OCR |
| Boletas municipales | PDF | — | — | Requiere parseo o carga manual |
| Tenencias broker | XLSX | — | — | Fórmulas Excel (no valores) |
| Movimientos broker | XLSX | — | — | Múltiples secciones (ARS, USD) |
| EECC | PDF | — | — | 14 páginas, carga manual o parseo |
