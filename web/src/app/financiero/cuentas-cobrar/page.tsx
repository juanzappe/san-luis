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
  FileText,
  Clock,
  AlertTriangle,
  Loader2,
  AlertCircle,
  Search,
  X,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  type CuentaCobrarRow,
  fetchCuentasCobrar,
  toggleFacturaPagada,
  buildAgingBuckets,
  formatARS,
} from "@/lib/financial-queries";
import type {
  Formatter, ValueType, NameType,
} from "recharts/types/component/DefaultTooltipContent";

const arsTooltip: Formatter<ValueType, NameType> = (v) => formatARS(Number(v ?? 0));

const AGING_COLORS = ["#22c55e", "#f59e0b", "#f97316", "#ef4444"];
const PIE_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#8b5cf6", "#ef4444", "#06b6d4", "#ec4899", "#64748b", "#84cc16", "#14b8a6"];

function agingColor(dias: number): string {
  if (dias > 90) return "text-red-600 bg-red-50";
  if (dias > 30) return "text-amber-600 bg-amber-50";
  return "text-green-600 bg-green-50";
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

export default function CuentasCobrarPage() {
  const [data, setData] = useState<CuentaCobrarRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Track in-flight checkbox saves to show a spinner per row
  const [saving, setSaving] = useState<Set<number>>(new Set());

  // Filters (applied in the table only; KPIs/charts are always from full pendientes)
  const [searchQuery, setSearchQuery]   = useState("");
  const [statusFilter, setStatusFilter] = useState<"todos" | "pendiente" | "pagado">("todos");
  const [fechaDesde, setFechaDesde]     = useState("");
  const [fechaHasta, setFechaHasta]     = useState("");

  const hasActiveFilters = searchQuery !== "" || statusFilter !== "todos" || fechaDesde !== "" || fechaHasta !== "";

  function clearFilters() {
    setSearchQuery("");
    setStatusFilter("todos");
    setFechaDesde("");
    setFechaHasta("");
  }

  useEffect(() => {
    fetchCuentasCobrar()
      .then(setData)
      .catch((e) => setError(e.message ?? "Error"))
      .finally(() => setLoading(false));
  }, []);

  async function handleToggle(id: number, newPagada: boolean) {
    // Optimistic update
    setData((prev) =>
      prev.map((r) =>
        r.id === id ? { ...r, pagada: newPagada, pagadaManual: newPagada } : r,
      ),
    );
    setSaving((s) => new Set(s).add(id));
    try {
      await toggleFacturaPagada(id, newPagada);
    } catch {
      // Revert on failure
      setData((prev) =>
        prev.map((r) =>
          r.id === id ? { ...r, pagada: !newPagada, pagadaManual: null } : r,
        ),
      );
    } finally {
      setSaving((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }
  }

  // Only pending (not paid) rows drive KPIs and charts
  const pendientes = useMemo(() => data.filter((r) => !r.pagada), [data]);

  const kpis = useMemo(() => {
    const total = pendientes.reduce((s, r) => s + r.monto, 0);
    const qty = pendientes.length;
    const avgDias = qty > 0 ? pendientes.reduce((s, r) => s + r.diasPendientes, 0) / qty : 0;
    const vencido = pendientes.filter((r) => r.diasPendientes > 30).reduce((s, r) => s + r.monto, 0);
    return { total, qty, avgDias, vencido };
  }, [pendientes]);

  const aging = useMemo(() => buildAgingBuckets(pendientes), [pendientes]);

  const topClientes = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of pendientes) {
      map.set(r.cliente, (map.get(r.cliente) ?? 0) + r.monto);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, value]) => ({ name, value }));
  }, [pendientes]);

  // Table: all rows sorted by dias desc; pagadas shown dimmed at the bottom
  const sorted = useMemo(() => {
    return [...data].sort((a, b) => {
      if (a.pagada !== b.pagada) return a.pagada ? 1 : -1; // pagadas sink to bottom
      return b.diasPendientes - a.diasPendientes;
    });
  }, [data]);

  // Filter bar — applied on top of sorted (AND logic)
  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sorted.filter((r) => {
      if (q && !r.cliente.toLowerCase().includes(q) && !r.cuit.toLowerCase().includes(q)) return false;
      if (statusFilter === "pendiente" && r.pagada)  return false;
      if (statusFilter === "pagado"    && !r.pagada) return false;
      // fechaEmision is YYYY-MM-DD — lexicographic comparison works correctly
      if (fechaDesde && r.fechaEmision < fechaDesde) return false;
      if (fechaHasta && r.fechaEmision > fechaHasta) return false;
      return true;
    });
  }, [sorted, searchQuery, statusFilter, fechaDesde, fechaHasta]);

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
        <p className="mt-3 font-medium">Sin cuentas por cobrar pendientes</p>
        <p className="text-sm text-muted-foreground">No hay facturas de Servicios (PV 0006) con estado pendiente o parcial.</p>
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Cuentas por Cobrar</h1>
        <p className="text-muted-foreground">
          Facturas de Servicios (PV 0006) — aging y estado de cobro
        </p>
      </div>

      {/* KPIs — only pending (not paid) */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Total Pendiente"      value={formatARS(kpis.total)}              icon={DollarSign} />
        <KpiCard title="Facturas Pendientes"  value={String(kpis.qty)}                   icon={FileText} />
        <KpiCard title="Antigüedad Promedio"  value={`${Math.round(kpis.avgDias)} días`} icon={Clock} />
        <KpiCard title="Monto Vencido (>30d)" value={formatARS(kpis.vencido)}            icon={AlertTriangle} />
      </div>

      {/* Charts — only pending */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Aging de Cartera</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={aging}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                <Tooltip formatter={arsTooltip} />
                <Bar dataKey="monto" name="Monto">
                  {aging.map((_, i) => (
                    <Cell key={i} fill={AGING_COLORS[i]} radius={[4, 4, 0, 0] as unknown as number} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Top 10 Deudores</CardTitle></CardHeader>
          <CardContent>
            {topClientes.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={topClientes}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={110}
                    dataKey="value"
                    nameKey="name"
                    label={({ name, percent }) => `${(name as string).slice(0, 15)} ${((percent ?? 0) * 100).toFixed(0)}%`}
                    labelLine={false}
                    fontSize={10}
                  >
                    {topClientes.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={arsTooltip} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="py-12 text-center text-sm text-muted-foreground">Sin pendientes</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Invoice table — all rows */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Detalle de Facturas</CardTitle>
            <span className="text-xs text-muted-foreground">
              {filtered.length !== sorted.length
                ? `${filtered.length} de ${sorted.length} facturas`
                : `${kpis.qty} pendientes · ${data.length - kpis.qty} cobradas`}
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filter bar */}
          <div className="flex flex-wrap items-end gap-3">
            {/* Text search */}
            <div className="relative min-w-[200px] flex-1">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Buscar cliente o CUIT…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8"
              />
            </div>

            {/* Status selector */}
            <div className="flex items-center rounded-lg border text-xs font-medium">
              {(["todos", "pendiente", "pagado"] as const).map((opt) => (
                <button
                  key={opt}
                  onClick={() => setStatusFilter(opt)}
                  className={`px-3 py-1.5 capitalize transition-colors first:rounded-l-lg last:rounded-r-lg ${
                    statusFilter === opt
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-accent"
                  }`}
                >
                  {opt === "todos" ? "Todos" : opt === "pendiente" ? "Pendiente" : "Pagado"}
                </button>
              ))}
            </div>

            {/* Date range */}
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <span className="whitespace-nowrap text-xs text-muted-foreground">Desde</span>
                <Input
                  type="date"
                  value={fechaDesde}
                  onChange={(e) => setFechaDesde(e.target.value)}
                  className="w-36"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="whitespace-nowrap text-xs text-muted-foreground">Hasta</span>
                <Input
                  type="date"
                  value={fechaHasta}
                  onChange={(e) => setFechaHasta(e.target.value)}
                  className="w-36"
                />
              </div>
            </div>

            {/* Clear button — shown only when a filter is active */}
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
                Limpiar filtros
              </button>
            )}
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 text-center">Pagado</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>CUIT</TableHead>
                  <TableHead>Factura</TableHead>
                  <TableHead>Emisión</TableHead>
                  <TableHead>Vencimiento</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead className="text-right">Días</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                      No hay facturas que coincidan con los filtros aplicados.
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map((r) => (
                  <TableRow
                    key={r.id}
                    className={r.pagada ? "opacity-40" : ""}
                  >
                    <TableCell className="text-center">
                      {saving.has(r.id) ? (
                        <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
                      ) : (
                        <input
                          type="checkbox"
                          checked={r.pagada}
                          onChange={(e) => handleToggle(r.id, e.target.checked)}
                          className="h-4 w-4 cursor-pointer accent-primary"
                          aria-label={`Marcar factura ${r.factura} como ${r.pagada ? "pendiente" : "pagada"}`}
                        />
                      )}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate font-medium">{r.cliente}</TableCell>
                    <TableCell className="whitespace-nowrap">{r.cuit || "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{r.factura}</TableCell>
                    <TableCell className="whitespace-nowrap">{r.fechaEmision}</TableCell>
                    <TableCell className="whitespace-nowrap">{r.vencimiento || "—"}</TableCell>
                    <TableCell className="text-right font-medium">{formatARS(r.monto)}</TableCell>
                    <TableCell className="text-right">
                      <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${agingColor(r.diasPendientes)}`}>
                        {r.diasPendientes}d
                      </span>
                    </TableCell>
                    <TableCell className="capitalize">{r.estado}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">
            Facturas marcadas como cobradas se muestran con opacidad reducida y no se contabilizan en los KPIs.
            Las mayores de 30 días sin registro manual se consideran cobradas automáticamente.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
