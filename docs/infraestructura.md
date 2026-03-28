# Infraestructura Tecnológica — App de Gestión San Luis
## Nadal y Zaccaro S.A.

**Fecha:** 28 de marzo de 2026  
**Versión:** 1.0

---

## Stack elegido

| Capa | Tecnología | Hosting | Costo |
|------|-----------|---------|-------|
| Frontend | Next.js 14 + React + Tailwind CSS | Vercel | Gratis |
| Base de datos | PostgreSQL (Supabase) | Supabase Cloud | Gratis (free tier) |
| Backend API | Supabase Client (desde Next.js) | — | Incluido |
| Procesador de archivos | Python (FastAPI/CLI) + pandas | Local (PC) | Gratis |
| APIs externas | Python scheduled jobs | Local (PC) | Gratis |
| Gráficos | Recharts + Chart.js | — | Gratis |
| **Costo mensual total** | | | **$0 USD** |

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│                        USUARIO                              │
│                     (navegador web)                          │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                   VERCEL (gratis)                            │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              Next.js App                               │  │
│  │                                                        │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐ │  │
│  │  │ Páginas  │  │ Gráficos │  │  Importar archivos   │ │  │
│  │  │ React +  │  │ Recharts │  │  (upload → Supabase  │ │  │
│  │  │ Tailwind │  │ Chart.js │  │   Storage → trigger  │ │  │
│  │  └──────────┘  └──────────┘  │   Python local)      │ │  │
│  │                               └──────────────────────┘ │  │
│  └───────────────────────┬───────────────────────────────┘  │
└─────────────────────────┬───────────────────────────────────┘
                          │ Supabase JS Client
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                  SUPABASE (gratis)                           │
│  ┌───────────────┐  ┌──────────────┐  ┌──────────────────┐ │
│  │  PostgreSQL   │  │   Auth       │  │    Storage       │ │
│  │  27 tablas    │  │  (1 usuario) │  │  (archivos CSV,  │ │
│  │  ~300k reg/   │  │              │  │   XLSX subidos)  │ │
│  │   año         │  │              │  │                  │ │
│  └───────────────┘  └──────────────┘  └──────────────────┘ │
│  ┌───────────────┐  ┌──────────────┐                       │
│  │  REST API     │  │  Realtime    │                       │
│  │  (automática) │  │  (alertas)   │                       │
│  └───────────────┘  └──────────────┘                       │
└─────────────────────────┬───────────────────────────────────┘
                          │ Supabase Python Client
                          ▼
┌─────────────────────────────────────────────────────────────┐
│               PC LOCAL (Python)                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │           Procesador de Archivos                       │  │
│  │                                                        │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐ │  │
│  │  │ Importar │  │ Importar │  │   APIs externas      │ │  │
│  │  │ ARCA CSV │  │ POS XLSX │  │   (INDEC, BCRA,      │ │  │
│  │  │ ARCA ZIP │  │ Banco TXT│  │    dolarapi)         │ │  │
│  │  │ MP XLSX  │  │ Banco PDF│  │   → cron job diario  │ │  │
│  │  └──────────┘  └──────────┘  └──────────────────────┘ │  │
│  │                                                        │  │
│  │  pandas + openpyxl + supabase-py                       │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## Detalle por capa

### 1. Frontend — Next.js en Vercel

**Tecnologías:**
- Next.js 14 (App Router)
- React 18
- Tailwind CSS (estilos)
- Recharts (gráficos de barras, líneas, torta, tendencias)
- Chart.js (gráficos adicionales, semaforización)
- @supabase/supabase-js (conexión directa a la base)
- date-fns (manejo de fechas)

**Estructura de páginas (mapea 1:1 con los módulos):**
```
/                          → Resumen ejecutivo (home)
/economicos
  /estado-resultados       → Estado de resultados calculado
  /ventas                  → Ventas por unidad, categoría, período
  /egresos                 → Egresos consolidados
  /balance                 → Balance del contador
  /indicadores             → Dashboard con semaforización
/financieros
  /flujo-fondos            → Flujo directo + proyección
  /tenencias               → Foto del día
  /inversiones             → Portfolio broker
  /cuentas-cobrar          → Aging + alertas
  /cuentas-pagar           → Aging + alertas
/personal
  /sueldos                 → Detalle por empleado
  /organigrama             → Visualización jerárquica
/comercial
  /marketing               → Métricas redes + calendario
  /proveedores             → Fichas + ranking
  /clientes                → Fichas + ranking + historial
/costos                    → Fijos vs variables, punto equilibrio
/impuestos                 → Calendario + posición fiscal
/unidades
  /servicios               → Dashboard Servicios
  /mostrador               → Dashboard Mostrador
  /terraza                 → Dashboard Terraza
  /decoracion              → Dashboard Decoración
/datos-negocio             → Ficha de la empresa
/datasets                  → Estado de fuentes de datos
/importar                  → Subir archivos para procesar
/macro                     → Indicadores macroeconómicos
```

---

### 2. Base de datos — Supabase (PostgreSQL)

**¿Por qué Supabase?**
- PostgreSQL completo (relaciones, índices, vistas, funciones)
- API REST automática sobre cada tabla (no hay que programar endpoints)
- Auth incluido (login con email/password)
- Storage para subir archivos (CSVs, XLSX) antes de procesarlos
- Dashboard web para ver/editar datos directamente
- Free tier: 500 MB DB, 1 GB storage, 50k filas activas
- Si se necesita más: Pro tier USD 25/mes (8 GB, filas ilimitadas)

**Consideración de volumen:**
- ~300k registros/año
- Free tier (50k filas activas) puede quedar justo después del primer año
- Opción: purgar movimiento_caja y movimiento_mp más viejos, o pasar a Pro
- Pro tier (USD 25/mes) elimina todas las restricciones

**Funciones SQL en Supabase (para cálculos complejos):**
- Vista calculada: Estado de Resultados (agrega ventas - egresos)
- Vista calculada: Aging de cuentas por cobrar/pagar
- Función: Ajuste por IPC (reexpresa montos usando indicador_macro)
- Función: Punto de equilibrio (costos fijos / margen contribución)
- Trigger: Actualizar fuente_datos.ultima_actualizacion al importar

---

### 3. Procesador Python — Local

**Tecnologías:**
- Python 3.12+
- pandas (procesamiento de datos, CSV/Excel)
- openpyxl (lectura de XLSX)
- supabase-py (cliente oficial de Supabase para Python)
- pdfplumber o camelot (parseo de PDFs bancarios)
- requests (para APIs externas)
- schedule o cron (para jobs programados)

**Estructura del procesador:**
```
san-luis-importador/
├── importar.py              ← CLI principal
├── config.py                ← URL y key de Supabase
├── parsers/
│   ├── arca_csv.py          ← ARCA compras/ventas CSV (;, UTF-8 BOM)
│   ├── arca_libro_iva.py    ← ARCA fixed-width (CABECERA/DETALLE)
│   ├── pos_mostrador.py     ← POS ventas XLSX
│   ├── pos_movcaja.py       ← POS movimientos caja XLSX
│   ├── mercado_pago.py      ← MP movimientos XLSX
│   ├── banco_provincia.py   ← Extracto TXT (Latin-1, CSV)
│   ├── banco_santander.py   ← Extracto PDF (parseo)
│   ├── sueldos.py           ← Transferencias XLSX
│   ├── impuestos_vep.py     ← VEPs nacionales CSV
│   ├── boletas_apr.py       ← Boletas municipales PDF
│   └── broker_inviu.py      ← Tenencias + voucher XLSX
├── apis/
│   ├── indec_ipc.py         ← IPC mensual
│   ├── bcra_tasa.py         ← Tasa de referencia
│   ├── dolarapi.py          ← Oficial, MEP, CCL
│   └── emae.py              ← Actividad económica
├── categorizar.py           ← Auto-clasificación de egresos
└── requirements.txt
```

**Uso típico:**
```bash
# Importar un archivo específico
python importar.py arca-compras TOTAL_EGRESOS_2026_FEBRERO.csv
python importar.py pos-mostrador MOSTRADOR_FEBRERO_2026.xlsx
python importar.py banco-provincia 5208500807_20260302_extractos.txt

# Actualizar datos macro (se puede programar con cron)
python importar.py macro --all

# Ver estado de fuentes
python importar.py status
```

**Reglas de parseo ya conocidas:**
- Formato numérico argentino: quitar puntos de miles PRIMERO, luego reemplazar coma por punto
- ARCA CSV: encoding UTF-8 BOM, separador ;, strip \ufeff de headers
- Banco Provincia: encoding Latin-1, skipear primeras 10 líneas
- Impuestos nacionales CSV: valores wrapped en ="..."

---

### 4. APIs externas

| API | Datos | Frecuencia | URL |
|-----|-------|------------|-----|
| dolarapi.com | Dólar oficial, MEP, CCL | Diaria | https://dolarapi.com/v1/dolares |
| BCRA (API pública) | Tasa de referencia | Diaria | https://api.bcra.gob.ar/ |
| INDEC (scraping o API) | IPC mensual | Mensual | Datos publicados mensualmente |
| EMAE | Actividad económica | Mensual | INDEC |
| Instagram Graph API | Métricas redes sociales | Diaria/semanal | Meta for Developers |

---

## Flujo de trabajo del usuario

```
1. IMPORTAR DATOS (mensual o cuando hay datos nuevos)
   ┌─────────────────────────────────────────┐
   │  Juan Pablo descarga archivos de:       │
   │  • ARCA (CSV o ZIP)                     │
   │  • POS (exporta XLSX)                   │
   │  • Banco Provincia (descarga TXT)       │
   │  • Banco Santander (descarga PDF)       │
   │  • Mercado Pago (exporta XLSX)          │
   │  • ARBA (screenshot o export)           │
   └──────────────┬──────────────────────────┘
                  ▼
   ┌─────────────────────────────────────────┐
   │  Corre el importador Python local:      │
   │  python importar.py arca-compras X.csv  │
   │  → parsea, categoriza, sube a Supabase  │
   └──────────────┬──────────────────────────┘
                  ▼
2. VER Y ANALIZAR (cuando quiera)
   ┌─────────────────────────────────────────┐
   │  Abre la web app en el navegador:       │
   │  https://san-luis.vercel.app            │
   │  → Ve dashboards, gráficos, alertas    │
   │  → Compara períodos, filtra por unidad  │
   │  → Revisa vencimientos y posición fiscal│
   └─────────────────────────────────────────┘
```

---

## Límites del free tier

| Servicio | Límite gratis | Cuándo se alcanza | Upgrade |
|----------|--------------|-------------------|---------|
| Vercel | 100 GB bandwidth/mes | Difícilmente (1 usuario) | Pro USD 20/mes |
| Supabase DB | 500 MB, 50k filas | ~6-12 meses | Pro USD 25/mes |
| Supabase Storage | 1 GB | Depende de archivos | Pro USD 25/mes |
| Supabase Auth | 50k MAU | Nunca (1 usuario) | — |

**Estimación realista:** El free tier debería funcionar al menos 6-12 meses. Después, Supabase Pro (USD 25/mes) resuelve todo.

---

## Plan de desarrollo sugerido

### Fase 1 — Fundación (semanas 1-3)
- Crear proyecto Supabase + schema de las 27 tablas
- Crear proyecto Next.js + deploy en Vercel
- Desarrollar parsers Python para las 3 fuentes principales: ARCA CSV, POS XLSX, Banco Provincia TXT
- Página home con KPIs básicos

### Fase 2 — Módulos core (semanas 4-8)
- Módulo Ventas (gráficos, filtros por unidad/categoría/período)
- Módulo Egresos (categorización automática)
- Estado de Resultados calculado
- Flujo de fondos (histórico desde banco + caja)
- Parsers adicionales: Mercado Pago, Banco Santander PDF, sueldos

### Fase 3 — Módulos financieros (semanas 9-12)
- Cuentas por cobrar/pagar (aging, alertas)
- Tenencias + inversiones (broker)
- Impuestos (calendario, posición fiscal)
- Indicadores con semaforización
- APIs macro (IPC, dólar, tasa BCRA)

### Fase 4 — Módulos complementarios (semanas 13-16)
- Costos (fijo/variable, punto equilibrio)
- Unidades de negocio (dashboards por unidad)
- Comercial (fichas clientes/proveedores, rankings)
- Personal (organigrama, indicadores laborales)
- Gestión de datasets (panel de estado de fuentes)

### Fase 5 — Pulido (semanas 17-20)
- Balance del contador (carga y visualización)
- Marketing (integración Instagram API)
- Segmentaciones
- Comparativos avanzados
- Resumen ejecutivo completo

---

## Repositorio

```
san-luis/
├── web/                        ← Next.js app (deploy en Vercel)
│   ├── app/                    ← Pages (App Router)
│   ├── components/             ← Componentes React
│   ├── lib/
│   │   └── supabase.ts         ← Cliente Supabase
│   ├── public/
│   ├── package.json
│   └── next.config.js
├── importador/                 ← Python procesador (local)
│   ├── importar.py
│   ├── parsers/
│   ├── apis/
│   └── requirements.txt
├── supabase/
│   └── migrations/             ← SQL migrations para las 27 tablas
└── README.md
```
