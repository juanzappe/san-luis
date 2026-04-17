"use client";

import { useMemo } from "react";
import {
  LineChart, Line, BarChart, Bar, ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { TrendingUp, TrendingDown, Target, Loader2, AlertCircle } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Callout } from "@/components/callout";
import { InflationToggle, useInflation } from "@/lib/inflation";
import {
  type EgresoRow,
  type ResultadoRow,
  formatARS,
  shortLabel,
} from "@/lib/economic-queries";
import { useEgresosData } from "@/lib/use-egresos-data";
import { getCuotaFija } from "@/lib/tax-queries";
import type {
  Formatter, ValueType, NameType,
} from "recharts/types/component/DefaultTooltipContent";

const arsTooltip: Formatter<ValueType, NameType> = (v) => formatARS(Number(v ?? 0));

// ---------------------------------------------------------------------------
// Clasificación de costos por defecto
// ---------------------------------------------------------------------------
// Mientras categoria_egreso.tipo_costo no esté configurado correctamente,
// usamos este mapeo como override. Cada nombre exacto (sensible a
// mayús/minús, acentos) se mapea a "fijo" o "variable".
// Lo que no aparezca cae a "variable" por defecto.
// ---------------------------------------------------------------------------
const COSTO_FIJO_CATEGORIAS = new Set<string>([
  "Alquileres",
  "Cuotas y membresías",
  "Gastos administrativos",
  "Honorarios",
  "Seguridad",
  "Seguros",
  "Servicios (Agua)",
  "Servicios (Gas)",
  "Servicios (Luz)",
  "Servicios (Otros)",
  "Servicios profesionales",
  "Sistemas informacion",
  "Telefonía",
  "Equipamiento",
]);

function tipoDe(nombre: string): "fijo" | "variable" {
  if (COSTO_FIJO_CATEGORIAS.has(nombre)) return "fijo";
  return "variable";
}

// ---------------------------------------------------------------------------
// Descomposición de los egresos en fijos y variables por mes
// ---------------------------------------------------------------------------

interface MonthCosto {
  periodo: string;
  ingresos: number;
  fijo: number;
  variable: number;
  total: number;
  margenContribucion: number;
  margenContribucionPct: number;
  puntoEquilibrio: number;
}

function buildMonthlyCostos(
  egresos: EgresoRow[],
  resultado: Map<string, ResultadoRow>,
): MonthCosto[] {
  return egresos.map((r) => {
    const ing = resultado.get(r.periodo)?.ingresos ?? 0;

    // 1) Categorías de proveedores → fijo o variable según mapeo
    let provFijo = 0;
    let provVariable = 0;
    for (const [cat, monto] of Object.entries(r.categorias)) {
      if (tipoDe(cat) === "fijo") provFijo += monto;
      else provVariable += monto;
    }

    // 2) Sueldos + Cargas Sociales → FIJO
    const personal = r.sueldosNeto + r.cargasSociales;

    // 3) Gastos Comerciales: IIBB/SegHig variables; cuotas fijas municipales fijas
    const iibb = ing * 0.045;
    const segHig = ing * 0.01;
    const cuotaPublicidad = getCuotaFija("publicidad", r.periodo);
    const cuotaEspPublico = getCuotaFija("espacioPublico", r.periodo);
    const comercialesVariable = iibb + segHig;
    const comercialesFijo = cuotaPublicidad + cuotaEspPublico;

    // 4) Financieros bancarios → fijo (comisiones, seguros, mantenimiento)
    const financieros = r.financieros;

    // 5) Impuesto Ganancias → VARIABLE (proporcional al resultado)
    const ganancias = r.ganancias;

    const fijo = provFijo + personal + comercialesFijo + financieros;
    const variable = provVariable + comercialesVariable + ganancias;
    const total = fijo + variable;

    const margenContribucion = ing - variable;
    const margenContribucionPct = ing > 0 ? margenContribucion / ing : 0;
    const puntoEquilibrio = margenContribucionPct > 0 ? fijo / margenContribucionPct : 0;

    return {
      periodo: r.periodo,
      ingresos: ing,
      fijo,
      variable,
      total,
      margenContribucion,
      margenContribucionPct,
      puntoEquilibrio,
    };
  });
}

// ---------------------------------------------------------------------------
// Tabla — desglose por concepto, tipo y monto del mes seleccionado
// ---------------------------------------------------------------------------

function DesgloseTabla({
  egreso,
  ingresos,
}: {
  egreso: EgresoRow;
  ingresos: number;
}) {
  const rows = useMemo(() => {
    const acc: { nombre: string; tipo: "fijo" | "variable"; monto: number }[] = [];
    for (const [cat, monto] of Object.entries(egreso.categorias)) {
      acc.push({ nombre: cat, tipo: tipoDe(cat), monto });
    }
    if (egreso.sueldosNeto > 0) acc.push({ nombre: "Sueldos Neto", tipo: "fijo", monto: egreso.sueldosNeto });
    if (egreso.cargasSociales > 0) acc.push({ nombre: "Cargas Sociales (F.931)", tipo: "fijo", monto: egreso.cargasSociales });

    const iibb = ingresos * 0.045;
    const segHig = ingresos * 0.01;
    const pub = getCuotaFija("publicidad", egreso.periodo);
    const esp = getCuotaFija("espacioPublico", egreso.periodo);
    if (iibb > 0) acc.push({ nombre: "IIBB (4,5%)", tipo: "variable", monto: iibb });
    if (segHig > 0) acc.push({ nombre: "Seg. e Higiene (1%)", tipo: "variable", monto: segHig });
    if (pub > 0) acc.push({ nombre: "Publicidad (municipal)", tipo: "fijo", monto: pub });
    if (esp > 0) acc.push({ nombre: "Esp. Público (municipal)", tipo: "fijo", monto: esp });

    if (egreso.financieros > 0) acc.push({ nombre: "Gastos Financieros", tipo: "fijo", monto: egreso.financieros });
    if (egreso.ganancias > 0) acc.push({ nombre: "Imp. a las Ganancias", tipo: "variable", monto: egreso.ganancias });

    return acc.sort((a, b) => b.monto - a.monto);
  }, [egreso, ingresos]);

  const totalFijo = rows.filter((r) => r.tipo === "fijo").reduce((s, r) => s + r.monto, 0);
  const totalVariable = rows.filter((r) => r.tipo === "variable").reduce((s, r) => s + r.monto, 0);
  const total = totalFijo + totalVariable;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Desglose Fijo / Variable — {egreso.periodo}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 z-20 bg-card">Concepto</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Monto</TableHead>
                <TableHead className="text-right">% del total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={`${r.nombre}-${i}`}>
                  <TableCell className="sticky left-0 z-10 bg-card font-medium">{r.nombre}</TableCell>
                  <TableCell>
                    <span
                      className={`inline-block rounded px-2 py-0.5 text-[10px] font-medium ${
                        r.tipo === "fijo"
                          ? "bg-blue-100 text-blue-800"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {r.tipo === "fijo" ? "FIJO" : "VARIABLE"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">{formatARS(r.monto)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {total > 0 ? ((r.monto / total) * 100).toFixed(1) : "0"}%
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="border-t-2 border-foreground/20">
                <TableCell className="sticky left-0 z-10 bg-card font-bold">Total Fijos</TableCell>
                <TableCell />
                <TableCell className="text-right font-bold">{formatARS(totalFijo)}</TableCell>
                <TableCell className="text-right font-bold">{total > 0 ? ((totalFijo / total) * 100).toFixed(1) : "0"}%</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="sticky left-0 z-10 bg-card font-bold">Total Variables</TableCell>
                <TableCell />
                <TableCell className="text-right font-bold">{formatARS(totalVariable)}</TableCell>
                <TableCell className="text-right font-bold">{total > 0 ? ((totalVariable / total) * 100).toFixed(1) : "0"}%</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export default function CostosPage() {
  const { adjust } = useInflation();
  const { data, resultadoData, loading, error } = useEgresosData();

  const monthly = useMemo(() => buildMonthlyCostos(data, resultadoData), [data, resultadoData]);

  const last = monthly.length > 0 ? monthly[monthly.length - 1] : null;
  const prev = monthly.length > 1 ? monthly[monthly.length - 2] : null;

  // Promedio móvil de 3 meses del margen contribución % (más estable)
  const margenMM3 = useMemo(() => {
    if (monthly.length === 0) return 0;
    const last3 = monthly.slice(-3);
    const totalIng = last3.reduce((s, m) => s + m.ingresos, 0);
    const totalVar = last3.reduce((s, m) => s + m.variable, 0);
    return totalIng > 0 ? (totalIng - totalVar) / totalIng : 0;
  }, [monthly]);

  const cfMM3 = useMemo(() => {
    if (monthly.length === 0) return 0;
    const last3 = monthly.slice(-3);
    return last3.reduce((s, m) => s + m.fijo, 0) / last3.length;
  }, [monthly]);

  const peEstable = margenMM3 > 0 ? cfMM3 / margenMM3 : 0;

  const chartData = useMemo(
    () =>
      monthly.slice(-24).map((m) => ({
        label: shortLabel(m.periodo),
        periodo: m.periodo,
        fijo: adjust(m.fijo, m.periodo),
        variable: adjust(m.variable, m.periodo),
        ingresos: adjust(m.ingresos, m.periodo),
        puntoEquilibrio: adjust(m.puntoEquilibrio, m.periodo),
        margenContribucionPct: m.margenContribucionPct * 100,
      })),
    [monthly, adjust],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-3 text-muted-foreground">Cargando datos...</span>
      </div>
    );
  }
  if (error) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-8">
          <AlertCircle className="h-5 w-5 text-red-500" />
          <p className="text-sm">{error}</p>
        </CardContent>
      </Card>
    );
  }
  if (data.length === 0 || !last) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 font-medium">Sin datos de costos</p>
        </CardContent>
      </Card>
    );
  }

  const lastIngresosAdj = adjust(last.ingresos, last.periodo);
  const cubriendoPE = lastIngresosAdj >= adjust(peEstable, last.periodo);
  const lastEgreso = data[data.length - 1];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Costos</h1>
          <p className="text-muted-foreground">Estructura de costos fijos vs variables y punto de equilibrio</p>
        </div>
        <InflationToggle />
      </div>

      <Callout>
        <p>
          Los egresos se dividen en <strong>fijos</strong> (no dependen del volumen — alquiler, sueldos, servicios)
          y <strong>variables</strong> (escalan con las ventas — insumos, IIBB, comisiones).
        </p>
        <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
          <li>
            <strong className="text-foreground">Margen de contribución</strong>: ingresos − costos variables. Es la plata
            que queda de cada peso facturado para cubrir los fijos.
          </li>
          <li>
            <strong className="text-foreground">Punto de equilibrio</strong>: cuánto hay que facturar en un mes para
            no perder plata. Fórmula: <em>Costos Fijos ÷ Margen de Contribución %</em>.
          </li>
          <li>
            Si los ingresos del mes están <strong>por encima</strong> del punto de equilibrio, hay ganancia. Si están
            por debajo, hay pérdida.
          </li>
          <li className="text-amber-700">
            ⚠️ La clasificación de cada categoría como fija o variable se define en <code>categoria_egreso.tipo_costo</code>
            — hoy todas están marcadas como variable en la DB. Esta página usa un mapeo por defecto (sueldos, alquiler,
            servicios = fijo; insumos, IIBB, ganancias = variable). Cuando ajustes la clasificación en la DB,
            los números se refinan solos.
          </li>
        </ul>
      </Callout>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Costos Fijos</CardTitle>
            <span className="h-3 w-3 rounded-full bg-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatARS(adjust(last.fijo, last.periodo))}</div>
            {prev && prev.fijo > 0 && (
              <p className={`text-xs ${last.fijo < prev.fijo ? "text-green-600" : "text-red-600"}`}>
                {((last.fijo / prev.fijo - 1) * 100).toFixed(1)}% vs mes anterior
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Costos Variables</CardTitle>
            <span className="h-3 w-3 rounded-full bg-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatARS(adjust(last.variable, last.periodo))}</div>
            {prev && prev.variable > 0 && (
              <p className={`text-xs ${last.variable < prev.variable ? "text-green-600" : "text-red-600"}`}>
                {((last.variable / prev.variable - 1) * 100).toFixed(1)}% vs mes anterior
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Margen Contribución</CardTitle>
            {last.margenContribucion >= 0 ? (
              <TrendingUp className="h-4 w-4 text-green-600" />
            ) : (
              <TrendingDown className="h-4 w-4 text-red-600" />
            )}
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatARS(adjust(last.margenContribucion, last.periodo))}</div>
            <p className="text-xs text-muted-foreground">
              {(last.margenContribucionPct * 100).toFixed(1)}% de los ingresos
            </p>
          </CardContent>
        </Card>
        <Card className={cubriendoPE ? "border-green-500/30" : "border-red-500/30"}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Punto de Equilibrio</CardTitle>
            <Target className={`h-4 w-4 ${cubriendoPE ? "text-green-600" : "text-red-600"}`} />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatARS(adjust(peEstable, last.periodo))}</div>
            <p className="text-xs text-muted-foreground">Estable — promedio móvil 3m</p>
            {cubriendoPE ? (
              <p className="text-xs text-green-600 mt-1">
                Facturación lo cubre (+{formatARS(lastIngresosAdj - adjust(peEstable, last.periodo))})
              </p>
            ) : (
              <p className="text-xs text-red-600 mt-1">
                Faltan {formatARS(adjust(peEstable, last.periodo) - lastIngresosAdj)} para cubrirlo
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Ingresos vs Punto de Equilibrio */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ingresos vs Punto de Equilibrio</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={360}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="label" fontSize={12} />
              <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
              <Tooltip formatter={arsTooltip} />
              <Legend />
              <Line type="monotone" dataKey="ingresos" name="Ingresos" stroke="#22c55e" strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} />
              <Line type="monotone" dataKey="puntoEquilibrio" name="Punto de equilibrio" stroke="#ef4444" strokeWidth={2} strokeDasharray="4 4" dot={false} connectNulls={false} />
            </ComposedChart>
          </ResponsiveContainer>
          <p className="mt-2 text-xs text-muted-foreground">
            Facturación mensual vs punto de equilibrio del mes (CF ÷ MC%). Cada mes donde la línea verde está arriba de la roja, hubo ganancia.
          </p>
        </CardContent>
      </Card>

      {/* Fijos vs Variables */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Costos Fijos y Variables por mes</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="label" fontSize={12} />
              <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
              <Tooltip formatter={arsTooltip} />
              <Legend />
              <Bar dataKey="fijo" name="Fijos" stackId="a" fill="#3b82f6" />
              <Bar dataKey="variable" name="Variables" stackId="a" fill="#f59e0b" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <p className="mt-2 text-xs text-muted-foreground">
            Un crecimiento de fijos sin crecimiento proporcional de ingresos eleva el punto de equilibrio.
          </p>
        </CardContent>
      </Card>

      {/* Margen Contribución % */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Margen de Contribución (%)</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="label" fontSize={12} />
              <YAxis fontSize={12} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
              <Tooltip formatter={((v: ValueType | undefined) => `${Number(v ?? 0).toFixed(1)}%`) as Formatter<ValueType, NameType>} />
              <ReferenceLine y={0} stroke="#666" />
              <Line type="monotone" dataKey="margenContribucionPct" name="MC %" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
          <p className="mt-2 text-xs text-muted-foreground">
            % de cada peso facturado que queda después de pagar los costos variables. Si cae, los costos variables crecen más rápido que los ingresos.
          </p>
        </CardContent>
      </Card>

      <DesgloseTabla egreso={lastEgreso} ingresos={resultadoData.get(lastEgreso.periodo)?.ingresos ?? 0} />
    </div>
  );
}
