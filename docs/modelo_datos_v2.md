# Modelo de Datos v2 — App de Gestión San Luis
## Nadal y Zaccaro S.A.

**Fecha:** 28 de marzo de 2026  
**Versión:** 2.0 (validado contra datasets reales)  
**Total de tablas:** 27

---

## Convenciones

- Montos monetarios en **pesos argentinos nominales** (ajuste IPC en tiempo de consulta)
- Fechas en ISO 8601 (`YYYY-MM-DD`), timestamps en ISO 8601 con zona horaria
- Campos `id` autogenerados (UUID o autoincremental según DB)
- `created_at` y `updated_at` en todas las tablas (omitidos por brevedad)
- Formato numérico argentino en CSVs: punto = miles, coma = decimal
- Encoding: UTF-8 BOM para ARCA CSV, Latin-1 para archivos posicionales y Banco Provincia

---

## 1. ENTIDADES DE REFERENCIA

### 1.1 empresa

| Campo | Tipo | Descripción |
|---|---|---|
| id | PK | |
| razon_social | texto | "Nadal y Zaccaro S.A." |
| nombre_fantasia | texto | "Confitería San Luis" |
| cuit | texto | "30-65703377-0" |
| domicilio_legal | texto | "Calle 7 N° 1500 (1900) La Plata" |
| actividad_principal | texto | "Fabricación de panificados y confituras" |
| fecha_estatuto | fecha | 2012-12-03 |
| fecha_vto_vigencia | fecha | 2062-12-03 |
| matricula | texto | "112593" |
| legajo | texto | "194966" |
| numero_comercio_apr | texto | "45050" (Agencia Platense de Recaudación) |
| regimen_iva | texto | "Responsable Inscripto" |
| regimen_ganancias | texto | |
| regimen_iibb | texto | |
| capital_acciones | decimal | 3.000,00 |
| capital_suscripto | decimal | 300.000,00 |
| capital_integrado | decimal | 300.000,00 |
| datos_contacto | texto | Teléfono, email |
| responsables | texto | Andrea Nadal (Presidente), Fabián Zaccaro |

---

### 1.2 unidad_negocio

| Campo | Tipo | Descripción |
|---|---|---|
| id | PK | |
| nombre | texto | "Servicios", "Mostrador", "Terraza", "Decoración" |
| activa | booleano | |
| descripcion | texto | |

---

### 1.3 categoria_producto

| Campo | Tipo | Descripción |
|---|---|---|
| id | PK | |
| unidad_negocio_id | FK → unidad_negocio | |
| nombre | texto | Ej: "FACTURAS SURTIDAS", "SERVICIO DE CATERING", "ALMUERZO" |
| codigo_pos | texto | Código del producto en POS (sCodProducto) |
| activa | booleano | |

---

### 1.4 categoria_egreso

| Campo | Tipo | Descripción |
|---|---|---|
| id | PK | |
| nombre | texto | Ej: "Insumos", "Alquiler", "Servicios públicos" |
| tipo_costo | enum | `fijo` / `variable` |
| fuente_default | texto | "arca", "banco", "arba", "municipio", etc. |

---

## 2. PERSONAS Y ORGANIZACIONES

### 2.1 cliente

| Campo | Tipo | Descripción |
|---|---|---|
| id | PK | |
| razon_social | texto | Ej: "MOTOR PLAT SA", "L D A SA" |
| cuit | texto | Ej: "30643194097" (nullable para CF) |
| tipo_doc | entero | 80=CUIT, 99=Consumidor Final, etc. |
| domicilio | texto | |
| telefono | texto | |
| email | texto | |
| condicion_pago | texto | "Contado", "30 días", "50% anticipo" |
| notas | texto | |

---

### 2.2 proveedor

| Campo | Tipo | Descripción |
|---|---|---|
| id | PK | |
| razon_social | texto | Ej: "PANIFICADORA MAGMA DEL SUR SRL" |
| cuit | texto | Ej: "30717030369" |
| tipo_doc | entero | 80=CUIT |
| domicilio | texto | |
| telefono | texto | |
| email | texto | |
| condicion_pago | texto | |
| rubro | texto | |
| notas | texto | |

---

### 2.3 empleado

| Campo | Tipo | Descripción |
|---|---|---|
| id | PK | |
| nombre | texto | Ej: "De Luca Pablo Esteban" |
| cuil | texto | Ej: "20239999337" |
| cuenta_bancaria | texto | CBU/cuenta para transferencias |
| fecha_ingreso | fecha | |
| puesto | texto | |
| unidad_negocio_id | FK → unidad_negocio | Nullable si transversal |
| reporta_a_id | FK → empleado | Superior jerárquico |
| activo | booleano | |
| notas | texto | |

---

## 3. VENTAS

### 3.1 venta
Header de cada ticket/factura de venta.

| Campo | Tipo | Descripción |
|---|---|---|
| id | PK | |
| id_venta_pos | texto | UUID del POS (ej: "ed939aeb-2f45-...") |
| fecha | timestamp | "27/02/2026 18:16:11" |
| unidad_negocio_id | FK → unidad_negocio | |
| fuente | enum | `pos` / `arca` |
| tipo_comprobante | texto | "FCA", "FCB" (del POS) o 1,6,etc (ARCA) |
| punto_venta | entero | 8 |
| numero | entero | 1736 |
| comprobante | texto | "0008-00001736" |
| condicion_venta | texto | "CDO" (contado) |
| condicion_pago | texto | ".CREDITO", "EFECTIVO", ".DEBITO" |
| cliente_id | FK → cliente | Nullable |
| cliente_nombre | texto | Nombre del ticket (para CF sin ficha) |
| cliente_cuit | texto | CUIT del ticket |
| monto_total | decimal | Total del ticket |
| monto_neto | decimal | Neto gravado |
| monto_iva | decimal | Total IVA |
| anulado | booleano | |
| operador | texto | "manager" |
| factura_emitida_id | FK → factura_emitida | Si viene de ARCA |
| notas | texto | |

---

### 3.2 venta_detalle *(NUEVA)*
Líneas de detalle por producto dentro de cada ticket.

| Campo | Tipo | Descripción |
|---|---|---|
| id | PK | |
| venta_id | FK → venta | |
| id_producto_pos | texto | UUID del producto en POS |
| codigo_producto | texto | "166", "23", "76" |
| producto | texto | "SERVICIO DE CATERING", "FACTURAS SURTIDAS" |
| costo | decimal | Costo del producto (del POS) |
| precio_unitario | decimal | Precio unitario de venta |
| cantidad | decimal | |
| neto | decimal | Neto de la línea |
| descuentos | decimal | |
| impuestos | decimal | |
| familia | texto | "GENERAL", etc. |
| proveedor_pos | texto | Proveedor según POS |
| ean | texto | Código de barras |
| alicuota_iva | decimal | 21, 10.5, etc. |
| alicuota_dgr | decimal | Alícuota DGR |

---

## 4. COMPROBANTES ARCA

### 4.1 factura_emitida
Comprobantes emitidos (fuente: ARCA ventas CSV o libro IVA ventas).

| Campo | Tipo | Descripción |
|---|---|---|
| id | PK | |
| fecha_emision | fecha | |
| tipo_comprobante | entero | 1=Factura A, 6=Factura B, 3=NC A, etc. |
| punto_venta | entero | |
| numero_desde | entero | |
| numero_hasta | entero | |
| cod_autorizacion | texto | CAE |
| tipo_doc_receptor | entero | 80=CUIT, 99=CF |
| nro_doc_receptor | texto | CUIT del cliente |
| denominacion_receptor | texto | Nombre del cliente |
| moneda | texto | "$", "USD" |
| tipo_cambio | decimal | |
| iva_0_neto | decimal | Neto gravado IVA 0% |
| iva_2_5 | decimal | Monto IVA 2,5% |
| iva_2_5_neto | decimal | Neto gravado IVA 2,5% |
| iva_5 | decimal | Monto IVA 5% |
| iva_5_neto | decimal | Neto gravado IVA 5% |
| iva_10_5 | decimal | Monto IVA 10,5% |
| iva_10_5_neto | decimal | Neto gravado IVA 10,5% |
| iva_21 | decimal | Monto IVA 21% |
| iva_21_neto | decimal | Neto gravado IVA 21% |
| iva_27 | decimal | Monto IVA 27% |
| iva_27_neto | decimal | Neto gravado IVA 27% |
| imp_neto_gravado_total | decimal | |
| imp_neto_no_gravado | decimal | |
| imp_op_exentas | decimal | |
| otros_tributos | decimal | |
| total_iva | decimal | Suma de todos los IVA |
| imp_total | decimal | Total del comprobante |
| estado | enum | `pendiente` / `cobrada` / `parcial` / `anulada` |
| fecha_vencimiento_pago | fecha | Para cuentas por cobrar |
| fecha_cobro | fecha | Nullable |
| cliente_id | FK → cliente | |
| unidad_negocio_id | FK → unidad_negocio | |

---

### 4.2 factura_recibida
Comprobantes recibidos de proveedores (fuente: ARCA compras CSV o libro IVA compras).

| Campo | Tipo | Descripción |
|---|---|---|
| id | PK | |
| fecha_emision | fecha | |
| tipo_comprobante | entero | |
| punto_venta | entero | |
| numero_desde | entero | |
| numero_hasta | entero | |
| cod_autorizacion | texto | CAE |
| tipo_doc_emisor | entero | 80=CUIT |
| nro_doc_emisor | texto | CUIT del proveedor |
| denominacion_emisor | texto | Nombre del proveedor |
| tipo_doc_receptor | entero | 80=CUIT (siempre Nadal y Zaccaro) |
| nro_doc_receptor | texto | "30657033770" |
| moneda | texto | "$", "USD" |
| tipo_cambio | decimal | |
| iva_0_neto | decimal | |
| iva_2_5 | decimal | |
| iva_2_5_neto | decimal | |
| iva_5 | decimal | |
| iva_5_neto | decimal | |
| iva_10_5 | decimal | |
| iva_10_5_neto | decimal | |
| iva_21 | decimal | |
| iva_21_neto | decimal | |
| iva_27 | decimal | |
| iva_27_neto | decimal | |
| imp_neto_gravado_total | decimal | |
| imp_neto_no_gravado | decimal | |
| imp_op_exentas | decimal | |
| otros_tributos | decimal | |
| total_iva | decimal | |
| imp_total | decimal | |
| estado | enum | `pendiente` / `pagada` / `parcial` / `anulada` |
| fecha_vencimiento_pago | fecha | |
| fecha_pago | fecha | Nullable |
| proveedor_id | FK → proveedor | |
| categoria_egreso_id | FK → categoria_egreso | Auto + editable |
| categoria_corregida | booleano | |

---

## 5. EGRESOS

### 5.1 egreso
Registro unificado de todos los egresos.

| Campo | Tipo | Descripción |
|---|---|---|
| id | PK | |
| fecha | fecha | |
| concepto | texto | |
| monto | decimal | |
| categoria_egreso_id | FK → categoria_egreso | Fijo/variable |
| fuente | enum | `arca` / `payroll` / `banco_provincia` / `banco_santander` / `arba` / `municipio` / `contador` / `caja_chica` / `mp` |
| factura_recibida_id | FK → factura_recibida | Nullable |
| liquidacion_sueldo_id | FK → liquidacion_sueldo | Nullable |
| movimiento_bancario_id | FK → movimiento_bancario | Nullable |
| pago_impuesto_id | FK → pago_impuesto | Nullable |
| categoria_corregida | booleano | |
| notas | texto | |

---

## 6. PERSONAL

### 6.1 liquidacion_sueldo

| Campo | Tipo | Descripción |
|---|---|---|
| id | PK | |
| empleado_id | FK → empleado | |
| periodo | texto | "2026-01" |
| sueldo_bruto | decimal | Nullable (si solo se tiene transferencia) |
| aportes_empleado | decimal | Nullable |
| sueldo_neto | decimal | Monto transferido |
| contribuciones_patronales | decimal | Nullable |
| art | decimal | Nullable |
| costo_total_empresa | decimal | Nullable |
| horas_extra | decimal | Nullable |
| dias_ausencia | entero | Nullable |
| cuenta_beneficiario | texto | CBU destino (del XLSX sueldos) |
| situacion_transferencia | texto | "Abonado" |
| fecha_transferencia | fecha | Fecha de acreditación |
| fuente | enum | `transferencia` / `f931` / `recibo` |
| notas | texto | |

---

## 7. FINANCIERO

### 7.1 movimiento_bancario
Movimientos de extractos bancarios (Provincia TXT + Santander PDF).

| Campo | Tipo | Descripción |
|---|---|---|
| id | PK | |
| fecha | fecha | |
| banco | enum | `provincia` / `santander` |
| cuenta | texto | "50080/7" o "019-006261/3" |
| cbu | texto | CBU completo |
| moneda | enum | `ARS` / `USD` |
| comprobante | texto | Nro comprobante (Santander, nullable) |
| concepto | texto | Descripción del movimiento |
| debito | decimal | Monto debitado (nullable) |
| credito | decimal | Monto acreditado (nullable) |
| importe | decimal | +credito / -debito |
| fecha_valor | fecha | Fecha valor (Provincia, nullable) |
| saldo | decimal | Saldo post-movimiento |

---

### 7.2 movimiento_caja *(NUEVA)*
Movimientos de caja del POS (56k+ registros).

| Campo | Tipo | Descripción |
|---|---|---|
| id | PK | |
| fecha | timestamp | |
| condicion_pago | texto | ".DEBITO", ".CREDITO", "EFECTIVO", "QR" |
| documento | texto | "FCB", "FCA" |
| punto_venta | entero | |
| numero | entero | |
| importe | decimal | |
| tipo | texto | "Venta Contado", "Ingreso", "Egreso" |
| observacion | texto | |
| tarjeta | texto | Marca de tarjeta (nullable) |

---

### 7.3 movimiento_mp *(NUEVA)*
Movimientos de Mercado Pago (5.4k+ registros).

| Campo | Tipo | Descripción |
|---|---|---|
| id | PK | |
| fecha | timestamp | ISO 8601 "2026-02-02T03:15:30Z" |
| tipo_operacion | texto | "Cobro", "Pago", "Rendimiento positivo...", "Impuesto sobre los Créditos..." |
| numero_movimiento | texto | ID MP |
| operacion_relacionada | texto | ID operación relacionada |
| importe | decimal | Positivo=ingreso, negativo=egreso |

---

### 7.4 tenencia
Foto de saldos.

| Campo | Tipo | Descripción |
|---|---|---|
| id | PK | |
| fecha | fecha | |
| tipo | enum | `cuenta_bancaria` / `caja_pesos` / `caja_dolares` / `plazo_fijo` / `fci` / `cheque` / `billetera_digital` / `broker` |
| denominacion | texto | "Banco Provincia CC", "Santander CC", "Mercado Pago", "InvertirOnline" |
| moneda | enum | `ARS` / `USD` |
| saldo | decimal | En moneda original |
| saldo_ars | decimal | Equivalente en pesos |

---

### 7.5 inversion
Posiciones de inversión financiera.

| Campo | Tipo | Descripción |
|---|---|---|
| id | PK | |
| broker | texto | "invertironline" |
| cuenta_comitente | texto | "243279" |
| ticker | texto | "AL30", "GGAL", "ARS", "USD" |
| nombre | texto | "Pesos", "Dólar", nombre del bono/acción |
| tipo | enum | `bono` / `accion` / `fci` / `plazo_fijo` / `moneda` / `otro` |
| moneda | enum | `ARS` / `USD` |
| cantidad | decimal | |
| garantia | decimal | En garantía |
| disponibles | decimal | Disponibles |
| precio_compra | decimal | PPC (precio promedio de compra) |
| costo_total | decimal | Monto invertido |
| valuacion_precio | decimal | Precio actual |
| valuacion_monto | decimal | Monto actual en $ |
| valuacion_usd | decimal | Equivalente en USD |
| resultado | decimal | Ganancia/pérdida |
| variacion_pct | decimal | Variación % |
| fecha_valuacion | fecha | |
| estado | enum | `vigente` / `vendida` / `vencida` |

---

### 7.6 inversion_movimiento *(NUEVA)*
Movimientos de cuenta corriente del broker.

| Campo | Tipo | Descripción |
|---|---|---|
| id | PK | |
| fecha_concertacion | fecha | |
| fecha_liquidacion | fecha | |
| descripcion | texto | "Recibo de Cobro / 257396", "Boleto / 1466760 / APCOLCON" |
| tipo_operacion | texto | "Recibo de Cobro", "APCOLCON", "APCOLFUT", "Orden de Pago" |
| ticker | texto | "$", "ARS", nombre del instrumento |
| cantidad_vn | decimal | Cantidad / Valor nominal |
| precio | decimal | |
| importe_bruto | decimal | |
| importe_neto | decimal | |
| saldo | decimal | Saldo post-movimiento |
| moneda | enum | `ARS` / `USD` |
| seccion | texto | "PESOS - $", "DOLARES - USD" |

---

## 8. IMPUESTOS

### 8.1 impuesto_obligacion

| Campo | Tipo | Descripción |
|---|---|---|
| id | PK | |
| tipo | enum | `iva` / `ganancias` / `iibb` / `tasa_seguridad_higiene` / `tasa_publicidad_propaganda` / `tasa_ocupacion_espacio_publico` / `debitos_creditos` |
| periodo | texto | "2026-01" o "2025" |
| monto_determinado | decimal | |
| saldo_favor | decimal | Saldo a favor contribuyente |
| posicion_neta | decimal | Neto |
| compensaciones_recibidas | decimal | IIBB ARBA |
| compensaciones_enviadas | decimal | IIBB ARBA |
| estado | enum | `pendiente` / `pagado` / `parcial` / `vencido` |
| fecha_vencimiento | fecha | 1er vencimiento |
| fecha_2do_vto | fecha | 2do vencimiento (municipal) |
| recargo_2do_vto | decimal | Recargo por 2do vto |
| numero_boleta | texto | "004/26985067483" (municipal) |
| numero_tasa | texto | "05", "07", "74" (municipal) |
| formulario | texto | "800", "F931" (ARCA VEP) |
| codigo_impuesto | texto | "30 - IVA", "217 - SICORE-IMPTO.A LAS GANANCIAS" |
| fuente | enum | `arca` / `arba` / `municipio` |
| observaciones | texto | |

---

### 8.2 pago_impuesto

| Campo | Tipo | Descripción |
|---|---|---|
| id | PK | |
| impuesto_obligacion_id | FK → impuesto_obligacion | |
| fecha_pago | fecha | Fecha de operación del VEP |
| monto | decimal | |
| medio_pago | texto | VEP, transferencia, débito automático |
| numero_vep | texto | |
| formulario | texto | "800" |
| version | texto | "0" |
| observaciones | texto | "02 - Comprobante general" |

---

## 9. MARKETING

### 9.1 accion_comercial

| Campo | Tipo | Descripción |
|---|---|---|
| id | PK | |
| titulo | texto | |
| descripcion | texto | |
| fecha_inicio | fecha | |
| fecha_fin | fecha | |
| unidad_negocio_id | FK → unidad_negocio | Nullable |
| estado | enum | `planificada` / `activa` / `finalizada` |

---

### 9.2 metrica_red_social

| Campo | Tipo | Descripción |
|---|---|---|
| id | PK | |
| fecha | fecha | |
| plataforma | enum | `instagram` / `facebook` |
| seguidores | entero | |
| alcance | entero | |
| engagement | decimal | |
| publicaciones | entero | |
| interacciones | entero | |

---

## 10. DATOS MACROECONÓMICOS

### 10.1 indicador_macro

| Campo | Tipo | Descripción |
|---|---|---|
| id | PK | |
| tipo | enum | `ipc` / `dolar_oficial` / `dolar_mep` / `dolar_ccl` / `tasa_bcra` / `emae` |
| fecha | fecha | |
| valor | decimal | |
| variacion_mensual | decimal | Nullable |
| variacion_interanual | decimal | Nullable |
| fuente_api | texto | |

---

## 11. BALANCE Y ESTADOS CONTABLES

### 11.1 balance_rubro
Rubros del balance cargados por ejercicio.

| Campo | Tipo | Descripción |
|---|---|---|
| id | PK | |
| ejercicio | texto | "2024" |
| fecha_cierre | fecha | 2024-12-31 |
| seccion | enum | `activo_corriente` / `activo_no_corriente` / `pasivo_corriente` / `pasivo_no_corriente` / `patrimonio_neto` |
| nota_numero | entero | Número de nota (1-10) |
| rubro | texto | "Caja y Bancos", "Cuentas por Cobrar" |
| subrubro | texto | "Caja", "Banco Provincia Buenos Aires c/c $" (nullable) |
| monto | decimal | Monto del ejercicio |
| monto_ejercicio_anterior | decimal | Monto comparativo |
| orden | entero | Orden de presentación |

---

### 11.2 estado_resultados_contable *(NUEVA)*
Estado de resultados del contador (no el calculado).

| Campo | Tipo | Descripción |
|---|---|---|
| id | PK | |
| ejercicio | texto | "2024" |
| fecha_cierre | fecha | |
| linea | texto | "Ingresos por ventas y servicios", "Costos operativos", etc. |
| seccion | enum | `ingresos` / `costo_operativo` / `gasto_administracion` / `gasto_comercializacion` / `gasto_financiero` / `otros_ingresos` / `impuestos` / `resultado` |
| monto | decimal | (negativos entre paréntesis en EECC) |
| monto_ejercicio_anterior | decimal | |
| anexo_referencia | texto | "Anexo II", "Anexo III" (nullable) |
| orden | entero | |

---

## 12. GESTIÓN DE DATASETS

### 12.1 fuente_datos

| Campo | Tipo | Descripción |
|---|---|---|
| id | PK | |
| nombre | texto | "ARCA Compras CSV", "POS Mostrador", "Banco Provincia" |
| tipo_archivo | enum | `csv` / `excel` / `txt` / `pdf` / `zip` / `api` / `manual` / `png` |
| encoding | texto | "utf-8-sig", "latin-1" |
| separador | texto | ";", "," o null para otros formatos |
| modulo_destino | texto | "ventas", "egresos", "personal" |
| ultima_actualizacion | timestamp | |
| registros_cargados | entero | |
| ultimo_error | texto | Nullable |
| estado | enum | `actualizado` / `desactualizado` / `error` |
| frecuencia_esperada | texto | "diario", "semanal", "mensual" |
| notas_formato | texto | Observaciones de parseo |

---

## RESUMEN DE TABLAS (27)

| # | Tabla | Categoría | Fuente principal |
|---|-------|-----------|------------------|
| 1 | empresa | Referencia | Manual |
| 2 | unidad_negocio | Referencia | Manual |
| 3 | categoria_producto | Referencia | POS + Manual |
| 4 | categoria_egreso | Referencia | Manual |
| 5 | cliente | Personas | ARCA ventas + POS |
| 6 | proveedor | Personas | ARCA compras |
| 7 | empleado | Personas | Manual + Sueldos XLSX |
| 8 | venta | Ventas | POS + ARCA |
| 9 | venta_detalle | Ventas | POS |
| 10 | factura_emitida | Comprobantes | ARCA ventas CSV/ZIP |
| 11 | factura_recibida | Comprobantes | ARCA compras CSV/ZIP |
| 12 | egreso | Egresos | Múltiples fuentes |
| 13 | liquidacion_sueldo | Personal | Transferencias XLSX / F931 |
| 14 | movimiento_bancario | Financiero | Bco Provincia TXT + Santander PDF |
| 15 | movimiento_caja | Financiero | POS movcaja XLSX |
| 16 | movimiento_mp | Financiero | Mercado Pago XLSX |
| 17 | tenencia | Financiero | Manual / extractos |
| 18 | inversion | Financiero | Broker XLSX (tenencias) |
| 19 | inversion_movimiento | Financiero | Broker XLSX (voucher) |
| 20 | impuesto_obligacion | Impuestos | ARCA VEP + ARBA + Municipal PDF |
| 21 | pago_impuesto | Impuestos | ARCA VEP CSV |
| 22 | accion_comercial | Marketing | Manual |
| 23 | metrica_red_social | Marketing | API Instagram/Meta |
| 24 | indicador_macro | Macro | API INDEC/BCRA/dolarapi |
| 25 | balance_rubro | EECC | Contador (EECC PDF) |
| 26 | estado_resultados_contable | EECC | Contador (EECC PDF) |
| 27 | fuente_datos | Sistema | Automático |

---

## DIAGRAMA DE RELACIONES v2

```
                         ┌──────────────┐
                         │   empresa    │
                         └──────────────┘

  ┌─────────────────┐     ┌──────────────────────┐
  │ unidad_negocio  │────►│  categoria_producto   │
  └────────┬────────┘     └──────────┬───────────┘
           │                         │
           │    ┌────────────────────▼────────────────────┐
           │    │              venta                      │
           │    │  (POS header + ARCA servicios)          │
           │    └────────────────────┬───────────────────-┘
           │                         │
           │              ┌──────────▼───────────┐
           │              │    venta_detalle      │ ← 4.7k líneas/mes
           │              │  (producto, cantidad, │
           │              │   precio, familia)    │
           │              └──────────────────────-┘
           │
           │    ┌────────────────────────────────────────-┐
           ├───►│         factura_emitida                 │◄── cliente
           │    │  (ARCA ventas, IVA x 6 alícuotas)      │
           │    └────────────────────────────────────────-┘
           │
           │    ┌────────────────────────────────────────-┐
           │    │         factura_recibida                │◄── proveedor
           │    │  (ARCA compras, IVA x 6 alícuotas)     │
           │    └──────────────┬─────────────────────────-┘
           │                   │
           │    ┌──────────────▼─────────────────────────-┐
           │    │             egreso                      │◄── categoria_egreso
           │    │  (hub central, 7+ fuentes)              │     (fijo/variable)
           │    └──┬───────┬───────┬───────┬────────────-─┘
           │       │       │       │       │
           │       ▼       ▼       ▼       ▼
           │    mov_banco mov_mp  liq_    pago_
           │              sueldo  impuesto
           │
           ├───►│         empleado         │──► liquidacion_sueldo
           │    └──────────────────────────┘
           │
           │    ┌──────────────────────────┐
           │    │    movimiento_caja       │ ← 56k registros/año
           │    │  (medio pago, tarjeta)   │     Flujo de fondos diario
           │    └──────────────────────────┘
           │
           │    ┌──────────────────────────┐    ┌──────────────────────┐
           │    │  movimiento_bancario     │    │    movimiento_mp     │
           │    │  (Provincia + Santander) │    │  (cobros, pagos,     │
           │    └──────────────────────────┘    │   rendimientos)      │
           │                                    └──────────────────────┘
           │    ┌──────────────────────────┐    ┌──────────────────────┐
           │    │       tenencia           │    │     inversion        │
           │    └──────────────────────────┘    └──────────┬───────────┘
           │                                               │
           │                                    ┌──────────▼───────────┐
           │                                    │ inversion_movimiento │
           │                                    └──────────────────────┘
           │
           │    ┌──────────────────────────┐
           └───►│    accion_comercial      │
                └──────────────────────────┘

  ┌────────────────────┐  ┌────────────────────┐  ┌──────────────────┐
  │  indicador_macro   │  │   fuente_datos     │  │  balance_rubro   │
  └────────────────────┘  └────────────────────┘  └──────────────────┘
  ┌────────────────────┐  ┌────────────────────┐  ┌──────────────────┐
  │metrica_red_social  │  │impuesto_obligacion │  │eerr_contable     │
  └────────────────────┘  │  + pago_impuesto   │  └──────────────────┘
                          └────────────────────┘
```

---

## ÍNDICES RECOMENDADOS v2

| Tabla | Campos | Motivo |
|---|---|---|
| venta | fecha, unidad_negocio_id, fuente | Consultas por período y unidad |
| venta_detalle | venta_id, codigo_producto, familia | Análisis por producto |
| factura_emitida | cliente_id, estado, fecha_vencimiento_pago | Aging CxC |
| factura_recibida | proveedor_id, estado, fecha_vencimiento_pago | Aging CxP |
| egreso | fecha, categoria_egreso_id, fuente | Filtros frecuentes |
| movimiento_bancario | fecha, banco, cuenta | Flujo de fondos |
| movimiento_caja | fecha, condicion_pago | Análisis por medio de pago |
| movimiento_mp | fecha, tipo_operacion | Análisis MP |
| liquidacion_sueldo | empleado_id, periodo | Por empleado y mes |
| indicador_macro | tipo, fecha | Ajuste IPC |
| impuesto_obligacion | tipo, periodo, estado | Calendario y alertas |
| inversion | ticker, estado | Portfolio activo |
| inversion_movimiento | fecha_liquidacion, ticker | Movimientos broker |
| balance_rubro | ejercicio, seccion | Por ejercicio |

---

## VOLÚMENES ESTIMADOS (mensual)

| Tabla | Registros/mes | Registros/año |
|---|---|---|
| venta | ~5.000 | ~60.000 |
| venta_detalle | ~5.000 | ~60.000 |
| movimiento_caja | ~5.000 | ~60.000 |
| movimiento_mp | ~5.500 | ~66.000 |
| movimiento_bancario | ~1.000 | ~12.000 |
| factura_emitida (ARCA) | ~2.500 | ~30.000 |
| factura_recibida (ARCA) | ~175 | ~2.100 |
| egreso | ~200 | ~2.400 |
| liquidacion_sueldo | ~16 | ~192 |
| impuesto_obligacion | ~5-8 | ~80 |
| pago_impuesto | ~18 | ~220 |
| inversion_movimiento | ~20-50 | ~400 |

**Volumen total estimado: ~300k registros/año**
Esto es perfectamente manejable con PostgreSQL, SQLite, o incluso una base más simple.
