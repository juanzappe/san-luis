"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  Receipt,
  Wallet,
  Loader2,
  AlertCircle,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  type IvaMensualRow,
  fetchPosicionIva,
  formatARS,
  formatPct,
  pctDelta,
  periodoLabel,
  shortLabel,
} from "@/lib/tax-queries";
import { InflationToggle, useInflation } from "@/lib/inflation";
import type {
  Formatter, ValueType, NameType,
} from "recharts/types/component/DefaultTooltipContent";

const arsTooltip: Formatter<ValueType, NameType> = (v) => formatARS(Number(v ?? 0));

function KpiCard({ title, value, delta, icon: Icon }: { title: string; value: string; delta?: string | null; icon: React.ElementType }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {delta && (
          <p className={`text-xs ${delta.startsWith("-") ? "text-red-600" : "text-green-600"}`}>
            {delta} vs mes anterior
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function IvaPage() {
  const [raw, setRaw] = useState<IvaMensualRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { adjust } = useInflation();

  useEffect(() => {
    fetchPosicionIva()
      .then(setRaw)
      .catch((e) => setError(e.message ?? "Error"))
      .finally(() => setLoading(false));
  }, []);

  const data = useMemo(
    () => raw.map((r) => ({
      ...r,
      debito21: adjust(r.debito21, r.periodo),
      debito105: adjust(r.debito105, r.periodo),
      debitoOtros: adjust(r.debitoOtros, r.periodo),
      totalDebito: adjust(r.totalDebito, r.periodo),
      credito21: adjust(r.credito21, r.periodo),
      credito105: adjust(r.credito105, r.periodo),
      creditoOtros: adjust(r.creditoOtros, r.periodo),
      totalCredito: adjust(r.totalCredito, r.periodo),
      posicionNeta: adjust(r.posicionNeta, r.periodo),
      retenciones: adjust(r.retenciones, r.periodo),
      saldoFinal: adjust(r.saldoFinal, r.periodo),
    })),
    [raw, adjust],
  );

  const kpis = useMemo(() => {
    if (data.length < 1) return null;
    const last = data[data.length - 1];
    const prev = data.length > 1 ? data[data.length - 2] : null;
    const saldoFavor = last.posicionNeta < 0 ? Math.abs(last.posicionNeta) : 0;
    return {
      debito: last.totalDebito,
      deltaDebito: prev ? pctDelta(last.totalDebito, prev.totalDebito) : null,
      credito: last.totalCredito,
      deltaCredito: prev ? pctDelta(last.totalCredito, prev.totalCredito) : null,
      posicion: last.posicionNeta,
      deltaPosicion: prev ? pctDelta(Math.abs(last.posicionNeta), Math.abs(prev.posicionNeta)) : null,
      saldoFavor,
    };
  }, [data]);

  // Charts — last 24 months
  const chartData = useMemo(
    () => data.slice(-24).map((r) => ({
      label: shortLabel(r.periodo),
      debito: r.totalDebito,
      credito: r.totalCredito,
      posicionNeta: r.posicionNeta,
      // For alícuota stacked charts
      deb21: r.debito21,
      deb105: r.debito105,
      debOtros: r.debitoOtros,
      cred21: r.credito21,
      cred105: r.credito105,
      credOtros: r.creditoOtros,
    })),
    [data],
  );

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
  if (data.length === 0) {
    return (
      <Card><CardContent className="py-8 text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-3 font-medium">Sin datos de IVA</p>
        <p className="text-sm text-muted-foreground">Importá facturas emitidas y recibidas para ver la posición de IVA.</p>
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Posición de IVA</h1>
          <p className="text-muted-foreground">Débito fiscal, crédito fiscal y posición neta mensual</p>
        </div>
        <InflationToggle />
      </div>

      {/* KPIs */}
      {kpis && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <KpiCard title="Débito Fiscal" value={formatARS(kpis.debito)} delta={kpis.deltaDebito != null ? formatPct(kpis.deltaDebito) : null} icon={TrendingUp} />
          <KpiCard title="Crédito Fiscal" value={formatARS(kpis.credito)} delta={kpis.deltaCredito != null ? formatPct(kpis.deltaCredito) : null} icon={TrendingDown} />
          <KpiCard
            title="Posición Neta"
            value={formatARS(kpis.posicion)}
            icon={Receipt}
          />
          <KpiCard title="Saldo a Favor" value={kpis.saldoFavor > 0 ? formatARS(kpis.saldoFavor) : "—"} icon={Wallet} />
        </div>
      )}

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Grouped bars: débito vs crédito */}
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Débito vs Crédito Fiscal</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                <Tooltip formatter={arsTooltip} />
                <Legend />
                <Bar dataKey="debito" name="Débito Fiscal" fill="#ef4444" radius={[4, 4, 0, 0]} />
                <Bar dataKey="credito" name="Crédito Fiscal" fill="#22c55e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Posición neta line */}
        <Card>
          <CardHeader><CardTitle className="text-base">Posición Neta Mensual</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                <Tooltip formatter={arsTooltip} />
                <Line type="monotone" dataKey="posicionNeta" name="Posición Neta" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Débito by alícuota */}
        <Card>
          <CardHeader><CardTitle className="text-base">Débito Fiscal por Alícuota</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                <Tooltip formatter={arsTooltip} />
                <Legend />
                <Bar dataKey="deb21" name="21%" stackId="d" fill="#ef4444" />
                <Bar dataKey="deb105" name="10.5%" stackId="d" fill="#f59e0b" />
                <Bar dataKey="debOtros" name="Otros" stackId="d" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Crédito by alícuota */}
        <Card>
          <CardHeader><CardTitle className="text-base">Crédito Fiscal por Alícuota</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                <Tooltip formatter={arsTooltip} />
                <Legend />
                <Bar dataKey="cred21" name="21%" stackId="c" fill="#22c55e" />
                <Bar dataKey="cred105" name="10.5%" stackId="c" fill="#06b6d4" />
                <Bar dataKey="credOtros" name="Otros" stackId="c" fill="#64748b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Liquidación table */}
      <Card>
        <CardHeader><CardTitle className="text-base">Liquidación de IVA Mensual</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Período</TableHead>
                  <TableHead className="text-right">Déb. 21%</TableHead>
                  <TableHead className="text-right">Déb. 10.5%</TableHead>
                  <TableHead className="text-right">Déb. Otros</TableHead>
                  <TableHead className="text-right">Total Débito</TableHead>
                  <TableHead className="text-right">Créd. 21%</TableHead>
                  <TableHead className="text-right">Créd. 10.5%</TableHead>
                  <TableHead className="text-right">Créd. Otros</TableHead>
                  <TableHead className="text-right">Total Crédito</TableHead>
                  <TableHead className="text-right">Posición Neta</TableHead>
                  <TableHead className="text-right">Retenciones</TableHead>
                  <TableHead className="text-right">Saldo Final</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...data].reverse().map((r) => (
                  <TableRow key={r.periodo}>
                    <TableCell className="font-medium whitespace-nowrap">{periodoLabel(r.periodo)}</TableCell>
                    <TableCell className="text-right">{formatARS(r.debito21)}</TableCell>
                    <TableCell className="text-right">{formatARS(r.debito105)}</TableCell>
                    <TableCell className="text-right">{formatARS(r.debitoOtros)}</TableCell>
                    <TableCell className="text-right font-medium">{formatARS(r.totalDebito)}</TableCell>
                    <TableCell className="text-right">{formatARS(r.credito21)}</TableCell>
                    <TableCell className="text-right">{formatARS(r.credito105)}</TableCell>
                    <TableCell className="text-right">{formatARS(r.creditoOtros)}</TableCell>
                    <TableCell className="text-right font-medium">{formatARS(r.totalCredito)}</TableCell>
                    <TableCell className={`text-right font-medium ${r.posicionNeta >= 0 ? "text-red-600" : "text-green-600"}`}>
                      {formatARS(r.posicionNeta)}
                    </TableCell>
                    <TableCell className="text-right">{formatARS(r.retenciones)}</TableCell>
                    <TableCell className={`text-right font-medium ${r.saldoFinal >= 0 ? "text-red-600" : "text-green-600"}`}>
                      {formatARS(r.saldoFinal)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
