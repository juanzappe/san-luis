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
import {
  Landmark,
  Banknote,
  Wallet,
  CreditCard,
  TrendingUp,
  Loader2,
  AlertCircle,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  type TenenciasData,
  fetchTenencias,
  tenenciaTipoLabel,
  formatARS,
  shortLabel,
} from "@/lib/financial-queries";
import type {
  Formatter, ValueType, NameType,
} from "recharts/types/component/DefaultTooltipContent";

const arsTooltip: Formatter<ValueType, NameType> = (v) => formatARS(Number(v ?? 0));

const PIE_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#8b5cf6", "#ef4444", "#06b6d4", "#ec4899", "#64748b"];

function KpiCard({ title, value, icon: Icon }: { title: string; value: number; icon: React.ElementType }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{formatARS(value)}</div>
      </CardContent>
    </Card>
  );
}

export default function TenenciasPage() {
  const [data, setData] = useState<TenenciasData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTenencias()
      .then(setData)
      .catch((e) => setError(e.message ?? "Error"))
      .finally(() => setLoading(false));
  }, []);

  // Aggregate current by tipo
  const { byTipo, total } = useMemo(() => {
    if (!data?.current.length) return { byTipo: [] as { tipo: string; label: string; saldo: number }[], total: 0 };
    const map = new Map<string, number>();
    let t = 0;
    for (const r of data.current) {
      const key = r.tipo;
      map.set(key, (map.get(key) ?? 0) + r.saldoArs);
      t += r.saldoArs;
    }
    const arr = Array.from(map.entries())
      .map(([tipo, saldo]) => ({ tipo, label: tenenciaTipoLabel(tipo), saldo }))
      .sort((a, b) => b.saldo - a.saldo);
    return { byTipo: arr, total: t };
  }, [data]);

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
        <p className="mt-3 font-medium">Sin datos de tenencias</p>
        <p className="text-sm text-muted-foreground">Ejecutá el ETL para importar saldos.</p>
      </CardContent></Card>
    );
  }

  // KPI values by tipo
  const saldoBanco = byTipo.filter((r) => r.tipo === "cuenta_bancaria").reduce((s, r) => s + r.saldo, 0);
  const saldoCaja = byTipo.filter((r) => r.tipo === "caja_pesos" || r.tipo === "caja_dolares").reduce((s, r) => s + r.saldo, 0);
  const saldoMP = byTipo.filter((r) => r.tipo === "billetera_digital").reduce((s, r) => s + r.saldo, 0);
  const saldoInv = byTipo.filter((r) => r.tipo === "broker" || r.tipo === "plazo_fijo" || r.tipo === "fci").reduce((s, r) => s + r.saldo, 0);

  // Donut data
  const donutData = byTipo.map((r) => ({ name: r.label, value: r.saldo }));

  // History charts
  const allTipos = Array.from(new Set(data.history.flatMap((h) => Object.keys(h.byTipo))));
  const histChart = data.history.slice(-12).map((h) => {
    const entry: Record<string, string | number> = { label: shortLabel(h.periodo) };
    for (const t of allTipos) {
      entry[tenenciaTipoLabel(t)] = h.byTipo[t] ?? 0;
    }
    entry.total = h.total;
    return entry;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Tenencias</h1>
        <p className="text-muted-foreground">Foto patrimonial del día</p>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <KpiCard title="Tenencia Total" value={total} icon={TrendingUp} />
        <KpiCard title="Efectivo en Caja" value={saldoCaja} icon={Banknote} />
        <KpiCard title="Bancos" value={saldoBanco} icon={Landmark} />
        <KpiCard title="Mercado Pago" value={saldoMP} icon={CreditCard} />
        <KpiCard title="Inversiones" value={saldoInv} icon={Wallet} />
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Donut */}
        <Card>
          <CardHeader><CardTitle className="text-base">Distribución por Fuente</CardTitle></CardHeader>
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

        {/* Line: total evolution */}
        <Card>
          <CardHeader><CardTitle className="text-base">Evolución de Tenencia Total</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={histChart}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                <Tooltip formatter={arsTooltip} />
                <Line type="monotone" dataKey="total" name="Total" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Stacked bars by tipo */}
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Evolución por Fuente</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={histChart}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                <Tooltip formatter={arsTooltip} />
                <Legend />
                {allTipos.map((t, i) => (
                  <Bar
                    key={t}
                    dataKey={tenenciaTipoLabel(t)}
                    stackId="a"
                    fill={PIE_COLORS[i % PIE_COLORS.length]}
                    radius={i === allTipos.length - 1 ? [4, 4, 0, 0] : undefined}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Detail table */}
      <Card>
        <CardHeader><CardTitle className="text-base">Detalle de Tenencias</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fuente</TableHead>
                <TableHead>Cuenta</TableHead>
                <TableHead className="text-right">Saldo</TableHead>
                <TableHead className="text-right">% del Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.current.sort((a, b) => b.saldoArs - a.saldoArs).map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{tenenciaTipoLabel(r.tipo)}</TableCell>
                  <TableCell>{r.denominacion || "—"}</TableCell>
                  <TableCell className="text-right">{formatARS(r.saldoArs)}</TableCell>
                  <TableCell className="text-right">
                    {total > 0 ? `${((r.saldoArs / total) * 100).toFixed(1)}%` : "—"}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="border-t-2 font-bold">
                <TableCell>Total</TableCell>
                <TableCell />
                <TableCell className="text-right">{formatARS(total)}</TableCell>
                <TableCell className="text-right">100%</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
