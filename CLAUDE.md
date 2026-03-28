# San Luis — App de Gestión Empresarial

App web de gestión integral para Confitería San Luis / Nadal y Zaccaro S.A., una empresa de confitería, catering y panadería en La Plata, Buenos Aires, Argentina.

## Stack

- **Frontend:** Next.js 14 (App Router) + React + Tailwind CSS + Recharts
- **Base de datos:** Supabase (PostgreSQL cloud)
- **Procesador de archivos:** Python local con pandas + supabase-py
- **Deploy:** Vercel (frontend), Supabase cloud (DB)

## Estructura del proyecto

```
san-luis/
├── CLAUDE.md                   ← Este archivo
├── web/                        ← Next.js app
│   ├── app/                    ← Pages (App Router)
│   ├── components/             ← Componentes React reutilizables
│   ├── lib/
│   │   └── supabase.ts         ← Cliente Supabase
│   └── package.json
├── importador/                 ← Python CLI para importar archivos
│   ├── importar.py             ← CLI principal
│   ├── config.py               ← Supabase URL + key
│   ├── parsers/                ← Un parser por fuente de datos
│   └── apis/                   ← Clientes para APIs externas (IPC, dólar)
├── supabase/
│   └── migrations/             ← SQL para crear las 27 tablas
├── datos-ejemplo/              ← Archivos de ejemplo para testear parsers
└── docs/                       ← Especificaciones detalladas
    ├── especificacion_funcional.md
    ├── modelo_datos_v2.md
    └── infraestructura.md
```

## Base de datos — 27 tablas

El schema SQL completo está en `supabase/migrations/`. Las tablas son:

**Referencia (4):** empresa, unidad_negocio, categoria_producto, categoria_egreso  
**Personas (3):** cliente, proveedor, empleado  
**Ventas (2):** venta, venta_detalle  
**Comprobantes (2):** factura_emitida, factura_recibida  
**Egresos (1):** egreso  
**Personal (1):** liquidacion_sueldo  
**Financiero (6):** movimiento_bancario, movimiento_caja, movimiento_mp, tenencia, inversion, inversion_movimiento  
**Impuestos (2):** impuesto_obligacion, pago_impuesto  
**Marketing (2):** accion_comercial, metrica_red_social  
**Macro/Sistema (2):** indicador_macro, fuente_datos  
**EECC (2):** balance_rubro, estado_resultados_contable  

## Reglas de negocio clave

### Formato numérico argentino
Los CSVs argentinos usan punto como separador de miles y coma como decimal.
Para parsear correctamente: quitar puntos PRIMERO, luego reemplazar coma por punto.
```python
# CORRECTO
valor = float(texto.replace('.', '').replace(',', '.'))
# INCORRECTO (produce valores 100x más grandes)
valor = float(texto.replace(',', '.'))
```

### Encodings
- ARCA CSV: UTF-8 BOM → usar `encoding='utf-8-sig'` y strip `\ufeff` de headers
- ARCA libro IVA (fixed-width): Latin-1
- Banco Provincia TXT: Latin-1
- Impuestos nacionales CSV: UTF-8 BOM, valores wrapped en `="..."` (quitar ese wrapping)

### Ajuste por inflación
- Todos los montos se almacenan en pesos nominales
- El ajuste por IPC se calcula en tiempo de consulta: `monto * (IPC_ultimo / IPC_del_mes)`
- El IPC viene de la tabla `indicador_macro` con `tipo = 'ipc'`

### Categorización de egresos
- Cada egreso se clasifica automáticamente según su fuente y tipo de comprobante
- La clasificación puede ser corregida manualmente (campo `categoria_corregida`)
- Cada categoría tiene un `tipo_costo` = 'fijo' o 'variable' (para análisis de costos)

## Módulos de la app (9 + transversales)

1. **Económicos:** Estado de Resultados (calculado), Ventas, Egresos, Balance (del contador), Indicadores
2. **Financieros:** Flujo de fondos (directo + proyección), Tenencias, Inversiones, Cuentas por cobrar, Cuentas por pagar
3. **Personal:** Sueldos y cargas sociales, Organigrama
4. **Comercial:** Marketing (API Instagram), Proveedores, Clientes
5. **Costos:** Estructura fijo/variable, punto de equilibrio, margen de contribución
6. **Impuestos:** IVA, Ganancias, IIBB, tasas municipales — calendario + posición fiscal
7. **Unidades de negocio:** Dashboards por unidad (Servicios, Mostrador, Terraza, Decoración)
8. **Resumen ejecutivo:** Home con KPIs, alertas, comparativos
9. **Datos del negocio:** Ficha de la empresa

**Transversales:** Gestión de datasets, Segmentación proveedores/clientes, Datos macroeconómicos

## Plan de desarrollo

### Fase 1 — Fundación (arrancar por acá)
1. Crear schema SQL en Supabase (las 27 tablas)
2. Crear proyecto Next.js con estructura de carpetas
3. Desarrollar parsers Python: ARCA CSV, POS XLSX, Banco Provincia TXT
4. Página home con KPIs básicos

### Fase 2 — Módulos core
- Ventas, Egresos, Estado de Resultados, Flujo de fondos
- Parsers: Mercado Pago, Banco Santander PDF, sueldos

### Fase 3 — Financieros
- Cuentas por cobrar/pagar, Tenencias, Inversiones, Impuestos
- APIs macro (IPC, dólar)

### Fase 4 — Complementarios
- Costos, Unidades de negocio, Comercial, Personal, Datasets

### Fase 5 — Pulido
- Balance, Marketing, Segmentaciones, Resumen ejecutivo completo

## Convenciones de código

- **Idioma del código:** inglés (variables, funciones, componentes)
- **Idioma de la UI:** español argentino
- **Formato de fechas en DB:** ISO 8601 (YYYY-MM-DD)
- **Formato de fechas en UI:** DD/MM/YYYY (argentino)
- **Moneda:** siempre ARS salvo indicación explícita
- **Componentes React:** functional components con hooks
- **Estilos:** Tailwind CSS utility classes, sin CSS custom
- **Naming:** camelCase en JS/TS, snake_case en Python y SQL

## Datos de la empresa

- **Razón social:** Nadal y Zaccaro S.A.
- **Nombre fantasía:** Confitería San Luis
- **CUIT:** 30-65703377-0
- **Domicilio:** Calle 7 N° 1500 (1900) La Plata, Buenos Aires
- **Actividad:** Fabricación de panificados y confituras
- **Unidades de negocio:** Servicios (catering), Mostrador, Terraza, Decoración

## Para más detalle

Consultá los documentos en `docs/`:
- `docs/especificacion_funcional.md` — qué hace cada módulo
- `docs/modelo_datos_v2.md` — las 27 tablas con todos los campos
- `docs/infraestructura.md` — arquitectura, hosting, plan de desarrollo
