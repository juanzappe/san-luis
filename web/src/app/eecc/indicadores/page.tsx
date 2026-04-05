"use client";

import { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { Info } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// ---------------------------------------------------------------------------
// Data — estados contables auditados al cierre de cada ejercicio
// ---------------------------------------------------------------------------

const AÑOS = [2021, 2022, 2023, 2024] as const;
type Año = (typeof AÑOS)[number];

const INDICADORES = {
  resultados: {
    ventas:        [732.8, 1649.4, 2417.2, 1674.7],
    utilidadBruta: [42.0,   401.0, 1144.6,  691.3],
    ebitda:        [9.4,    282.7,  985.7,   570.7],
    ebit:          [-8.8,   259.5,  955.5,   538.4],
    utilidadNeta:  [48.3,   213.0,  303.8,    94.2],
  },
  patrimonial: {
    activoTotal:    [382.2,  757.0, 1001.4,  963.1],
    pasivoTotal:    [189.5,  364.3,  310.0,  262.5],
    patrimonioNeto: [192.7,  392.7,  691.4,  700.6],
    capitalTrabajo: [17.2,   314.4,  193.9,  307.7],
    deudaFinanciera:[73.7,   156.9,   91.3,  110.9],
  },
  rentabilidad: {
    roa:          [0.126, 0.281, 0.303, 0.098],
    roe:          [0.251, 0.542, 0.439, 0.135],
    margenBruto:  [0.057, 0.243, 0.474, 0.413],
    margenEbitda: [0.013, 0.171, 0.408, 0.341],
    margenNeto:   [0.066, 0.129, 0.126, 0.056],
  },
  liquidez: {
    corriente: [1.049, 1.549, 2.480, 3.398],
    acida:     [1.001, 1.527, 2.464, 3.286],
  },
  apalancamiento: {
    deudaActivo:   [0.496, 0.481, 0.310, 0.273],
    deudaPn:       [0.983, 0.928, 0.448, 0.375],
    coberturaEbit: [-0.48, 11.47, 21.37, 14.71],
  },
  eficiencia: {
    rotacionActivos: [1.92, 2.18, 2.41, 1.74],
    plazoCobranza:   [15,   77,   37,   55],
    cicloOperativo:  [19,   80,   38,   66],
  },
} as const;

function val<T extends Record<string, readonly number[]>>(
  group: T,
  key: keyof T,
  año: Año,
): number {
  const idx = AÑOS.indexOf(año);
  return (group[key] as readonly number[])[idx];
}

// ---------------------------------------------------------------------------
// Semaphore helpers
// ---------------------------------------------------------------------------

type Semaphore = "green" | "yellow" | "red" | "neutral";

const SEMAPHORE_CLASSES: Record<Semaphore, string> = {
  green:   "bg-green-500",
  yellow:  "bg-amber-400",
  red:     "bg-red-500",
  neutral: "bg-gray-300",
};

const SEMAPHORE_TEXT: Record<Semaphore, string> = {
  green:   "text-green-700 dark:text-green-400",
  yellow:  "text-amber-700 dark:text-amber-400",
  red:     "text-red-700 dark:text-red-400",
  neutral: "text-muted-foreground",
};

function semLiquidezCorriente(v: number): Semaphore {
  return v > 1.5 ? "green" : v >= 1.0 ? "yellow" : "red";
}
function semMargenNeto(v: number): Semaphore {
  return v > 0.10 ? "green" : v >= 0.05 ? "yellow" : "red";
}
function semCoberturaEbit(v: number): Semaphore {
  return v > 3 ? "green" : v >= 1 ? "yellow" : "red";
}
function semRoe(v: number): Semaphore {
  return v > 0.15 ? "green" : v >= 0.08 ? "yellow" : "red";
}
function semRoa(v: number): Semaphore {
  return v > 0.12 ? "green" : v >= 0.06 ? "yellow" : "red";
}
function semMargenBruto(v: number): Semaphore {
  return v > 0.30 ? "green" : v >= 0.15 ? "yellow" : "red";
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function fPct(v: number, decimals = 1): string {
  return `${(v * 100).toFixed(decimals)}%`;
}
function fX(v: number, decimals = 2): string {
  return `${v >= 0 ? "" : ""}${v.toFixed(decimals)}x`;
}
function fM(v: number): string {
  return `$${v.toFixed(1)}M`;
}
function fD(v: number): string {
  return `${Math.round(v)} días`;
}

// ---------------------------------------------------------------------------
// Year selector
// ---------------------------------------------------------------------------

function YearSelector({ value, onChange }: { value: Año; onChange: (v: Año) => void }) {
  return (
    <div className="flex items-center rounded-lg border text-xs font-medium">
      {AÑOS.map((a) => (
        <button
          key={a}
          onClick={() => onChange(a)}
          className={`px-3 py-1.5 transition-colors first:rounded-l-lg last:rounded-r-lg ${
            value === a ? "bg-primary text-primary-foreground" : "hover:bg-accent"
          }`}
        >
          {a}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Indicator card
// ---------------------------------------------------------------------------

function IndicatorCard({
  label,
  value,
  semaphore = "neutral",
  sub,
}: {
  label: string;
  value: string;
  semaphore?: Semaphore;
  sub?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className={`h-2 w-2 flex-shrink-0 rounded-full ${SEMAPHORE_CLASSES[semaphore]}`} />
      </div>
      <span className={`text-xl font-bold tabular-nums ${SEMAPHORE_TEXT[semaphore]}`}>{value}</span>
      {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {children}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Chart data helpers
// ---------------------------------------------------------------------------

const marginesChartData = AÑOS.map((a, i) => ({
  año: String(a),
  "Margen Bruto":  +(INDICADORES.rentabilidad.margenBruto[i] * 100).toFixed(1),
  "Margen EBITDA": +(INDICADORES.rentabilidad.margenEbitda[i] * 100).toFixed(1),
  "Margen Neto":   +(INDICADORES.rentabilidad.margenNeto[i] * 100).toFixed(1),
}));

const rentabilidadChartData = AÑOS.map((a, i) => ({
  año: String(a),
  ROA: +(INDICADORES.rentabilidad.roa[i] * 100).toFixed(1),
  ROE: +(INDICADORES.rentabilidad.roe[i] * 100).toFixed(1),
}));

const liquidezChartData = AÑOS.map((a, i) => ({
  año: String(a),
  Corriente: +INDICADORES.liquidez.corriente[i].toFixed(3),
  Ácida:     +INDICADORES.liquidez.acida[i].toFixed(3),
}));

const coberturaChartData = AÑOS.map((a, i) => ({
  año: String(a),
  "Cobertura EBIT": +INDICADORES.apalancamiento.coberturaEbit[i].toFixed(2),
}));

// ---------------------------------------------------------------------------
// KPI strip — top 4 highlights for selected year
// ---------------------------------------------------------------------------

function KpiStrip({ año }: { año: Año }) {
  const liq = val(INDICADORES.liquidez, "corriente", año);
  const mn  = val(INDICADORES.rentabilidad, "margenNeto", año);
  const roe = val(INDICADORES.rentabilidad, "roe", año);
  const cob = val(INDICADORES.apalancamiento, "coberturaEbit", año);

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Liquidez Corriente</p>
              <p className={`mt-1 text-3xl font-bold tabular-nums ${SEMAPHORE_TEXT[semLiquidezCorriente(liq)]}`}>
                {fX(liq)}
              </p>
            </div>
            <span className={`mt-1 h-3 w-3 rounded-full ${SEMAPHORE_CLASSES[semLiquidezCorriente(liq)]}`} />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Margen Neto</p>
              <p className={`mt-1 text-3xl font-bold tabular-nums ${SEMAPHORE_TEXT[semMargenNeto(mn)]}`}>
                {fPct(mn)}
              </p>
            </div>
            <span className={`mt-1 h-3 w-3 rounded-full ${SEMAPHORE_CLASSES[semMargenNeto(mn)]}`} />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-muted-foreground">ROE</p>
              <p className={`mt-1 text-3xl font-bold tabular-nums ${SEMAPHORE_TEXT[semRoe(roe)]}`}>
                {fPct(roe)}
              </p>
            </div>
            <span className={`mt-1 h-3 w-3 rounded-full ${SEMAPHORE_CLASSES[semRoe(roe)]}`} />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Cobertura EBIT</p>
              <p className={`mt-1 text-3xl font-bold tabular-nums ${SEMAPHORE_TEXT[semCoberturaEbit(cob)]}`}>
                {fX(cob)}
              </p>
            </div>
            <span className={`mt-1 h-3 w-3 rounded-full ${SEMAPHORE_CLASSES[semCoberturaEbit(cob)]}`} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function IndicadoresPage() {
  const [año, setAño] = useState<Año>(2024);

  const r   = INDICADORES.resultados;
  const pat = INDICADORES.patrimonial;
  const ren = INDICADORES.rentabilidad;
  const liq = INDICADORES.liquidez;
  const apa = INDICADORES.apalancamiento;
  const ef  = INDICADORES.eficiencia;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Indicadores</h1>
          <p className="text-muted-foreground">
            Ratios financieros — ejercicios 2021–2024
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs text-muted-foreground"
            title="Valores calculados sobre estados contables auditados en moneda homogénea (RT 6)"
          >
            <Info className="h-3.5 w-3.5" />
            Moneda homogénea — RT 6
          </span>
          <YearSelector value={año} onChange={setAño} />
        </div>
      </div>

      {/* KPI highlights */}
      <KpiStrip año={año} />

      {/* Indicator sections */}
      <Section title="Rentabilidad">
        <IndicatorCard label="ROA"           value={fPct(val(ren, "roa",          año))} semaphore={semRoa(val(ren, "roa", año))}         sub="Retorno sobre activos" />
        <IndicatorCard label="ROE"           value={fPct(val(ren, "roe",          año))} semaphore={semRoe(val(ren, "roe", año))}         sub="Retorno sobre patrimonio" />
        <IndicatorCard label="Margen Bruto"  value={fPct(val(ren, "margenBruto",  año))} semaphore={semMargenBruto(val(ren, "margenBruto", año))} />
        <IndicatorCard label="Margen EBITDA" value={fPct(val(ren, "margenEbitda", año))} semaphore="neutral" />
        <IndicatorCard label="Margen Neto"   value={fPct(val(ren, "margenNeto",   año))} semaphore={semMargenNeto(val(ren, "margenNeto", año))} />
      </Section>

      <Section title="Liquidez">
        <IndicatorCard label="Liquidez Corriente" value={fX(val(liq, "corriente", año))} semaphore={semLiquidezCorriente(val(liq, "corriente", año))} sub="AC / PC" />
        <IndicatorCard label="Liquidez Ácida"     value={fX(val(liq, "acida",     año))} semaphore={semLiquidezCorriente(val(liq, "acida", año))}     sub="(AC − Inventario) / PC" />
      </Section>

      <Section title="Apalancamiento">
        <IndicatorCard label="Deuda / Activo"    value={fX(val(apa, "deudaActivo",   año))} semaphore="neutral" sub="Leverage total" />
        <IndicatorCard label="Deuda / PN"        value={fX(val(apa, "deudaPn",       año))} semaphore="neutral" sub="Leverage financiero" />
        <IndicatorCard label="Cobertura EBIT"    value={fX(val(apa, "coberturaEbit", año))} semaphore={semCoberturaEbit(val(apa, "coberturaEbit", año))} sub="EBIT / Gastos financieros" />
      </Section>

      <Section title="Eficiencia">
        <IndicatorCard label="Rotación de Activos" value={fX(val(ef, "rotacionActivos", año))} semaphore="neutral" sub="Ventas / Activo Total" />
        <IndicatorCard label="Plazo de Cobranza"   value={fD(val(ef, "plazoCobranza",   año))} semaphore="neutral" sub="CxC / Ventas × 365" />
        <IndicatorCard label="Ciclo Operativo"     value={fD(val(ef, "cicloOperativo",  año))} semaphore="neutral" sub="Inventario + Cobranza" />
      </Section>

      <Section title="Resultados ($ millones)">
        <IndicatorCard label="Ventas"          value={fM(val(r, "ventas",        año))} semaphore="neutral" />
        <IndicatorCard label="Utilidad Bruta"  value={fM(val(r, "utilidadBruta", año))} semaphore="neutral" />
        <IndicatorCard label="EBITDA"          value={fM(val(r, "ebitda",        año))} semaphore="neutral" />
        <IndicatorCard label="EBIT"            value={fM(val(r, "ebit",          año))} semaphore="neutral" />
        <IndicatorCard label="Utilidad Neta"   value={fM(val(r, "utilidadNeta",  año))} semaphore="neutral" />
      </Section>

      <Section title="Posición Patrimonial ($ millones)">
        <IndicatorCard label="Activo Total"      value={fM(val(pat, "activoTotal",    año))} semaphore="neutral" />
        <IndicatorCard label="Pasivo Total"      value={fM(val(pat, "pasivoTotal",    año))} semaphore="neutral" />
        <IndicatorCard label="Patrimonio Neto"   value={fM(val(pat, "patrimonioNeto", año))} semaphore="neutral" />
        <IndicatorCard label="Capital de Trabajo" value={fM(val(pat, "capitalTrabajo", año))} semaphore="neutral" />
        <IndicatorCard label="Deuda Financiera"  value={fM(val(pat, "deudaFinanciera",año))} semaphore="neutral" />
      </Section>

      {/* Evolution charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Evolución de Márgenes</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={marginesChartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="año" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `${v}%`} domain={[0, "auto"]} />
                <Tooltip formatter={(v) => `${v}%`} />
                <Legend />
                <Line type="monotone" dataKey="Margen Bruto"  stroke="#22c55e" strokeWidth={2} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="Margen EBITDA" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="Margen Neto"   stroke="#8b5cf6" strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Evolución ROA / ROE</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={rentabilidadChartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="año" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `${v}%`} />
                <Tooltip formatter={(v) => `${v}%`} />
                <Legend />
                <ReferenceLine y={15} stroke="#22c55e" strokeDasharray="4 2" label={{ value: "ROE 15%", fontSize: 10, fill: "#22c55e" }} />
                <ReferenceLine y={8}  stroke="#f59e0b" strokeDasharray="4 2" label={{ value: "ROE 8%",  fontSize: 10, fill: "#f59e0b" }} />
                <Line type="monotone" dataKey="ROA" stroke="#f59e0b" strokeWidth={2} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="ROE" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Evolución Liquidez</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={liquidezChartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="año" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `${v}x`} />
                <Tooltip formatter={(v) => `${v}x`} />
                <Legend />
                <ReferenceLine y={1.5} stroke="#22c55e" strokeDasharray="4 2" label={{ value: "1.5x",  fontSize: 10, fill: "#22c55e" }} />
                <ReferenceLine y={1.0} stroke="#ef4444" strokeDasharray="4 2" label={{ value: "1.0x",  fontSize: 10, fill: "#ef4444" }} />
                <Line type="monotone" dataKey="Corriente" stroke="#22c55e" strokeWidth={2} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="Ácida"     stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Evolución Cobertura EBIT</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={coberturaChartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="año" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `${v}x`} />
                <Tooltip formatter={(v) => `${v}x`} />
                <Legend />
                <ReferenceLine y={3}  stroke="#22c55e" strokeDasharray="4 2" label={{ value: "3x",  fontSize: 10, fill: "#22c55e" }} />
                <ReferenceLine y={1}  stroke="#f59e0b" strokeDasharray="4 2" label={{ value: "1x",  fontSize: 10, fill: "#f59e0b" }} />
                <ReferenceLine y={0}  stroke="#ef4444" strokeDasharray="2 2" />
                <Line type="monotone" dataKey="Cobertura EBIT" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Footer note */}
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5 flex-shrink-0" />
        Datos de estados contables auditados al cierre de cada ejercicio. Valores en moneda homogénea (RT 6, Dic 2024).
      </p>
    </div>
  );
}
