"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Loader2 } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  type CategoriaFlujo,
  type FFDetalleRow,
  fetchFlujoDeFondosDetalle,
  formatARS,
  shortLabel,
} from "@/lib/financial-queries";
import type {
  Formatter, ValueType, NameType,
} from "recharts/types/component/DefaultTooltipContent";

const arsTooltip: Formatter<ValueType, NameType> = (v) => formatARS(Number(v ?? 0));

const CATEGORIA_LABELS: Record<CategoriaFlujo, string> = {
  proveedores: "Proveedores",
  sueldos: "Sueldos",
  impuestos: "Impuestos",
  financieros: "Gtos. Financieros",
  retiros: "Retiros",
  transferencias: "Transferencias",
  otros: "Otros",
};

const CATEGORIA_COLORS: Record<CategoriaFlujo, string> = {
  proveedores: "#ef4444",
  sueldos: "#f97316",
  impuestos: "#06b6d4",
  financieros: "#64748b",
  retiros: "#d946ef",
  transferencias: "#8b5cf6",
  otros: "#a3a3a3",
};

const CATEGORIAS: CategoriaFlujo[] = ["proveedores", "sueldos", "impuestos", "financieros", "retiros", "transferencias", "otros"];

// Subcategoria display orders
const IMPUESTOS_ORDER = ["AFIP", "ARBA", "Municipal", "Imp. al Cheque", "Cargas Sociales", "Otros"];
const TRANSFERENCIAS_ORDER = ["Entre cuentas propias", "Inviu"];

interface Props {
  availableYears: number[];
  adjust: (monto: number, periodo: string) => number;
}

interface ConceptRow {
  concepto: string;
  subcategoria: string | null;
  banco: "provincia" | "santander" | null;
  periods: Map<string, number>;
  total: number;
}

export function DetallePorCategoria({ availableYears, adjust }: Props) {
  const [anio, setAnio] = useState(availableYears[0] ?? new Date().getFullYear());
  const [categoria, setCategoria] = useState<CategoriaFlujo>("proveedores");
  const [allData, setAllData] = useState<FFDetalleRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setFetchError(null);
    fetchFlujoDeFondosDetalle(anio)
      .then(setAllData)
      .catch((e) => setFetchError(e.message ?? "Error"))
      .finally(() => setLoading(false));
  }, [anio]);

  // Periods for column headers (months in selected year that have data)
  const allPeriods = useMemo(() => {
    const set = new Set<string>();
    for (const r of allData) set.add(r.periodo);
    return Array.from(set).sort();
  }, [allData]);

  // Filter by category, apply inflation, group by concept + banco
  const { rows, grandTotal } = useMemo(() => {
    const filtered = allData.filter((r) => r.categoria === categoria);
    const map = new Map<string, ConceptRow>();

    for (const r of filtered) {
      const adj = adjust(r.monto, r.periodo);
      // Key by concepto + banco so same concept in different banks stays separate
      const bancoKey = r.banco ?? "mp";
      const key = `${r.concepto}||${bancoKey}`;
      const existing = map.get(key);
      if (existing) {
        existing.periods.set(r.periodo, (existing.periods.get(r.periodo) ?? 0) + adj);
        existing.total += adj;
        if (!existing.subcategoria && r.subcategoria) existing.subcategoria = r.subcategoria;
      } else {
        const periods = new Map<string, number>();
        periods.set(r.periodo, adj);
        map.set(key, { concepto: r.concepto, subcategoria: r.subcategoria, banco: r.banco, periods, total: adj });
      }
    }

    const sorted = Array.from(map.values()).sort((a, b) => b.total - a.total);
    const grandTotal = sorted.reduce((s, r) => s + r.total, 0);
    return { rows: sorted, grandTotal };
  }, [allData, categoria, adjust]);

  // Period totals for footer row
  const periodTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const r of rows) {
      r.periods.forEach((v, p) => {
        totals.set(p, (totals.get(p) ?? 0) + v);
      });
    }
    return totals;
  }, [rows]);

  // Top 10 for chart
  const top10 = useMemo(() =>
    rows.slice(0, 10).map((r) => {
      const label = r.concepto.length > 25 ? r.concepto.slice(0, 23) + "…" : r.concepto;
      const suffix = r.banco === "provincia" ? " [Prov]" : r.banco === "santander" ? " [Sant]" : r.banco === null && r.concepto.startsWith("MP:") ? "" : "";
      return { concepto: label + suffix, total: r.total };
    }),
  [rows]);

  // Group rows by subcategoria for impuestos and transferencias
  const groupedRows = useMemo(() => {
    if (categoria !== "impuestos" && categoria !== "transferencias") return null;
    const groups = new Map<string, ConceptRow[]>();
    for (const r of rows) {
      const sub = r.subcategoria ?? "Otros";
      const arr = groups.get(sub) ?? [];
      arr.push(r);
      groups.set(sub, arr);
    }
    // Sort by predefined order
    const order = categoria === "transferencias" ? TRANSFERENCIAS_ORDER : IMPUESTOS_ORDER;
    const result = order
      .filter((s) => groups.has(s))
      .map((s) => ({ subcategoria: s, items: groups.get(s)! }));
    // Include any groups not in predefined order
    groups.forEach((items, sub) => {
      if (!order.includes(sub)) {
        result.push({ subcategoria: sub, items });
      }
    });
    return result;
  }, [rows, categoria]);

  const showBeneficiario = categoria === "retiros";
  const showSubcategoria = categoria === "impuestos" || categoria === "transferencias";

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">Detalle por Categoría</CardTitle>
          <select
            value={anio}
            onChange={(e) => setAnio(Number(e.target.value))}
            className="rounded-md border bg-background px-3 py-1.5 text-sm"
          >
            {availableYears.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        {/* Category tabs */}
        <div className="flex flex-wrap items-center rounded-lg border text-xs font-medium">
          {CATEGORIAS.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoria(cat)}
              className={`px-3 py-1.5 transition-colors first:rounded-l-lg last:rounded-r-lg ${
                categoria === cat
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-accent"
              }`}
            >
              {CATEGORIA_LABELS[cat]}
            </button>
          ))}
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">Cargando detalle…</span>
          </div>
        )}

        {fetchError && (
          <p className="text-sm text-red-500">{fetchError}</p>
        )}

        {!loading && !fetchError && rows.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {categoria === "otros"
              ? "No hay movimientos sin clasificar"
              : `Sin datos para ${CATEGORIA_LABELS[categoria]} en ${anio}`}
          </p>
        )}

        {!loading && !fetchError && rows.length > 0 && (
          <>
            {/* Concept breakdown table */}
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[200px]">Concepto</TableHead>
                    <TableHead>Fuente</TableHead>
                    {showBeneficiario && <TableHead>Beneficiario</TableHead>}
                    {allPeriods.map((p) => (
                      <TableHead key={p} className="text-right whitespace-nowrap">{shortLabel(p)}</TableHead>
                    ))}
                    <TableHead className="text-right font-bold">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {showSubcategoria && groupedRows ? (
                    // Impuestos: grouped by subcategoria
                    groupedRows.map((group) => {
                      const subTotal = group.items.reduce((s, r) => s + r.total, 0);
                      const subPeriodTotals = new Map<string, number>();
                      for (const r of group.items) {
                        r.periods.forEach((v, p) => {
                          subPeriodTotals.set(p, (subPeriodTotals.get(p) ?? 0) + v);
                        });
                      }
                      return (
                        <ConceptGroup
                          key={group.subcategoria}
                          title={group.subcategoria}
                          items={group.items}
                          periods={allPeriods}
                          subTotal={subTotal}
                          subPeriodTotals={subPeriodTotals}
                          showBeneficiario={false}
                        />
                      );
                    })
                  ) : (
                    // Regular: flat list
                    rows.map((r) => (
                      <ConceptTableRow
                        key={r.concepto}
                        row={r}
                        periods={allPeriods}
                        showBeneficiario={showBeneficiario}
                      />
                    ))
                  )}
                  {/* Grand total row */}
                  <TableRow className="bg-muted/50 font-bold">
                    <TableCell>Total</TableCell>
                    <TableCell />
                    {showBeneficiario && <TableCell />}
                    {allPeriods.map((p) => (
                      <TableCell key={p} className="text-right">
                        {formatARS(periodTotals.get(p) ?? 0)}
                      </TableCell>
                    ))}
                    <TableCell className="text-right">{formatARS(grandTotal)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>

            {/* Top 10 horizontal bar chart */}
            {top10.length > 0 && (
              <div>
                <h3 className="mb-3 text-sm font-medium text-muted-foreground">Top 10 conceptos</h3>
                <ResponsiveContainer width="100%" height={Math.max(250, top10.length * 36)}>
                  <BarChart layout="vertical" data={top10} margin={{ left: 10, right: 30, top: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" horizontal={false} />
                    <XAxis type="number" fontSize={11} tickFormatter={(v: number) => `${(v / 1e6).toFixed(1)}M`} />
                    <YAxis type="category" dataKey="concepto" width={220} fontSize={11} tick={{ fill: "currentColor" }} />
                    <Tooltip formatter={arsTooltip} />
                    <Bar dataKey="total" name="Monto" fill={CATEGORIA_COLORS[categoria]} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Transferencias footnote */}
            {categoria === "transferencias" && (
              <p className="text-xs text-muted-foreground">
                * Las transferencias entre cuentas propias e Inviu son solo informativas. No se incluyen en el cálculo del Flujo de Fondos.
              </p>
            )}

            {/* MP footnote */}
            {allData.some((r) => r.categoria === categoria && r.fuente === "mp") && (
              <p className="text-xs text-muted-foreground">
                * Los conceptos &quot;MP: ...&quot; provienen de Mercado Pago, que solo registra tipo de operación (sin detalle de concepto).
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const BANCO_BADGE: Record<string, { label: string; className: string }> = {
  provincia: { label: "Prov", className: "bg-blue-100 text-blue-700" },
  santander: { label: "Sant", className: "bg-red-100 text-red-700" },
};

function BancoBadge({ banco }: { banco: "provincia" | "santander" | null }) {
  if (!banco) return <span className="inline-block rounded px-1.5 py-0.5 text-[10px] font-medium bg-purple-100 text-purple-700">MP</span>;
  const b = BANCO_BADGE[banco];
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${b.className}`}>{b.label}</span>;
}

function ConceptTableRow({
  row, periods, showBeneficiario,
}: {
  row: ConceptRow; periods: string[]; showBeneficiario: boolean;
}) {
  return (
    <TableRow>
      <TableCell className="font-medium whitespace-nowrap text-sm" title={row.concepto}>
        {row.concepto.length > 40 ? row.concepto.slice(0, 38) + "…" : row.concepto}
      </TableCell>
      <TableCell><BancoBadge banco={row.banco} /></TableCell>
      {showBeneficiario && (
        <TableCell className="text-sm">{row.subcategoria ?? "—"}</TableCell>
      )}
      {periods.map((p) => {
        const v = row.periods.get(p);
        return (
          <TableCell key={p} className="text-right text-sm tabular-nums">
            {v ? formatARS(v) : "—"}
          </TableCell>
        );
      })}
      <TableCell className="text-right font-medium text-sm tabular-nums">
        {formatARS(row.total)}
      </TableCell>
    </TableRow>
  );
}

function ConceptGroup({
  title, items, periods, subTotal, subPeriodTotals, showBeneficiario,
}: {
  title: string;
  items: ConceptRow[];
  periods: string[];
  subTotal: number;
  subPeriodTotals: Map<string, number>;
  showBeneficiario: boolean;
}) {
  // +1 for the Fuente column
  const colSpan = 2 + (showBeneficiario ? 1 : 0) + periods.length + 1;
  return (
    <>
      {/* Group header */}
      <TableRow className="bg-muted/30">
        <TableCell colSpan={colSpan} className="font-semibold text-xs uppercase tracking-wide py-1.5">
          {title}
        </TableCell>
      </TableRow>
      {/* Items */}
      {items.map((r) => (
        <ConceptTableRow key={`${r.concepto}||${r.banco ?? "mp"}`} row={r} periods={periods} showBeneficiario={showBeneficiario} />
      ))}
      {/* Subtotal row */}
      <TableRow className="border-b-2">
        <TableCell className="font-medium text-sm">Subtotal {title}</TableCell>
        <TableCell />
        {showBeneficiario && <TableCell />}
        {periods.map((p) => (
          <TableCell key={p} className="text-right text-sm font-medium tabular-nums">
            {formatARS(subPeriodTotals.get(p) ?? 0)}
          </TableCell>
        ))}
        <TableCell className="text-right font-bold text-sm tabular-nums">
          {formatARS(subTotal)}
        </TableCell>
      </TableRow>
    </>
  );
}
