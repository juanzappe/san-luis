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
  ResponsiveContainer,
} from "recharts";
import { Loader2, AlertCircle } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  type PagoImpuestoRow,
  fetchPagosImpuestos,
  formatARS,
  tipoLabel,
  shortLabel,
} from "@/lib/tax-queries";
import { InflationToggle, useInflation } from "@/lib/inflation";
import type {
  Formatter, ValueType, NameType,
} from "recharts/types/component/DefaultTooltipContent";

const arsTooltip: Formatter<ValueType, NameType> = (v) => formatARS(Number(v ?? 0));

const JURISDICCIONES = ["ALL", "arca", "arba", "municipio"] as const;
const JURIS_LABELS: Record<string, string> = { ALL: "Todas", arca: "Nacional", arba: "Provincial", municipio: "Municipal" };

export default function PagosPage() {
  const [raw, setRaw] = useState<PagoImpuestoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [jurisFilter, setJurisFilter] = useState<string>("ALL");
  const [tipoFilter, setTipoFilter] = useState<string>("ALL");
  const { adjust } = useInflation();

  useEffect(() => {
    fetchPagosImpuestos()
      .then(setRaw)
      .catch((e) => setError(e.message ?? "Error"))
      .finally(() => setLoading(false));
  }, []);

  // Unique tipos for filter
  const tiposDisponibles = useMemo(() => {
    const set = new Set<string>();
    for (const p of raw) set.add(p.tipo);
    return Array.from(set).sort();
  }, [raw]);

  // Filtered data
  const filtered = useMemo(() => {
    let d = raw;
    if (jurisFilter !== "ALL") d = d.filter((p) => p.jurisdiccion === jurisFilter);
    if (tipoFilter !== "ALL") d = d.filter((p) => p.tipo === tipoFilter);
    return d;
  }, [raw, jurisFilter, tipoFilter]);

  // Monthly chart from filtered
  const monthlyChart = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of filtered) {
      const m = p.fechaPago.slice(0, 7);
      map.set(m, (map.get(m) ?? 0) + p.monto);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-24)
      .map(([periodo, monto]) => ({
        label: shortLabel(periodo),
        periodo,
        monto: adjust(monto, periodo),
      }));
  }, [filtered, adjust]);

  // Annual totals by tipo
  const annualByTipo = useMemo(() => {
    const map = new Map<string, Map<string, number>>(); // year -> tipo -> sum
    for (const p of raw) {
      const year = p.fechaPago.slice(0, 4);
      if (!map.has(year)) map.set(year, new Map());
      const tm = map.get(year)!;
      tm.set(p.tipo, (tm.get(p.tipo) ?? 0) + p.monto);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([year, tipos]) => ({
        year,
        tipos: Array.from(tipos.entries())
          .map(([tipo, monto]) => ({ tipo, label: tipoLabel(tipo), monto }))
          .sort((a, b) => b.monto - a.monto),
        total: Array.from(tipos.values()).reduce((s, v) => s + v, 0),
      }));
  }, [raw]);

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
  if (raw.length === 0) {
    return (
      <Card><CardContent className="py-8 text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-3 font-medium">Sin pagos de impuestos</p>
        <p className="text-sm text-muted-foreground">Importá datos de pagos para ver el historial.</p>
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Historial de Pagos</h1>
          <p className="text-muted-foreground">Todos los pagos de impuestos registrados</p>
        </div>
        <InflationToggle />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Jurisdicción</label>
          <div className="flex gap-1">
            {JURISDICCIONES.map((j) => (
              <button
                key={j}
                onClick={() => setJurisFilter(j)}
                className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                  jurisFilter === j ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"
                }`}
              >
                {JURIS_LABELS[j]}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Tipo de Impuesto</label>
          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => setTipoFilter("ALL")}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                tipoFilter === "ALL" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"
              }`}
            >
              Todos
            </button>
            {tiposDisponibles.map((t) => (
              <button
                key={t}
                onClick={() => setTipoFilter(t)}
                className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                  tipoFilter === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"
                }`}
              >
                {tipoLabel(t)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Pagos Mensuales</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={monthlyChart}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                <Tooltip formatter={arsTooltip} />
                <Bar dataKey="monto" name="Monto" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Evolución</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={monthlyChart}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                <Tooltip formatter={arsTooltip} />
                <Line type="monotone" dataKey="monto" name="Monto" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Payments table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Detalle de Pagos
            <span className="ml-2 text-sm font-normal text-muted-foreground">({filtered.length} registros)</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha Pago</TableHead>
                  <TableHead>Impuesto</TableHead>
                  <TableHead>Jurisdicción</TableHead>
                  <TableHead>Período Fiscal</TableHead>
                  <TableHead>Concepto</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead>Medio de Pago</TableHead>
                  <TableHead>Comprobante</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.slice(0, 200).map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="whitespace-nowrap">{p.fechaPago}</TableCell>
                    <TableCell>{p.tipoLabel}</TableCell>
                    <TableCell>{p.jurisdiccionLabel}</TableCell>
                    <TableCell>{p.periodoFiscal}</TableCell>
                    <TableCell className="max-w-[200px] truncate">{p.concepto || "—"}</TableCell>
                    <TableCell className="text-right font-medium">{formatARS(adjust(p.monto, p.fechaPago.slice(0, 7)))}</TableCell>
                    <TableCell>{p.medioPago || "—"}</TableCell>
                    <TableCell>{p.comprobante || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {filtered.length > 200 && (
              <p className="mt-2 text-center text-xs text-muted-foreground">
                Mostrando los primeros 200 de {filtered.length} pagos
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Annual summary */}
      {annualByTipo.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Totales Anuales por Impuesto</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Año</TableHead>
                    {annualByTipo[0]?.tipos.map((t) => (
                      <TableHead key={t.tipo} className="text-right">{t.label}</TableHead>
                    ))}
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {annualByTipo.map((row) => (
                    <TableRow key={row.year}>
                      <TableCell className="font-medium">{row.year}</TableCell>
                      {row.tipos.map((t) => (
                        <TableCell key={t.tipo} className="text-right">{formatARS(t.monto)}</TableCell>
                      ))}
                      <TableCell className="text-right font-bold">{formatARS(row.total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
