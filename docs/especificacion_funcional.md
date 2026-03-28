# Especificación Funcional — App de Gestión San Luis
## Nadal y Zaccaro S.A. — Confitería San Luis

**Fecha:** 27 de marzo de 2026  
**Versión:** 1.0

---

## Principios generales

- **Ajuste por inflación:** Todos los valores monetarios se ajustan por IPC INDEC (moneda del último mes disponible)
- **Períodos:** Todos los módulos con datos temporales permiten vista mensual, trimestral y anual
- **Comparativos:** Todos los módulos permiten comparar entre períodos (ej: mes actual vs mismo mes año anterior)
- **Unidades de negocio:** Servicios (catering), Mostrador, Terraza, Decoración

---

## 1. ECONÓMICOS

### 1.1 Estado de Resultados
- **Tipo:** Calculado automáticamente desde datos operativos (Ventas + Egresos + Costos)
- **Vistas:** Dos formatos alternables — contable argentino clásico y simplificado adaptado al negocio
- **Apertura:** Consolidado (sin apertura por unidad de negocio por ahora, preparado para futuro)
- **Dependencias:** Requiere datos cargados en Ventas, Egresos y Costos

### 1.2 Ventas
- **Fuentes de datos:**
  - POS (exporta CSV/Excel) → Mostrador, Decoración, Terraza
  - ARCA (facturas emitidas) → Servicios (catering)
- **Nivel de detalle:** Con categorías de producto por unidad de negocio
- **Gráficos:** Barras comparativas por período, líneas de tendencia, comparativo entre unidades, torta de participación
- **Campo obligatorio:** Unidad de negocio asignada a cada transacción

### 1.3 Egresos
- **Fuentes de datos:**
  - ARCA → facturas de proveedores
  - Payroll → sueldos y cargas sociales (F931/SICOSS + recibos)
  - Extractos bancarios → impuesto débitos/créditos, comisiones, intereses
  - ARBA → Ingresos Brutos
  - Municipalidad → Tasa de Seguridad e Higiene
  - Contador → amortizaciones, RECPAM, provisiones
  - Caja chica / tarjeta corporativa
- **Categorización:** Automática por tipo de comprobante/fuente, con opción de corregir manualmente
- **Apertura:** Consolidado (sin apertura por unidad de negocio por ahora)

### 1.4 Balance
- **Tipo:** Carga del balance cerrado provisto por el contador (no se construye desde datos operativos)
- **Contenido:** Activo / Pasivo / Patrimonio Neto con apertura por rubro
- **Frecuencia:** Anual (estados contables auditados, ej: 2019–2024)
- **Gráficos:** Composición (torta de activos), evolución del PN entre ejercicios

### 1.5 Indicadores
- **Familias:** Rentabilidad (margen bruto, neto, ROE, ROA), Liquidez (corriente, prueba ácida), Endeudamiento (deuda/PN, cobertura intereses), Operativos (ticket promedio, venta por m², costo por empleado)
- **Fuente:** Se calculan desde Estado de Resultados + Balance + Excel de indicadores existente de Juan Pablo
- **Visualización:** Dashboard con semaforización (verde/amarillo/rojo) + tablas comparativas entre períodos
- **Referencia:** Excel con lista específica de indicadores a implementar

---

## 2. FINANCIEROS

### 2.1 Flujo de fondos
- **Método:** Directo (registro de cobros y pagos reales)
- **Fuente:** Movimientos bancarios (extractos) + caja
- **Alcance:** Histórico + proyección futura (alimentada por Cuentas por cobrar y por pagar pendientes)

### 2.2 Tenencias
- **Tipos:** Cuentas bancarias, caja efectivo (pesos/dólares), plazos fijos/FCI/money market, cheques en cartera, billeteras digitales (Mercado Pago, etc.), broker
- **Vista:** Foto del día con saldo actual de cada tenencia
- **Total:** Consolidado en pesos (opcionalmente equivalente en USD)

### 2.3 Inversiones
- **Alcance:** Inversiones financieras (bonos, acciones, FCI, plazos fijos)
- **Datos:** Registro de compra (fecha, precio, cantidad) + valuación actual
- **Cálculo:** Rendimiento (ganancia/pérdida realizada y no realizada)
- **Cotizaciones:** Carga manual de valuaciones
- **Relación con Tenencias:** Tenencias muestra saldo, Inversiones muestra detalle y rendimiento

### 2.4 Cuentas por cobrar
- **Detalle:** Factura por factura agrupado por cliente
- **Fuente:** Facturas emitidas (ARCA / ventas de Servicios)
- **Vistas:** Aging (antigüedad de deuda), alertas de vencimiento, ranking de deudores, total pendiente de cobro
- **Conexión:** Alimenta la proyección del flujo de fondos

### 2.5 Cuentas por pagar
- **Detalle:** Factura por factura agrupado por proveedor
- **Fuente:** Facturas recibidas (ARCA)
- **Vistas:** Aging (antigüedad de deuda), alertas de vencimiento, ranking de acreedores, total pendiente de pago
- **Conexión:** Alimenta la proyección del flujo de fondos

---

## 3. PERSONAL

### 3.1 Sueldos y cargas sociales
- **Fuentes:** F931/SICOSS + recibos de sueldo
- **Detalle:** Por empleado (sueldo bruto, cargas sociales, ART, contribuciones)
- **Indicadores laborales:** Ausentismo, horas extra, antigüedad, costo por empleado
- **Conexión:** Alimenta Egresos y Estado de Resultados

### 3.2 Organigrama
- **Tipo:** Dinámico con datos — puesto, antigüedad, sueldo, unidad de negocio asignada
- **Mantenimiento:** Carga y edición manual
- **Visualización:** Jerárquica (quién reporta a quién)

---

## 4. COMERCIAL

### 4.1 Marketing
- **Contenido:** Métricas de redes sociales (seguidores, engagement, alcance) + calendario de acciones comerciales/promociones
- **Fuente:** Integración API Instagram/Meta
- **Análisis:** Tendencias y correlación con períodos de venta

### 4.2 Proveedores
- **Datos:** Ficha de proveedor (contacto, CUIT, condiciones de pago) + ranking por volumen de compra
- **Fuente:** Se alimenta automáticamente desde ARCA/Egresos
- **Conexión:** Vinculado con Cuentas por pagar

### 4.3 Clientes
- **Datos:** Ficha de cliente (contacto, CUIT, condiciones) + ranking por volumen de venta + historial de eventos/servicios contratados + frecuencia de compra/recurrencia
- **Alcance:** Todos los clientes (servicios, mostrador, terraza)
- **Fuente:** Se alimenta desde ARCA (facturas emitidas) / Ventas
- **Conexión:** Vinculado con Cuentas por cobrar

---

## 5. COSTOS

- **Alcance:** Estructura de costos completa — fijos vs variables
- **Clasificación:** Automática por categoría (ej: alquiler → fijo, insumos → variable)
- **Fuente:** Se alimenta desde Egresos (reclasifica cada gasto como fijo o variable)
- **Análisis:**
  - Punto de equilibrio
  - Margen de contribución
  - Costo fijo vs variable por período
  - Evolución de costos vs inflación
- **Futuro (no en v1):** Fichas técnicas de productos (recetas con insumos para costeo por producto)

---

## 6. IMPUESTOS

- **Impuestos trackeados:**
  - IVA (débito/crédito, posición mensual, DDJJ)
  - Ganancias (anticipos, DDJJ anual)
  - Ingresos Brutos (ARBA, mensual)
  - Tasa de Seguridad e Higiene (municipal)
  - Impuesto a los débitos y créditos bancarios
- **Vistas:**
  - Calendario de vencimientos con alertas
  - Posición fiscal mensual (cuánto debo / a favor)
  - Historial de pagos
  - Carga impositiva total vs facturación (presión fiscal)
- **Fuente:** Automático desde ARCA/ARBA/municipio
- **Conexión:** Alimenta Egresos (los impuestos pagados son egresos)

---

## 7. UNIDADES DE NEGOCIO

- **Unidades:** Servicios, Mostrador, Terraza, Decoración
- **Tipo:** Dashboard por unidad que filtra datos de otros módulos
- **Contenido:** Ventas de esa unidad + indicadores propios (margen, ticket promedio)
- **Sin carga propia:** Consume datos de Ventas e Indicadores
- **Requisito de datos:** Cada transacción de venta/costo debe tener campo "unidad de negocio"

---

## 8. RESUMEN EJECUTIVO

- **Tipo:** Pantalla principal / home de la app
- **Contenido:**
  - KPIs del mes: ventas, egresos, resultado
  - Alertas activas: vencimientos impositivos, cuentas por cobrar vencidas
  - Saldo total de tenencias
  - Comparativo mes actual vs mes anterior
- **Sin carga propia:** Todo calculado desde los otros módulos

---

## 9. DATOS DEL NEGOCIO

- **Tipo:** Ficha estática de la empresa
- **Contenido:**
  - Razón social, CUIT, domicilio fiscal
  - Actividad, fecha de inicio, antigüedad
  - Datos de contacto, responsables
  - Régimen impositivo (IVA, Ganancias, IIBB)
  - Unidades de negocio activas
- **Mantenimiento:** Carga manual, se edita cuando cambia algo

---

## MÓDULOS TRANSVERSALES

### Gestión de Datasets
- **Función:** Administrador central de fuentes de datos
- **Contenido:** Importar CSVs, ver estado de cada fuente (última actualización, registros cargados, errores)
- **Propósito:** Panel para saber qué datos están al día y cuáles faltan

### Segmentación de proveedores
- **Función:** Clasificar proveedores por criterios (volumen, frecuencia, rubro)
- **Fuente:** Se alimenta desde módulo Proveedores (Comercial)

### Segmentación de clientes
- **Función:** Clasificar clientes por criterios (volumen, frecuencia, rubro)
- **Fuente:** Se alimenta desde módulo Clientes (Comercial)

### Datos Macroeconómicos
- **Indicadores:** IPC/inflación mensual (INDEC), tipo de cambio (oficial, MEP, CCL), tasa de interés BCRA, EMAE/consumo
- **Fuente:** Automático vía API (INDEC, BCRA, dolarapi)
- **Propósito:** Alimenta los ajustes por inflación y análisis de contexto de toda la app

---

## Mapa de dependencias entre módulos

```
Datos Macro ──────────────────────────────────────────────┐
                                                          │ (IPC para ajuste)
Gestión de Datasets ──── importa datos a ──────────────►  │
                                                          ▼
POS (CSV) ──► Ventas ──────────────────────────────► Estado de Resultados
ARCA ──────► Ventas + Egresos                              ▲
F931 ──────► Sueldos ──► Egresos ──────────────────────────┘
Bancos ────► Egresos + Flujo de fondos                     │
ARBA ──────► Egresos + Impuestos                           ▼
Municipio ─► Egresos + Impuestos                      Indicadores
Contador ──► Egresos + Balance                             │
                                                           ▼
Egresos ───► Costos (reclasifica fijo/variable)    Resumen Ejecutivo
                                                           ▲
Cuentas por cobrar ──► Flujo de fondos (proyección)        │
Cuentas por pagar ───► Flujo de fondos (proyección)        │
                                                           │
Ventas + Indicadores ──► Dashboards Unidades de Negocio ───┘
```

---

## Integraciones externas requeridas

| Integración | Módulos que alimenta | Complejidad |
|---|---|---|
| POS (CSV/Excel import) | Ventas | Baja |
| ARCA/AFIP | Ventas, Egresos, Ctas cobrar/pagar, Impuestos | Alta |
| F931/SICOSS | Personal | Media |
| Extractos bancarios | Egresos, Flujo de fondos, Tenencias | Media |
| ARBA | Egresos, Impuestos | Alta |
| Municipalidad | Egresos, Impuestos | Alta |
| API Instagram/Meta | Marketing | Media |
| API INDEC/BCRA/dolarapi | Datos Macroeconómicos | Baja-Media |

---

## Próximo paso: Modelo de datos

Con esta especificación funcional cerrada, el siguiente paso es diseñar el modelo de datos (entidades, relaciones, campos clave) que soporte todos los módulos. Una vez definido el modelo, la elección de infraestructura tecnológica se vuelve mucho más clara.
