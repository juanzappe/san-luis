"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { DollarSign, Store, Coffee, Utensils, Loader2, AlertCircle } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { InflationToggle, useInflation } from "@/lib/inflation";
import { MonthSelector } from "@/components/month-selector";
import {
  type IngresoRow,
  fetchIngresos,
  formatARS,
  formatPct,
  pctDelta,
  shortLabel,
} from "@/lib/economic-queries";
import type {
  Formatter, ValueType, NameType,
} from "recharts/types/component/DefaultTooltipContent";

const arsTooltip: Formatter<ValueType, NameType> = (v) => formatARS(Number(v ?? 0));

const COLORS = {
  mostrador: "#8b5cf6",
  restobar: "#06b6d4",
  servicios: "#22c55e",
};

const SHORT_MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

const YEAR_COLORS: Record<string, string> = {
  "2024": "#94a3b8",
  "2025": "#3b82f6",
  "2026": "#8b5cf6",
};

const YEAR_DASH: Record<string, string | undefined> = {
  "2024": "5 5",
};

type Granularity = "mensual" | "trimestral" | "anual";

const QUARTER_LABELS: Record<string, string> = { "01": "Q1", "02": "Q1", "03": "Q1", "04": "Q2", "05": "Q2", "06": "Q2", "07": "Q3", "08": "Q3", "09": "Q3", "10": "Q4", "11": "Q4", "12": "Q4" };

const MONTH_NAMES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

function aggregateRows(
  data: IngresoRow[],
  granularity: Granularity,
): { key: string; label: string; mostrador: number; restobar: number; servicios: number; total: number }[] {
  if (granularity === "mensual") {
    return data.map((r) => {
      const [y, m] = r.periodo.split("-");
      return { key: r.periodo, label: `${MONTH_NAMES[parseInt(m, 10) - 1]} ${y}`, mostrador: r.mostrador, restobar: r.restobar, servicios: r.servicios, total: r.total };
    }).sort((a, b) => b.key.localeCompare(a.key));
  }

  const buckets = new Map<string, { mostrador: number; restobar: number; servicios: number; total: number }>();
  for (const r of data) {
    const [y, m] = r.periodo.split("-");
    const bucketKey = granularity === "trimestral" ? `${y}-${QUARTER_LABELS[m]}` : y;
    const cur = buckets.get(bucketKey) ?? { mostrador: 0, restobar: 0, servicios: 0, total: 0 };
    cur.mostrador += r.mostrador;
    cur.restobar += r.restobar;
    cur.servicios += r.servicios;
    cur.total += r.total;
    buckets.set(bucketKey, cur);
  }

  return Array.from(buckets.entries())
    .map(([k, v]) => {
      const label = granularity === "trimestral"
        ? `${k.split("-")[1]} ${k.split("-")[0]}`
        : k;
      return { key: k, label, ...v };
    })
    .sort((a, b) => b.key.localeCompare(a.key));
}

// ---------------------------------------------------------------------------
// KPI Card
// ---------------------------------------------------------------------------
function KpiCard({
  title,
  value,
  delta,
  icon: Icon,
}: {
  title: string;
  value: number;
  delta: number | null;
  icon: React.ElementType;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{formatARS(value)}</div>
        {delta !== null ? (
          <p className={`text-xs ${delta >= 0 ? "text-green-600" : "text-red-600"}`}>
            {formatPct(delta)} vs mes anterior
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">Sin mes anterior</p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Year-over-year comparison chart for a single business unit
// ---------------------------------------------------------------------------
function YoYChart({ data, dataKey, title, color, height = 300 }: {
  data: IngresoRow[];
  dataKey: keyof Omit<IngresoRow, "periodo">;
  title: string;
  color: string;
  height?: number;
}) {
  const years = useMemo(() => {
    const yearSet = new Set<string>();
    data.forEach((r) => yearSet.add(r.periodo.slice(0, 4)));
    return Array.from(yearSet).sort();
  }, [data]);

  const chartData = useMemo(() => {
    return SHORT_MONTHS.map((label, i) => {
      const monthNum = String(i + 1).padStart(2, "0");
      const row: Record<string, string | number | undefined> = { label };
      for (const y of years) {
        const match = data.find((r) => r.periodo === `${y}-${monthNum}`);
        row[y] = match ? match[dataKey] : undefined;
      }
      return row;
    });
  }, [data, years, dataKey]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="label" fontSize={11} />
            <YAxis fontSize={11} tickFormatter={(v) => `${(v / 1e6).toFixed(0)}M`} />
            <Tooltip formatter={arsTooltip} />
            <Legend />
            {years.map((y) => (
              <Line
                key={y}
                type="monotone"
                dataKey={y}
                name={y}
                stroke={YEAR_COLORS[y] ?? color}
                strokeWidth={2}
                strokeDasharray={YEAR_DASH[y]}
                dot={{ r: 3 }}
                connectNulls={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Monthly average by year
// ---------------------------------------------------------------------------
interface YearAvg {
  year: string;
  mostrador: number;
  restobar: number;
  servicios: number;
  total: number;
  months: number;
}

function MonthlyAverageByYear({ data }: { data: IngresoRow[] }) {
  const rows = useMemo(() => {
    const byYear = new Map<string, { mostrador: number; restobar: number; servicios: number; total: number; months: number }>();
    for (const r of data) {
      const y = r.periodo.slice(0, 4);
      const cur = byYear.get(y) ?? { mostrador: 0, restobar: 0, servicios: 0, total: 0, months: 0 };
      cur.mostrador += r.mostrador;
      cur.restobar += r.restobar;
      cur.servicios += r.servicios;
      cur.total += r.total;
      cur.months += 1;
      byYear.set(y, cur);
    }

    const result: YearAvg[] = Array.from(byYear.entries())
      .map(([year, v]) => ({
        year,
        mostrador: v.mostrador / v.months,
        restobar: v.restobar / v.months,
        servicios: v.servicios / v.months,
        total: v.total / v.months,
        months: v.months,
      }))
      .sort((a, b) => b.year.localeCompare(a.year));

    return result;
  }, [data]);

  if (rows.length === 0) return null;

  const getDelta = (idx: number, field: keyof Pick<YearAvg, "mostrador" | "restobar" | "servicios" | "total">) => {
    if (idx >= rows.length - 1) return null;
    return pctDelta(rows[idx][field], rows[idx + 1][field]);
  };

  const deltaCell = (delta: number | null) => {
    if (delta === null) return null;
    return (
      <span className={`ml-1.5 text-xs font-normal ${delta >= 0 ? "text-green-600" : "text-red-600"}`}>
        {formatPct(delta)}
      </span>
    );
  };

  const monthsNote = rows.map((r) => `${r.year}: ${r.months} ${r.months === 1 ? "mes" : "meses"}`).join(" · ");

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Promedio Mensual por Año</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Año</TableHead>
              <TableHead className="text-right">Mostrador</TableHead>
              <TableHead className="text-right">Restobar</TableHead>
              <TableHead className="text-right">Servicios</TableHead>
              <TableHead className="text-right font-bold">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={r.year}>
                <TableCell className="font-medium">{r.year}</TableCell>
                <TableCell className="text-right">
                  {formatARS(r.mostrador)}{deltaCell(getDelta(i, "mostrador"))}
                </TableCell>
                <TableCell className="text-right">
                  {formatARS(r.restobar)}{deltaCell(getDelta(i, "restobar"))}
                </TableCell>
                <TableCell className="text-right">
                  {formatARS(r.servicios)}{deltaCell(getDelta(i, "servicios"))}
                </TableCell>
                <TableCell className="text-right font-bold">
                  {formatARS(r.total)}{deltaCell(getDelta(i, "total"))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="mt-3 text-xs text-muted-foreground">
          Basado en {monthsNote}
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// YTD Comparative Banner
// ---------------------------------------------------------------------------
interface YtdData {
  currentYear: string;
  prevYear: string;
  firstMonth: string;
  lastMonth: string;
  current: { mostrador: number; restobar: number; servicios: number; total: number };
  previous: { mostrador: number; restobar: number; servicios: number; total: number };
  hasPrevData: boolean;
}

function useYtdComparison(data: IngresoRow[]): YtdData | null {
  return useMemo(() => {
    if (data.length === 0) return null;

    // Find the most recent year that has data
    const years = new Set(data.map((r) => r.periodo.slice(0, 4)));
    const sortedYears = Array.from(years).sort();
    const currentYear = sortedYears[sortedYears.length - 1];
    const prevYear = String(Number(currentYear) - 1);

    // Get months with data in current year
    const currentMonths = data
      .filter((r) => r.periodo.startsWith(currentYear))
      .map((r) => r.periodo.slice(5, 7))
      .sort();

    if (currentMonths.length === 0) return null;

    const firstMonth = currentMonths[0];
    const lastMonth = currentMonths[currentMonths.length - 1];

    // Sum current year
    const current = { mostrador: 0, restobar: 0, servicios: 0, total: 0 };
    for (const r of data) {
      if (r.periodo.startsWith(currentYear)) {
        current.mostrador += r.mostrador;
        current.restobar += r.restobar;
        current.servicios += r.servicios;
        current.total += r.total;
      }
    }

    // Sum same months from previous year
    const previous = { mostrador: 0, restobar: 0, servicios: 0, total: 0 };
    let hasPrevData = false;
    for (const m of currentMonths) {
      const match = data.find((r) => r.periodo === `${prevYear}-${m}`);
      if (match) {
        hasPrevData = true;
        previous.mostrador += match.mostrador;
        previous.restobar += match.restobar;
        previous.servicios += match.servicios;
        previous.total += match.total;
      }
    }

    return { currentYear, prevYear, firstMonth, lastMonth, current, previous, hasPrevData };
  }, [data]);
}

function formatCompact(n: number): string {
  if (Math.abs(n) >= 1e9) return `$ ${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `$ ${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `$ ${(n / 1e3).toFixed(0)}K`;
  return formatARS(n);
}

function YtdTable({ data }: { data: IngresoRow[] }) {
  const ytd = useYtdComparison(data);
  if (!ytd || !ytd.hasPrevData) return null;

  const monthRange = `${MONTH_NAMES[parseInt(ytd.firstMonth, 10) - 1]}–${MONTH_NAMES[parseInt(ytd.lastMonth, 10) - 1]}`;
  const curLabel = `${monthRange} ${ytd.currentYear}`;
  const prevLabel = `${monthRange} ${ytd.prevYear}`;

  const rows = [
    { label: "Mostrador", cur: ytd.current.mostrador, prev: ytd.previous.mostrador, bold: false },
    { label: "Restobar", cur: ytd.current.restobar, prev: ytd.previous.restobar, bold: false },
    { label: "Servicios", cur: ytd.current.servicios, prev: ytd.previous.servicios, bold: false },
    { label: "Total", cur: ytd.current.total, prev: ytd.previous.total, bold: true },
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Comparación YTD ({monthRange})</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead />
              <TableHead className="text-right">{curLabel}</TableHead>
              <TableHead className="text-right">{prevLabel}</TableHead>
              <TableHead className="text-right">Δ %</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const delta = r.prev > 0 ? pctDelta(r.cur, r.prev) : null;
              return (
                <TableRow key={r.label}>
                  <TableCell className={r.bold ? "font-bold" : ""}>{r.label}</TableCell>
                  <TableCell className={`text-right ${r.bold ? "font-bold" : ""}`}>{formatARS(r.cur)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{formatARS(r.prev)}</TableCell>
                  <TableCell className={`text-right font-medium ${delta !== null && delta >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {delta !== null ? formatPct(delta) : "—"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Donut chart — participation by business unit
// ---------------------------------------------------------------------------
const DONUT_DATA_KEYS = [
  { key: "mostrador", name: "Mostrador", color: COLORS.mostrador },
  { key: "restobar", name: "Restobar", color: COLORS.restobar },
  { key: "servicios", name: "Servicios", color: COLORS.servicios },
] as const;

function ParticipationDonut({ data, year }: { data: IngresoRow[]; year: string }) {
  const annual = useMemo(() => {
    const acc = { mostrador: 0, restobar: 0, servicios: 0, total: 0 };
    for (const r of data) {
      if (r.periodo.startsWith(year)) {
        acc.mostrador += r.mostrador;
        acc.restobar += r.restobar;
        acc.servicios += r.servicios;
        acc.total += r.total;
      }
    }
    return acc;
  }, [data, year]);

  const donutData = useMemo(() => {
    return DONUT_DATA_KEYS.map((d) => ({
      name: d.name,
      value: annual[d.key as keyof typeof annual] as number,
      color: d.color,
    })).filter((d) => d.value > 0);
  }, [annual]);

  const total = annual.total;

  return (
    <div>
      <p className="text-sm font-medium mb-2">Participación — {year}</p>
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie
            data={donutData}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius="55%"
            outerRadius="80%"
            paddingAngle={2}
          >
            {donutData.map((d) => (
              <Cell key={d.name} fill={d.color} />
            ))}
          </Pie>
          <Tooltip formatter={(v) => formatARS(Number(v ?? 0))} />
          {/* Center label */}
          <text
            x="50%"
            y="48%"
            textAnchor="middle"
            dominantBaseline="central"
            className="fill-foreground text-lg font-bold"
          >
            {formatCompact(total)}
          </text>
          <text
            x="50%"
            y="58%"
            textAnchor="middle"
            dominantBaseline="central"
            className="fill-muted-foreground text-[10px]"
          >
            Total {year}
          </text>
        </PieChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs mt-1">
        {DONUT_DATA_KEYS.map((d) => {
          const val = annual[d.key as keyof typeof annual] as number;
          const pct = total > 0 ? ((val / total) * 100).toFixed(1) : "0.0";
          return (
            <span key={d.key} className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: d.color }} />
              {d.name} {pct}%
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export default function IngresosPage() {
  const { adjust } = useInflation();
  const [raw, setRaw] = useState<IngresoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [granularity, setGranularity] = useState<Granularity>("mensual");
  const [selectedPeriodo, setSelectedPeriodo] = useState("");
  useEffect(() => {
    fetchIngresos()
      .then(setRaw)
      .catch((e) => setError(e.message ?? "Error"))
      .finally(() => setLoading(false));
  }, []);

  // Apply inflation adjustment
  const allData: IngresoRow[] = useMemo(() =>
    raw.map((r) => ({
      periodo: r.periodo,
      mostrador: adjust(r.mostrador, r.periodo),
      restobar: adjust(r.restobar, r.periodo),
      servicios: adjust(r.servicios, r.periodo),
      total: adjust(r.total, r.periodo),
    })),
  [raw, adjust]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-3 text-muted-foreground">Cargando datos…</span>
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

  if (raw.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 font-medium">Sin datos de ingresos</p>
          <p className="text-sm text-muted-foreground">
            Ejecutá el ETL para importar ventas y facturas emitidas.
          </p>
        </CardContent>
      </Card>
    );
  }

  const periodos = allData.map((r) => r.periodo);
  const activePeriodo = selectedPeriodo || periodos[periodos.length - 1] || "";
  const selectedIdx = allData.findIndex((r) => r.periodo === activePeriodo);
  const last = selectedIdx >= 0 ? allData[selectedIdx] : allData[allData.length - 1];
  const prev = selectedIdx >= 1 ? allData[selectedIdx - 1] : null;

  // Last 12 months for stacked bar chart
  const chartData = allData.slice(-12).map((r) => ({
    ...r,
    label: shortLabel(r.periodo),
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Ingresos</h1>
          <p className="text-muted-foreground">Ingresos por unidad de negocio</p>
        </div>
        <div className="flex items-center gap-2">
          <MonthSelector periodos={periodos} value={activePeriodo} onChange={setSelectedPeriodo} />
          <InflationToggle />
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Total Ingresos"
          value={last.total}
          delta={prev ? pctDelta(last.total, prev.total) : null}
          icon={DollarSign}
        />
        <KpiCard
          title="Mostrador"
          value={last.mostrador}
          delta={prev ? pctDelta(last.mostrador, prev.mostrador) : null}
          icon={Store}
        />
        <KpiCard
          title="Restobar"
          value={last.restobar}
          delta={prev ? pctDelta(last.restobar, prev.restobar) : null}
          icon={Coffee}
        />
        <KpiCard
          title="Servicios"
          value={last.servicios}
          delta={prev ? pctDelta(last.servicios, prev.servicios) : null}
          icon={Utensils}
        />
      </div>

      {/* YTD Comparison Table */}
      <YtdTable data={allData} />

      {/* Monthly average by year */}
      <MonthlyAverageByYear data={allData} />

      {/* Stacked bar chart + Donut (side by side on desktop) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ingresos por Unidad de Negocio</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                <Tooltip formatter={arsTooltip} />
                <Legend />
                <Bar dataKey="mostrador" name="Mostrador" stackId="a" fill={COLORS.mostrador} />
                <Bar dataKey="restobar" name="Restobar" stackId="a" fill={COLORS.restobar} />
                <Bar dataKey="servicios" name="Servicios" stackId="a" fill={COLORS.servicios} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <ParticipationDonut data={allData} year={activePeriodo.slice(0, 4) || allData[allData.length - 1]?.periodo.slice(0, 4) || ""} />
          </div>
        </CardContent>
      </Card>

      {/* Year-over-year comparison charts */}
      <div className="grid gap-4 md:grid-cols-2">
        <YoYChart data={allData} dataKey="mostrador" title="Mostrador — Comparación Anual" color={COLORS.mostrador} />
        <YoYChart data={allData} dataKey="restobar" title="Restobar — Comparación Anual" color={COLORS.restobar} />
      </div>
      <YoYChart data={allData} dataKey="servicios" title="Servicios — Comparación Anual" color={COLORS.servicios} height={350} />

      {/* Detail table with period selector */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Detalle de Ingresos</CardTitle>
          <div className="flex items-center rounded-lg border text-xs font-medium">
            {(["mensual", "trimestral", "anual"] as Granularity[]).map((g) => (
              <button
                key={g}
                onClick={() => setGranularity(g)}
                className={`px-3 py-1.5 capitalize transition-colors first:rounded-l-lg last:rounded-r-lg ${
                  granularity === g
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-accent"
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Período</TableHead>
                <TableHead className="text-right">Mostrador</TableHead>
                <TableHead className="text-right">Restobar</TableHead>
                <TableHead className="text-right">Servicios</TableHead>
                <TableHead className="text-right font-bold">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {aggregateRows(allData, granularity).map((r) => (
                <TableRow key={r.key}>
                  <TableCell>{r.label}</TableCell>
                  <TableCell className="text-right">{formatARS(r.mostrador)}</TableCell>
                  <TableCell className="text-right">{formatARS(r.restobar)}</TableCell>
                  <TableCell className="text-right">{formatARS(r.servicios)}</TableCell>
                  <TableCell className="text-right font-bold">{formatARS(r.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
