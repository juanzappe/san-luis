"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import {
  BarChart, Bar, AreaChart, Area, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { X as XIcon, Loader2, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";

import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  type CategoriaFlujo, type FFDetalleRow, type FlujoDeFondosRow,
  fetchFlujoDeFondosDetalle, formatARS, formatPct, pctDelta,
} from "@/lib/financial-queries";
import type { Formatter, ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";

const arsTooltip: Formatter<ValueType, NameType> = (v) => formatARS(Number(v ?? 0));
const SHORT_MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

interface CategoryConfig {
  key: CategoriaFlujo; label: string; color: string; flujoField: keyof FlujoDeFondosRow;
}

const MAIN_CATEGORIES: CategoryConfig[] = [
  { key: "proveedores", label: "Proveedores", color: "#ef4444", flujoField: "pagosProveedores" },
  { key: "impuestos", label: "Impuestos", color: "#06b6d4", flujoField: "pagosImpuestos" },
  { key: "retiros", label: "Retiros socios", color: "#d946ef", flujoField: "retirosSocios" },
  { key: "sueldos", label: "Sueldos", color: "#f97316", flujoField: "pagosSueldos" },
  { key: "tarjetas", label: "Tarjetas", color: "#f59e0b", flujoField: "pagosTarjetas" },
  { key: "financieros", label: "Gastos financieros", color: "#64748b", flujoField: "pagosGastosFinancieros" },
];
const MINOR_CATEGORIES: CategoryConfig[] = [
  { key: "transferencias", label: "Transferencias", color: "#8b5cf6", flujoField: "transferencias" },
];
const ALL_CATEGORIES = [...MAIN_CATEGORIES, ...MINOR_CATEGORIES];

interface Props {
  availableYears: number[]; adjust: (monto: number, periodo: string) => number;
  flujoData: FlujoDeFondosRow[]; activeYear: number;
}

type SortField = "periodo" | "concepto" | "fuente" | "monto";
type SortDir = "asc" | "desc";

const BANCO_LABELS: Record<string, string> = { provincia: "Bco. Provincia", santander: "Bco. Santander" };

export function DetallePorCategoria({ availableYears, adjust, flujoData, activeYear }: Props) {
  const [anio, setAnio] = useState(activeYear);
  const [expanded, setExpanded] = useState<CategoriaFlujo | null>(null);
  const [allData, setAllData] = useState<FFDetalleRow[]>([]);
  const [loading, setLoading] = useState(false);

  // Movement table state
  const [movMonth, setMovMonth] = useState<string>("all");
  const [sortField, setSortField] = useState<SortField>("monto");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;

  useEffect(() => { setAnio(activeYear); }, [activeYear]);
  useEffect(() => {
    setLoading(true);
    fetchFlujoDeFondosDetalle(anio).then(setAllData).catch(() => setAllData([])).finally(() => setLoading(false));
  }, [anio]);

  const prevYear = anio - 1;

  // Reset table state on expand change
  useEffect(() => { setPage(0); setMovMonth("all"); setSortField("monto"); setSortDir("desc"); }, [expanded]);

  // ─── Per-category totals ────────────────────────────────────────────────
  const categoryTotals = useMemo(() => {
    const yr = flujoData.filter((r) => r.periodo.startsWith(`${anio}-`));
    const pr = flujoData.filter((r) => r.periodo.startsWith(`${prevYear}-`));
    const maxM = yr.length > 0 ? Math.max(...yr.map((r) => parseInt(r.periodo.split("-")[1], 10))) : 12;
    const prc = pr.filter((r) => parseInt(r.periodo.split("-")[1], 10) <= maxM);
    const tot = yr.reduce((s, r) => s + r.pagosProveedores + r.pagosSueldos + r.pagosImpuestos + r.pagosGastosFinancieros + r.pagosTarjetas + r.retirosSocios, 0);
    const res = new Map<CategoriaFlujo, { total: number; prevTotal: number; pct: number }>();
    for (const c of ALL_CATEGORIES) {
      const t = yr.reduce((s, r) => s + (r[c.flujoField] as number), 0);
      const pt = prc.reduce((s, r) => s + (r[c.flujoField] as number), 0);
      res.set(c.key, { total: t, prevTotal: pt, pct: tot > 0 ? (t / tot) * 100 : 0 });
    }
    return res;
  }, [flujoData, anio, prevYear]);

  const maxTotal = useMemo(() => { let m = 0; categoryTotals.forEach((v) => { if (v.total > m) m = v.total; }); return m; }, [categoryTotals]);

  const top3ByCategory = useMemo(() => {
    const res = new Map<string, string[]>();
    for (const c of ALL_CATEGORIES) {
      const rows = allData.filter((r) => r.categoria === c.key);
      const cm = new Map<string, number>();
      for (const r of rows) cm.set(r.concepto, (cm.get(r.concepto) ?? 0) + adjust(r.monto, r.periodo));
      res.set(c.key, Array.from(cm.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => c.length > 30 ? c.slice(0, 28) + "..." : c));
    }
    return res;
  }, [allData, adjust]);

  // ─── Expanded data ─────────────────────────────────────────────────────
  const expandedCat = expanded ? ALL_CATEGORIES.find((c) => c.key === expanded) : null;
  const expandedTotals = expanded ? categoryTotals.get(expanded) : null;
  const expandedDelta = expandedTotals && expandedTotals.prevTotal !== 0 ? pctDelta(expandedTotals.total, expandedTotals.prevTotal) : null;

  const monthlyEvolution = useMemo(() => {
    if (!expanded || !expandedCat) return [];
    const yr = flujoData.filter((r) => r.periodo.startsWith(`${anio}-`));
    const pr = flujoData.filter((r) => r.periodo.startsWith(`${prevYear}-`));
    const pm = new Map(pr.map((r) => [r.periodo.split("-")[1], r[expandedCat.flujoField] as number]));
    return yr.map((r) => {
      const m = r.periodo.split("-")[1];
      return { label: SHORT_MONTHS[parseInt(m, 10) - 1], actual: r[expandedCat.flujoField] as number, prevYear: pm.get(m) ?? 0 };
    });
  }, [expanded, expandedCat, flujoData, anio, prevYear]);

  const top10 = useMemo(() => {
    if (!expanded) return [];
    const f = allData.filter((r) => r.categoria === expanded);
    const m = new Map<string, number>();
    for (const r of f) m.set(r.concepto, (m.get(r.concepto) ?? 0) + adjust(r.monto, r.periodo));
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([c, t]) => ({ concepto: c.length > 30 ? c.slice(0, 28) + "..." : c, total: t }));
  }, [expanded, allData, adjust]);

  // ─── Movement table data (sorted + paginated) ──────────────────────────
  const availableDetailMonths = useMemo(() => {
    if (!expanded) return [];
    const set = new Set<string>();
    for (const r of allData) { if (r.categoria === expanded) set.add(r.periodo); }
    return Array.from(set).sort();
  }, [allData, expanded]);

  const movementRows = useMemo(() => {
    if (!expanded) return [];
    let rows = allData.filter((r) => r.categoria === expanded);
    if (movMonth !== "all") rows = rows.filter((r) => r.periodo === movMonth);
    // Apply adjust
    const mapped = rows.map((r) => ({
      periodo: r.periodo,
      concepto: r.concepto,
      fuente: r.banco ? BANCO_LABELS[r.banco] ?? r.banco : "Mercado Pago",
      beneficiario: r.subcategoria ?? "—",
      monto: adjust(r.monto, r.periodo),
    }));
    // Sort
    mapped.sort((a, b) => {
      let cmp = 0;
      if (sortField === "monto") cmp = a.monto - b.monto;
      else if (sortField === "periodo") cmp = a.periodo.localeCompare(b.periodo);
      else if (sortField === "concepto") cmp = a.concepto.localeCompare(b.concepto);
      else cmp = a.fuente.localeCompare(b.fuente);
      return sortDir === "desc" ? -cmp : cmp;
    });
    return mapped;
  }, [allData, expanded, movMonth, sortField, sortDir, adjust]);

  const totalPages = Math.ceil(movementRows.length / PAGE_SIZE);
  const pagedRows = movementRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const movementTotal = movementRows.reduce((s, r) => s + r.monto, 0);

  const toggleSort = useCallback((field: SortField) => {
    if (sortField === field) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("desc"); }
    setPage(0);
  }, [sortField]);

  // ─── Expanded view ─────────────────────────────────────────────────────
  if (expanded && expandedCat) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Análisis por categoría</h2>
          <div className="flex items-center gap-3">
            <select value={anio} onChange={(e) => setAnio(Number(e.target.value))} className="rounded-md border bg-background px-3 py-1.5 text-sm">
              {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <button onClick={() => setExpanded(null)} className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent">
              <XIcon className="h-3.5 w-3.5" /> Volver
            </button>
          </div>
        </div>

        {/* KPI bar */}
        <div className="flex flex-wrap items-center gap-6 rounded-xl border p-5" style={{ borderLeftWidth: 4, borderLeftColor: expandedCat.color }}>
          <div className="flex items-center gap-3">
            <div className="h-4 w-4 rounded-full" style={{ backgroundColor: expandedCat.color }} />
            <span className="text-lg font-bold">{expandedCat.label}</span>
          </div>
          <div className="text-2xl font-bold tracking-tight">{formatARS(expandedTotals?.total ?? 0)}</div>
          <span className="text-sm text-muted-foreground">{(expandedTotals?.pct ?? 0).toFixed(1)}% del total</span>
          {expandedDelta !== null && (
            <span className={`text-sm font-medium ${expandedDelta > 0 ? "text-red-600" : expandedDelta < 0 ? "text-green-600" : ""}`}>{formatPct(expandedDelta)} vs {prevYear}</span>
          )}
          <div className="flex-1 min-w-[100px]">
            <div className="h-3 w-full rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${maxTotal > 0 ? ((expandedTotals?.total ?? 0) / maxTotal) * 100 : 0}%`, backgroundColor: expandedCat.color }} />
            </div>
          </div>
        </div>

        {/* Evolution chart */}
        {monthlyEvolution.length > 0 && (
          <div className="rounded-xl border p-5">
            <h3 className="text-sm font-medium text-muted-foreground mb-4">Evolución mensual — {anio} vs {prevYear}</h3>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={monthlyEvolution}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} tickLine={false} />
                <YAxis fontSize={11} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} tickLine={false} />
                <Tooltip formatter={arsTooltip} /><Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="actual" name={String(anio)} fill={expandedCat.color} stroke={expandedCat.color} fillOpacity={0.15} strokeWidth={2} />
                <Line type="monotone" dataKey="prevYear" name={String(prevYear)} stroke={expandedCat.color} strokeWidth={1.5} strokeDasharray="6 3" dot={false} strokeOpacity={0.5} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* YTD comparison + Top 10 */}
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl border p-5 space-y-4">
            <h3 className="text-sm font-medium text-muted-foreground">Comparativo YTD</h3>
            <div className="flex items-center gap-8">
              <div><p className="text-xs text-muted-foreground">{anio} (YTD)</p><p className="text-2xl font-bold">{formatARS(expandedTotals?.total ?? 0)}</p></div>
              <div className="text-2xl text-muted-foreground font-light">vs</div>
              <div><p className="text-xs text-muted-foreground">{prevYear} (YTD)</p><p className="text-2xl font-bold">{formatARS(expandedTotals?.prevTotal ?? 0)}</p></div>
              {expandedDelta !== null && (
                <div className="ml-auto text-right"><p className="text-xs text-muted-foreground">Variación</p>
                  <p className={`text-2xl font-bold ${expandedDelta > 0 ? "text-red-600" : expandedDelta < 0 ? "text-green-600" : ""}`}>{formatPct(expandedDelta)}</p>
                </div>
              )}
            </div>
          </div>
          {top10.length > 0 && (
            <div className="rounded-xl border p-5">
              <h3 className="text-sm font-medium text-muted-foreground mb-4">Top 10 conceptos</h3>
              <ResponsiveContainer width="100%" height={Math.max(200, top10.length * 30)}>
                <BarChart layout="vertical" data={top10} margin={{ left: 10, right: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" horizontal={false} />
                  <XAxis type="number" fontSize={10} tickFormatter={(v: number) => `${(v / 1e6).toFixed(1)}M`} />
                  <YAxis type="category" dataKey="concepto" width={180} fontSize={10} tick={{ fill: "currentColor" }} />
                  <Tooltip formatter={arsTooltip} />
                  <Bar dataKey="total" name="Monto" fill={expandedCat.color} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Movement table */}
        <div className="rounded-xl border p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-muted-foreground">Movimientos</h3>
            <div className="flex items-center gap-2">
              <select value={movMonth} onChange={(e) => { setMovMonth(e.target.value); setPage(0); }} className="rounded-md border bg-background px-2 py-1 text-xs">
                <option value="all">Todos los meses</option>
                {availableDetailMonths.map((p) => {
                  const [, m] = p.split("-");
                  return <option key={p} value={p}>{SHORT_MONTHS[parseInt(m, 10) - 1]}</option>;
                })}
              </select>
              <span className="text-xs text-muted-foreground">{movementRows.length} registros</span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("periodo")}>
                    Fecha <ArrowUpDown className="inline h-3 w-3 ml-1" />
                  </TableHead>
                  <TableHead className="cursor-pointer select-none min-w-[200px]" onClick={() => toggleSort("concepto")}>
                    Concepto <ArrowUpDown className="inline h-3 w-3 ml-1" />
                  </TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("fuente")}>
                    Fuente <ArrowUpDown className="inline h-3 w-3 ml-1" />
                  </TableHead>
                  <TableHead>Beneficiario</TableHead>
                  <TableHead className="text-right cursor-pointer select-none" onClick={() => toggleSort("monto")}>
                    Monto <ArrowUpDown className="inline h-3 w-3 ml-1" />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedRows.map((r, i) => (
                  <TableRow key={i} className={i % 2 === 0 ? "bg-muted/20" : ""}>
                    <TableCell className="text-sm whitespace-nowrap">{r.periodo}</TableCell>
                    <TableCell className="text-sm" title={r.concepto}>{r.concepto.length > 45 ? r.concepto.slice(0, 43) + "..." : r.concepto}</TableCell>
                    <TableCell className="text-sm">{r.fuente}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.beneficiario}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{formatARS(r.monto)}</TableCell>
                  </TableRow>
                ))}
                {pagedRows.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">Sin movimientos</TableCell></TableRow>
                )}
                <TableRow className="font-bold border-t-2">
                  <TableCell colSpan={4}>Total{movMonth !== "all" ? "" : ` (${movementRows.length} registros)`}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatARS(movementTotal)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Página {page + 1} de {totalPages}</span>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="rounded p-1 hover:bg-accent disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
                <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="rounded p-1 hover:bg-accent disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
              </div>
            </div>
          )}
        </div>

        {loading && <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}
      </div>
    );
  }

  // ─── Grid view ─────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Análisis por categoría</h2>
        <select value={anio} onChange={(e) => setAnio(Number(e.target.value))} className="rounded-md border bg-background px-3 py-1.5 text-sm">
          {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MAIN_CATEGORIES.map((cat) => {
          const t = categoryTotals.get(cat.key);
          const d = t && t.prevTotal !== 0 ? pctDelta(t.total, t.prevTotal) : null;
          const tops = top3ByCategory.get(cat.key) ?? [];
          const bw = maxTotal > 0 && t ? (t.total / maxTotal) * 100 : 0;
          return (
            <button key={cat.key} onClick={() => setExpanded(cat.key)} className="w-full text-left rounded-xl border p-5 space-y-3 transition-all hover:shadow-md hover:border-foreground/20">
              <div className="flex items-center gap-2"><div className="h-3 w-3 rounded-full" style={{ backgroundColor: cat.color }} /><span className="font-medium text-sm">{cat.label}</span></div>
              <div>
                <p className="text-xl font-bold tracking-tight">{formatARS(t?.total ?? 0)}</p>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-xs text-muted-foreground">{(t?.pct ?? 0).toFixed(1)}% del total</span>
                  {d !== null && <span className={`text-xs font-medium ${d > 0 ? "text-red-600" : d < 0 ? "text-green-600" : "text-muted-foreground"}`}>{formatPct(d)} vs {prevYear}</span>}
                </div>
              </div>
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full transition-all duration-500" style={{ width: `${bw}%`, backgroundColor: cat.color }} /></div>
              {tops.length > 0 && !loading && <div className="space-y-0.5">{tops.map((c, i) => <p key={i} className="text-xs text-muted-foreground truncate">{i + 1}. {c}</p>)}</div>}
              {loading && <div className="flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin text-muted-foreground" /><span className="text-xs text-muted-foreground">Cargando...</span></div>}
            </button>
          );
        })}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MINOR_CATEGORIES.map((cat) => {
          const t = categoryTotals.get(cat.key);
          const d = t && t.prevTotal !== 0 ? pctDelta(t.total, t.prevTotal) : null;
          return (
            <button key={cat.key} onClick={() => setExpanded(cat.key)} className="text-left rounded-xl border px-4 py-3 transition-all hover:shadow-sm hover:border-foreground/20">
              <div className="flex items-center justify-between"><div className="flex items-center gap-2"><div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: cat.color }} /><span className="text-sm font-medium">{cat.label}</span></div><span className="font-semibold text-sm">{formatARS(t?.total ?? 0)}</span></div>
              {d !== null && <p className={`text-xs mt-1 ${d > 0 ? "text-red-600" : d < 0 ? "text-green-600" : "text-muted-foreground"}`}>{formatPct(d)} vs {prevYear}</p>}
            </button>
          );
        })}
        {(() => {
          const ct = flujoData.filter((r) => r.periodo.startsWith(`${anio}-`)).reduce((s, r) => s + r.totalCobros, 0);
          return (
            <div className="text-left rounded-xl border border-green-200 bg-green-50/50 dark:border-green-900 dark:bg-green-950/30 px-4 py-3">
              <div className="flex items-center justify-between"><div className="flex items-center gap-2"><div className="h-2.5 w-2.5 rounded-full bg-green-500" /><span className="text-sm font-medium">Cobros</span></div><span className="font-semibold text-sm text-green-700 dark:text-green-400">{formatARS(ct)}</span></div>
              <p className="text-xs mt-1 text-muted-foreground">Total cobrado en {anio}</p>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
