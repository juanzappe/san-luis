# Egresos — estado de implementación (2026-04-17)

Documento vivo sobre la implementación completa de Egresos + Costos.

---

## ✅ Implementado en este sprint (Waves 1-6)

### Wave 1 — Decisiones de negocio

1. **Imp. al Cheque (LEY 25.413) movido a Gastos Comerciales** (antes en Financieros).
   - `useEgresosData`: `r.financieros` ya no incluye cheque; el cálculo de `gananciasBase` lo computa dentro de `costCom`.
   - `estado-resultados/derivePnlRow`: cheque suma en `costComNominal`, sale de `costFin`.
   - `egresos/page.tsx` main: función `gastosComerciales(r)` incluye cheque.
   - `gastos-comerciales/page.tsx`: agregado "Imp. al Cheque" como breakdown item con color propio.
   - `gastos-financieros/page.tsx`: nota al pie confirma que no se incluye acá.

2. **Tail categorías → "Otros"** en main egresos. Umbral 2% del total histórico. Pie de página indica qué categorías se agruparon.

### Wave 2 — Charts principales del main

1. **Ingresos vs Egresos** — 2 líneas 24 meses con área verde del margen.
2. **Cascada del mes** — waterfall Ingresos → Resultado.
3. **Estructura de Costos %** — 5 líneas evolutivas (cada categoría como % de ingresos).

### Wave 3 — Nueva sección `/costos`

Página completa con:
- Callout explicativo.
- 4 KPI cards (CF, CV, Margen Contrib. $ y %, Punto de Equilibrio estable).
- Chart Ingresos vs PE (2 líneas).
- Chart Costos Fijos y Variables (stacked bar).
- Chart Margen de Contribución % (line).
- Tabla desglose por concepto con badges F/V.
- Card del PE con borde verde/rojo según cubre o no la facturación.

Clasificación por defecto mientras `categoria_egreso.tipo_costo` no esté correctamente configurado en DB (hoy todas están como `variable`). Mapeo hardcoded en el frontend:
- **Fijos**: Alquileres, Cuotas/membresías, Gastos admin., Honorarios, Seguridad, Seguros, Servicios (Agua/Gas/Luz/Otros), Servicios profesionales, Sistemas información, Telefonía, Equipamiento, Sueldos+CS, cuotas fijas municipales, Gastos Financieros.
- **Variables**: el resto (CMV, Insumos, Nafta, Plataformas delivery, Terminales, Limpieza, etc.), IIBB (4,5%), Seg. e Higiene (1%), Imp. Ganancias.

### Wave 4 — RECPAM / Ganancias estimables

- Nueva función `computeTasasEfectivasFromEECC(eecc, ultimosN)` en `economic-queries.ts` que, dado los EECC auditados, devuelve `{porEjercicio, promedio, fuente}`.
- En `/economico/egresos/impuesto-ganancias`: card nueva "Tasa efectiva histórica — derivada de EECC" que muestra año por año el impuesto pagado, el resultado antes de impuesto, y la tasa efectiva. Promedio de últimos 2 años computado dinámicamente.
- **Limitación**: el número que se usa para el cálculo del P&L sigue siendo la constante `TASA_GANANCIAS = 0.367`. Cuando se cargue EECC 2025 o 2026 al DB, el card muestra el nuevo promedio pero hay que actualizar el constant manualmente. Hacer la tasa completamente dinámica requiere refactor del pipeline (pasar `tasa` como parámetro en lugar de importarla).
- **RECPAM**: no se pudo derivar de EECC porque la línea "Gastos Financ. Y Otros, incluido el Recpam" tiene otros componentes mezclados. Queda hardcoded en `RECPAM_HISTORICO` con nota explicativa (fuente: Anexo III de los balances).

### Wave 5 — Charts en subpáginas

- **Sueldos**: chart Ratio CS/Neto + chart Costo por empleado (usa `liquidacion_sueldo` para headcount, excluye SAC).
- **Gastos Comerciales**: chart Saldo IVA Acumulado (24 meses, línea mensual + línea acumulado).
- **Gastos Financieros**: chart Intereses+Comisiones acumulados 12m (ventana móvil).
- **Costos Operativos**: chart Evolución Top 5 Categorías + "Resto".
- **Imp. a las Ganancias**: card Tasas Efectivas Históricas (ver Wave 4).

### Wave 6 — Docs

- `especificacion_funcional.md` actualizado (secciones 1.3 y 5).
- Este doc rescrito con estado actual.

---

## 🚫 Propuestas de chart que NO se hicieron (requieren RPCs nuevas)

Para futuros sprints si hacen falta:

1. **Top proveedores del mes** (costos-operativos) — necesita RPC `get_top_proveedores(periodo, limit)` que agrupe `factura_recibida` por proveedor. Probablemente ya existe algo en la sección Proveedores.
2. **IIBB proyectado vs efectivamente pagado** (gastos-comerciales) — requiere traer `posicion_iibb` pagada y cruzarla con el devengado.
3. **Comisiones MP como % de ingresos MP** (gastos-financieros) — requiere RPC que traiga ingresos MP separadamente.
4. **Ganancias devengadas vs anticipos pagados** (imp-ganancias) — requiere traer los pagos de Ganancias desde `pago_impuesto` filtrados.

---

## 🔧 Items pendientes del lado de DB / config

1. **`categoria_egreso.tipo_costo`**: hoy todas las 26 categorías están como `variable`. Reclasificar correctamente en DB para que `/costos` deje de depender del mapeo hardcoded. Sugerido: update SQL directo con UPDATE por nombre, o UI de edición en la sección Proveedores.

2. **RECPAM histórico**: cargar una tabla `recpam_anual` (año, monto_recpam) en DB para no depender de `RECPAM_HISTORICO` hardcoded. Permite que se actualice cuando se sumen nuevos EECC.

3. **`TASA_GANANCIAS` dinámica**: hacer que el pipeline (useEgresosData + derivePnlRow) acepten la tasa como parámetro computado al inicio, no como constante import. Hoy queda hardcoded en 0.367.

---

## Estado técnico

- **Typecheck (tsc --noEmit)**: limpio.
- **Lint (next lint)**: limpio.
- **Build (next build)**: las 7 rutas compilan (main + 5 subpáginas + `/costos`).
- **Archivos tocados**:
  - `src/lib/economic-queries.ts` — nueva función `computeTasasEfectivasFromEECC`.
  - `src/lib/use-egresos-data.ts` — cheque movido de Financieros a Comerciales.
  - `src/components/callout.tsx` — nuevo (reutilizable).
  - `src/components/egreso-detail-page.tsx` — callout + YoY + sticky + colores invertidos.
  - `src/app/economico/egresos/page.tsx` — 3 charts nuevos + tail Otros + YoY.
  - `src/app/economico/egresos/costos-operativos/page.tsx` — callout + evolución top categorías.
  - `src/app/economico/egresos/sueldos/page.tsx` — callout + ratio CS/Neto + costo x empleado.
  - `src/app/economico/egresos/gastos-comerciales/page.tsx` — callout + Imp. al Cheque breakdown + Saldo IVA acumulado.
  - `src/app/economico/egresos/gastos-financieros/page.tsx` — callout + intereses 12m.
  - `src/app/economico/egresos/impuesto-ganancias/page.tsx` — callout + tasas efectivas card.
  - `src/app/economico/estado-resultados/page.tsx` — cheque movido de costFin a costCom en `derivePnlRow`.
  - `src/app/costos/page.tsx` — página completa nueva.
  - `docs/especificacion_funcional.md` — secciones 1.3 y 5 actualizadas.
  - `docs/egresos_propuestas.md` — este doc reescrito.
