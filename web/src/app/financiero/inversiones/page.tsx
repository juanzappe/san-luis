"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  DollarSign,
  TrendingUp,
  Percent,
  Loader2,
  AlertCircle,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  type InversionesData,
  fetchInversiones,
  formatARS,
} from "@/lib/financial-queries";
import type {
  Formatter, ValueType, NameType,
} from "recharts/types/component/DefaultTooltipContent";

const arsTooltip: Formatter<ValueType, NameType> = (v) => formatARS(Number(v ?? 0));

const PIE_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#8b5cf6", "#ef4444", "#06b6d4"];
const TIPO_LABELS: Record<string, string> = {
  bono: "Bonos", accion: "Acciones", fci: "FCI",
  plazo_fijo: "Plazo Fijo", moneda: "Moneda", otro: "Otro",
};

function formatUSD(n: number): string {
  return n.toLocaleString("es-AR", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function KpiCard({ title, value, icon: Icon }: { title: string; value: string; icon: React.ElementType }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}

export default function InversionesPage() {
  const [data, setData] = useState<InversionesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [monedaFilter, setMonedaFilter] = useState<"ALL" | "ARS" | "USD">("ALL");

  useEffect(() => {
    fetchInversiones()
      .then(setData)
      .catch((e) => setError(e.message ?? "Error"))
      .finally(() => setLoading(false));
  }, []);

  // Filter to the latest fecha_valuacion only (KPIs, charts, table)
  const latestHoldings = useMemo(() => {
    if (!data) return [];
    const fecha = data.latestFechaValuacion;
    if (!fecha) return data.holdings;
    return data.holdings.filter((h) => h.fechaValuacion === fecha);
  }, [data]);

  const totals = useMemo(() => {
    const ars = latestHoldings.reduce((s, h) => s + h.valuacionMonto, 0);
    const usd = latestHoldings.reduce((s, h) => s + h.valuacionUsd, 0);
    const resultado = latestHoldings.reduce((s, h) => s + h.resultado, 0);
    const costo = latestHoldings.reduce((s, h) => s + h.costoTotal, 0);
    const rendPct = costo > 0 ? (resultado / costo) * 100 : 0;
    return { ars, usd, resultado, rendPct };
  }, [latestHoldings]);

  // Donut by tipo
  const donutData = useMemo(() => {
    const map = new Map<string, number>();
    for (const h of latestHoldings) {
      map.set(h.tipo, (map.get(h.tipo) ?? 0) + h.valuacionMonto);
    }
    return Array.from(map.entries())
      .map(([tipo, value]) => ({ name: TIPO_LABELS[tipo] ?? tipo, value }))
      .sort((a, b) => b.value - a.value);
  }, [latestHoldings]);

  // Top 10 holdings by valuation
  const topHoldings = useMemo(() => {
    return [...latestHoldings]
      .sort((a, b) => b.valuacionMonto - a.valuacionMonto)
      .slice(0, 10)
      .map((h) => ({ name: h.ticker || h.nombre, value: h.valuacionMonto }));
  }, [latestHoldings]);

  // Filtered movimientos
  const filteredMov = useMemo(() => {
    if (!data) return [];
    if (monedaFilter === "ALL") return data.movimientos;
    return data.movimientos.filter((m) => m.moneda === monedaFilter);
  }, [data, monedaFilter]);

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Inversiones</h1>
        <p className="text-muted-foreground">
          Portfolio de inversiones financieras
          {data?.latestFechaValuacion && (
            <> — valuación al {data.latestFechaValuacion.slice(8, 10)}/{data.latestFechaValuacion.slice(5, 7)}/{data.latestFechaValuacion.slice(0, 4)}</>
          )}
        </p>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Valuación ARS" value={formatARS(totals.ars)} icon={DollarSign} />
        <KpiCard title="Valuación USD" value={formatUSD(totals.usd)} icon={DollarSign} />
        <KpiCard title="Resultado Total" value={formatARS(totals.resultado)} icon={TrendingUp} />
        <KpiCard title="Rendimiento %" value={`${totals.rendPct >= 0 ? "+" : ""}${totals.rendPct.toFixed(1)}%`} icon={Percent} />
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Distribución por Tipo</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={donutData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={110}
                  dataKey="value"
                  nameKey="name"
                  label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                  labelLine={false}
                  fontSize={11}
                >
                  {donutData.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={arsTooltip} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Top Holdings por Valuación</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={topHoldings} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis type="number" fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                <YAxis type="category" dataKey="name" fontSize={11} width={80} />
                <Tooltip formatter={arsTooltip} />
                <Bar dataKey="value" name="Valuación" fill="#3b82f6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Holdings table */}
      <Card>
        <CardHeader><CardTitle className="text-base">Posiciones</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ticker</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Cantidad</TableHead>
                  <TableHead className="text-right">Precio</TableHead>
                  <TableHead className="text-right">Valuación ARS</TableHead>
                  <TableHead className="text-right">Valuación USD</TableHead>
                  <TableHead className="text-right">Costo</TableHead>
                  <TableHead className="text-right">Resultado</TableHead>
                  <TableHead className="text-right">Var %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...latestHoldings].sort((a, b) => b.valuacionMonto - a.valuacionMonto).map((h) => (
                  <TableRow key={h.id}>
                    <TableCell className="font-medium">{h.ticker || "—"}</TableCell>
                    <TableCell>{h.nombre}</TableCell>
                    <TableCell>{TIPO_LABELS[h.tipo] ?? h.tipo}</TableCell>
                    <TableCell className="text-right">{h.cantidad.toLocaleString("es-AR")}</TableCell>
                    <TableCell className="text-right">{formatARS(h.valuacionPrecio)}</TableCell>
                    <TableCell className="text-right">{formatARS(h.valuacionMonto)}</TableCell>
                    <TableCell className="text-right">{formatUSD(h.valuacionUsd)}</TableCell>
                    <TableCell className="text-right">{formatARS(h.costoTotal)}</TableCell>
                    <TableCell className={`text-right font-medium ${h.resultado >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {formatARS(h.resultado)}
                    </TableCell>
                    <TableCell className={`text-right ${h.variacionPct >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {h.variacionPct >= 0 ? "+" : ""}{h.variacionPct.toFixed(1)}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Movimientos table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Movimientos</CardTitle>
          <div className="flex gap-1">
            {(["ALL", "ARS", "USD"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMonedaFilter(m)}
                className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                  monedaFilter === m ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"
                }`}
              >
                {m === "ALL" ? "Todos" : m}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Ticker</TableHead>
                  <TableHead>Operación</TableHead>
                  <TableHead className="text-right">Cantidad</TableHead>
                  <TableHead className="text-right">Precio</TableHead>
                  <TableHead className="text-right">Importe Neto</TableHead>
                  <TableHead>Moneda</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMov.slice(0, 100).map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="whitespace-nowrap">{m.fecha}</TableCell>
                    <TableCell className="font-medium">{m.ticker || "—"}</TableCell>
                    <TableCell>{m.tipoOp || m.descripcion}</TableCell>
                    <TableCell className="text-right">{m.cantidad ? m.cantidad.toLocaleString("es-AR") : "—"}</TableCell>
                    <TableCell className="text-right">{m.precio ? formatARS(m.precio) : "—"}</TableCell>
                    <TableCell className={`text-right font-medium ${m.importeNeto >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {formatARS(m.importeNeto)}
                    </TableCell>
                    <TableCell>{m.moneda}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {filteredMov.length > 100 && (
              <p className="mt-2 text-center text-xs text-muted-foreground">
                Mostrando los primeros 100 de {filteredMov.length} movimientos
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
