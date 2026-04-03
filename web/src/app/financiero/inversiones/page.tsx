"use client";

import { useEffect, useMemo, useState } from "react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  type InversionesData,
  type InversionRow,
  fetchInversiones,
  formatARS,
} from "@/lib/financial-queries";
import type {
  Formatter, ValueType, NameType,
} from "recharts/types/component/DefaultTooltipContent";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const arsTooltip: Formatter<ValueType, NameType> = (v) => formatARS(Number(v ?? 0));

const TIPO_ORDER  = ["accion", "bono", "moneda", "fci", "plazo_fijo", "otro"] as const;
const TIPO_LABELS: Record<string, string> = {
  bono:        "Bonos",
  accion:      "Acciones y CEDEARs",
  fci:         "FCI",
  plazo_fijo:  "Plazo Fijo",
  moneda:      "Moneda / Disponibilidades",
  otro:        "Otros",
};
const TIPO_COLORS: Record<string, string> = {
  accion:     "#3b82f6",
  bono:       "#22c55e",
  moneda:     "#f59e0b",
  fci:        "#8b5cf6",
  plazo_fijo: "#06b6d4",
  otro:       "#64748b",
};

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function formatQty(n: number): string {
  if (n >= 1_000_000) return n.toLocaleString("es-AR", { maximumFractionDigits: 0 });
  if (n < 1) return n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
  return n.toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatPrice(n: number): string {
  if (n === 0) return "—";
  if (n < 1) return n.toLocaleString("es-AR", { minimumFractionDigits: 4, maximumFractionDigits: 6 });
  return n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatFecha(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function pctStr(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

// ---------------------------------------------------------------------------
// Grouped table row component
// ---------------------------------------------------------------------------

function GainCell({ value }: { value: number }) {
  const cls = value >= 0 ? "text-green-600" : "text-red-600";
  return (
    <TableCell className={`text-right font-medium tabular-nums ${cls}`}>
      {formatARS(value)}
    </TableCell>
  );
}

function PctCell({ value }: { value: number }) {
  const cls = value >= 0 ? "text-green-600" : "text-red-600";
  return (
    <TableCell className={`text-right tabular-nums ${cls}`}>
      {pctStr(value)}
    </TableCell>
  );
}

// ---------------------------------------------------------------------------
// Tipo group section
// ---------------------------------------------------------------------------

function TipoGroup({
  tipo,
  rows,
  totalPortfolio,
}: {
  tipo: string;
  rows: InversionRow[];
  totalPortfolio: number;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const label = TIPO_LABELS[tipo] ?? tipo;

  const subtotal = useMemo(() => {
    const monto    = rows.reduce((s, r) => s + r.valuacionMonto, 0);
    const costo    = rows.reduce((s, r) => s + r.costoTotal,     0);
    const ganancia = rows.reduce((s, r) => s + r.resultado,      0);
    const rendPct  = costo > 0 ? (ganancia / costo) * 100 : 0;
    return { monto, costo, ganancia, rendPct };
  }, [rows]);

  const pctPortfolio = totalPortfolio > 0 ? (subtotal.monto / totalPortfolio) * 100 : 0;

  return (
    <>
      {/* Section header row */}
      <TableRow
        className="cursor-pointer bg-muted/60 hover:bg-muted"
        onClick={() => setCollapsed((c) => !c)}
      >
        <TableCell colSpan={2} className="py-2 font-semibold">
          <div className="flex items-center gap-2">
            {collapsed
              ? <ChevronRight className="h-4 w-4 flex-shrink-0" />
              : <ChevronDown  className="h-4 w-4 flex-shrink-0" />}
            <span
              className="mr-2 inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full"
              style={{ background: TIPO_COLORS[tipo] ?? "#94a3b8" }}
            />
            {label}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {rows.length} {rows.length === 1 ? "posición" : "posiciones"} · {pctPortfolio.toFixed(1)}% del portfolio
            </span>
          </div>
        </TableCell>
        {/* Subtotal columns */}
        <TableCell className="text-right tabular-nums text-muted-foreground">—</TableCell>
        <TableCell className="text-right tabular-nums text-muted-foreground">—</TableCell>
        <TableCell className="text-right tabular-nums text-muted-foreground">—</TableCell>
        <TableCell className={`text-right font-semibold tabular-nums ${subtotal.ganancia >= 0 ? "text-green-700" : "text-red-700"}`}>
          {formatARS(subtotal.ganancia)}
        </TableCell>
        <TableCell className={`text-right font-semibold tabular-nums ${subtotal.rendPct >= 0 ? "text-green-700" : "text-red-700"}`}>
          {pctStr(subtotal.rendPct)}
        </TableCell>
        <TableCell className="text-right font-semibold tabular-nums">
          {formatARS(subtotal.monto)}
        </TableCell>
      </TableRow>

      {/* Position rows */}
      {!collapsed && rows.map((r) => (
        <TableRow key={r.id} className="text-sm">
          <TableCell className="font-mono font-medium">{r.ticker || "—"}</TableCell>
          <TableCell className="max-w-[200px] truncate text-muted-foreground">{r.nombre}</TableCell>
          <TableCell className="text-right tabular-nums">{formatQty(r.cantidad)}</TableCell>
          <TableCell className="text-right tabular-nums">{formatPrice(r.valuacionPrecio)}</TableCell>
          <TableCell className="text-right tabular-nums">{formatPrice(r.precioCompra)}</TableCell>
          <GainCell value={r.resultado} />
          <PctCell  value={r.variacionPct} />
          <TableCell className="text-right font-medium tabular-nums">
            {formatARS(r.valuacionMonto)}
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function InversionesPage() {
  const [data, setData] = useState<InversionesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchInversiones()
      .then(setData)
      .catch((e) => setError(e.message ?? "Error"))
      .finally(() => setLoading(false));
  }, []);

  // Only latest fecha_valuacion
  const latestHoldings = useMemo(() => {
    if (!data) return [];
    const fecha = data.latestFechaValuacion;
    if (!fecha) return data.holdings;
    return data.holdings.filter((h) => h.fechaValuacion === fecha);
  }, [data]);

  // Portfolio totals
  const totals = useMemo(() => {
    const monto    = latestHoldings.reduce((s, h) => s + h.valuacionMonto, 0);
    const costo    = latestHoldings.reduce((s, h) => s + h.costoTotal,     0);
    const ganancia = latestHoldings.reduce((s, h) => s + h.resultado,      0);
    const rendPct  = costo > 0 ? (ganancia / costo) * 100 : 0;
    return { monto, costo, ganancia, rendPct };
  }, [latestHoldings]);

  // Groups
  const groups = useMemo(() => {
    const map = new Map<string, InversionRow[]>();
    for (const h of latestHoldings) {
      const arr = map.get(h.tipo) ?? [];
      arr.push(h);
      map.set(h.tipo, arr);
    }
    // Sort each group by valuation desc
    for (const [, arr] of map) arr.sort((a, b) => b.valuacionMonto - a.valuacionMonto);
    return map;
  }, [latestHoldings]);

  // Donut data
  const donutData = useMemo(() => {
    return TIPO_ORDER
      .filter((t) => groups.has(t))
      .map((t) => ({
        name:  TIPO_LABELS[t] ?? t,
        value: (groups.get(t) ?? []).reduce((s, r) => s + r.valuacionMonto, 0),
        color: TIPO_COLORS[t] ?? "#94a3b8",
      }));
  }, [groups]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-3 text-muted-foreground">Cargando portfolio…</span>
      </div>
    );
  }
  if (error) {
    return (
      <Card><CardContent className="flex items-center gap-3 py-8">
        <AlertCircle className="h-5 w-5 text-red-500" /><p className="text-sm">{error}</p>
      </CardContent></Card>
    );
  }
  if (!data?.hasData) {
    return (
      <Card><CardContent className="py-8 text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-3 font-medium">Sin datos de inversiones</p>
        <p className="text-sm text-muted-foreground">Ejecutá el ETL para importar tenencias del broker.</p>
      </CardContent></Card>
    );
  }

  const fechaStr = data.latestFechaValuacion ? formatFecha(data.latestFechaValuacion) : "—";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Inversiones</h1>
        <p className="text-muted-foreground">
          Portfolio broker Inviu / InvertirOnline — valuación al {fechaStr}
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="lg:col-span-2">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Patrimonio Total</p>
            <p className="mt-1 text-4xl font-bold tabular-nums">{formatARS(totals.monto)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {latestHoldings.length} posiciones · valuación al {fechaStr}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Costo / Invertido</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{formatARS(totals.costo)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Ganancia / Pérdida</p>
                <p className={`mt-1 text-2xl font-bold tabular-nums ${totals.ganancia >= 0 ? "text-green-600" : "text-red-600"}`}>
                  {formatARS(totals.ganancia)}
                </p>
                <p className={`mt-0.5 text-sm font-medium ${totals.rendPct >= 0 ? "text-green-600" : "text-red-600"}`}>
                  {pctStr(totals.rendPct)}
                </p>
              </div>
              {totals.ganancia >= 0
                ? <TrendingUp   className="h-8 w-8 text-green-500 opacity-60" />
                : <TrendingDown className="h-8 w-8 text-red-500 opacity-60"   />}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Holdings table + donut side by side */}
      <div className="grid gap-4 xl:grid-cols-[1fr_260px]">
        {/* Grouped table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Posiciones</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Ticker</TableHead>
                    <TableHead>Nombre</TableHead>
                    <TableHead className="text-right">Cantidad</TableHead>
                    <TableHead className="text-right">Último precio</TableHead>
                    <TableHead className="text-right">P. Promedio</TableHead>
                    <TableHead className="text-right">Ganancia $</TableHead>
                    <TableHead className="text-right">Rend. %</TableHead>
                    <TableHead className="text-right pr-6">Monto ARS</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {TIPO_ORDER
                    .filter((t) => groups.has(t))
                    .map((t) => (
                      <TipoGroup
                        key={t}
                        tipo={t}
                        rows={groups.get(t)!}
                        totalPortfolio={totals.monto}
                      />
                    ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Donut by tipo */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Distribución</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={donutData}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={90}
                  dataKey="value"
                  nameKey="name"
                  strokeWidth={1}
                >
                  {donutData.map((d, i) => (
                    <Cell key={i} fill={d.color} />
                  ))}
                </Pie>
                <Tooltip formatter={arsTooltip} />
              </PieChart>
            </ResponsiveContainer>

            {/* Legend */}
            <div className="space-y-1.5">
              {donutData.map((d) => {
                const pct = totals.monto > 0 ? (d.value / totals.monto) * 100 : 0;
                return (
                  <div key={d.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: d.color }} />
                      <span className="text-muted-foreground">{d.name}</span>
                    </div>
                    <span className="font-medium tabular-nums">{pct.toFixed(1)}%</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
