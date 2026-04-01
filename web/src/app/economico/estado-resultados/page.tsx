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
  Cell,
  ReferenceLine,
} from "recharts";
import { Loader2, AlertCircle } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { InflationToggle, useInflation } from "@/lib/inflation";
import {
  type ResultadoRow,
  fetchResultado,
  formatARS,
  periodoLabel,
  shortLabel,
} from "@/lib/economic-queries";
import type {
  Formatter, ValueType, NameType,
} from "recharts/types/component/DefaultTooltipContent";

const arsTooltip: Formatter<ValueType, NameType> = (v) => formatARS(Number(v ?? 0));

// ---------------------------------------------------------------------------
// P&L line item component
// ---------------------------------------------------------------------------
function PnlLine({
  label,
  values,
  bold,
  border,
  indent,
  negative,
}: {
  label: string;
  values: number[];
  bold?: boolean;
  border?: boolean;
  indent?: boolean;
  negative?: boolean;
}) {
  return (
    <TableRow className={border ? "border-t-2 border-foreground/20" : ""}>
      <TableCell className={`${bold ? "font-bold" : ""} ${indent ? "pl-8" : ""}`}>
        {negative && !bold ? `(−) ${label}` : label}
      </TableCell>
      {values.map((v, i) => (
        <TableCell
          key={i}
          className={`text-right ${bold ? "font-bold" : ""} ${
            v < 0 ? "text-red-600" : ""
          }`}
        >
          {formatARS(Math.abs(v))}
        </TableCell>
      ))}
    </TableRow>
  );
}

// ---------------------------------------------------------------------------
// Waterfall chart data builder
// ---------------------------------------------------------------------------
interface WaterfallBar {
  name: string;
  base: number; // invisible base
  value: number; // visible bar
  total?: boolean;
  color: string;
}

function buildWaterfall(row: ResultadoRow): WaterfallBar[] {
  const bars: WaterfallBar[] = [];
  let running = 0;

  // Ingresos (starts from 0)
  bars.push({ name: "Ingresos", base: 0, value: row.ingresos, color: "#22c55e" });
  running = row.ingresos;

  // Costos operativos — proveedores only (subtract)
  bars.push({
    name: "C. Operativos",
    base: running - row.costosOperativos,
    value: row.costosOperativos,
    color: "#ef4444",
  });
  running -= row.costosOperativos;

  // Sueldos (subtract)
  bars.push({
    name: "Sueldos",
    base: running - row.sueldos,
    value: row.sueldos,
    color: "#6366f1",
  });
  running -= row.sueldos;

  // Margen bruto (subtotal)
  bars.push({ name: "Margen Bruto", base: 0, value: running, total: true, color: running >= 0 ? "#22c55e" : "#ef4444" });

  // Costos comerciales
  bars.push({
    name: "C. Comerciales",
    base: running - row.costosComercialesAdmin,
    value: row.costosComercialesAdmin,
    color: "#f59e0b",
  });
  running -= row.costosComercialesAdmin;

  // Costos financieros
  bars.push({
    name: "C. Financieros",
    base: running - row.costosFinancieros,
    value: row.costosFinancieros,
    color: "#3b82f6",
  });
  running -= row.costosFinancieros;

  // Ganancias
  bars.push({
    name: "Ganancias",
    base: running - row.ganancias,
    value: row.ganancias,
    color: "#8b5cf6",
  });
  running -= row.ganancias;

  // Resultado neto (final total)
  bars.push({
    name: "Resultado",
    base: 0,
    value: running,
    total: true,
    color: running >= 0 ? "#22c55e" : "#ef4444",
  });

  return bars;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export default function EstadoResultadosPage() {
  const { adjust } = useInflation();
  const [raw, setRaw] = useState<ResultadoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchResultado()
      .then(setRaw)
      .catch((e) => setError(e.message ?? "Error"))
      .finally(() => setLoading(false));
  }, []);

  // Adjust for inflation
  const data: ResultadoRow[] = useMemo(
    () =>
      raw.map((r) => {
        const ing = adjust(r.ingresos, r.periodo);
        const costOp = adjust(r.costosOperativos, r.periodo);
        const sueldos = adjust(r.sueldos, r.periodo);
        const costCom = adjust(r.costosComercialesAdmin, r.periodo);
        const costFin = adjust(r.costosFinancieros, r.periodo);
        const gan = adjust(r.ganancias, r.periodo);
        const margenBruto = ing - costOp - sueldos;
        const resAntesGan = margenBruto - costCom - costFin;
        const resNeto = resAntesGan - gan;
        const margenPct = ing > 0 ? (resNeto / ing) * 100 : 0;
        return {
          periodo: r.periodo,
          ingresos: ing,
          costosOperativos: costOp,
          sueldos,
          margenBruto,
          costosComercialesAdmin: costCom,
          costosFinancieros: costFin,
          resultadoAntesGanancias: resAntesGan,
          ganancias: gan,
          resultadoNeto: resNeto,
          margenPct,
        };
      }),
    [raw, adjust],
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
      <Card>
        <CardContent className="flex items-center gap-3 py-8">
          <AlertCircle className="h-5 w-5 text-red-500" />
          <p className="text-sm">{error}</p>
        </CardContent>
      </Card>
    );
  }

  if (data.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 font-medium">Sin datos para el estado de resultados</p>
          <p className="text-sm text-muted-foreground">
            Ejecutá el ETL para importar ventas, egresos e impuestos.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Take last 6 months for the P&L table columns
  const tablePeriods = data.slice(-6);
  const lastRow = data[data.length - 1];
  const waterfall = buildWaterfall(lastRow);

  // Margin evolution (last 12 months)
  const marginData = data.slice(-12).map((r) => ({
    label: shortLabel(r.periodo),
    margen: r.margenPct,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Estado de Resultados</h1>
          <p className="text-muted-foreground">
            Calculado desde datos operativos — últimos 6 meses
          </p>
        </div>
        <InflationToggle />
      </div>

      {/* P&L Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Estado de Resultados</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[220px]">Concepto</TableHead>
                {tablePeriods.map((r) => (
                  <TableHead key={r.periodo} className="text-right">
                    {periodoLabel(r.periodo)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              <PnlLine
                label="Ingresos Netos"
                values={tablePeriods.map((r) => r.ingresos)}
                bold
              />
              <PnlLine
                label="Costos Operativos"
                values={tablePeriods.map((r) => r.costosOperativos)}
                indent
                negative
              />
              <PnlLine
                label="Sueldos"
                values={tablePeriods.map((r) => r.sueldos)}
                indent
                negative
              />
              <PnlLine
                label="Margen Bruto"
                values={tablePeriods.map((r) => r.margenBruto)}
                bold
                border
              />
              <PnlLine
                label="Costos Comerciales"
                values={tablePeriods.map((r) => r.costosComercialesAdmin)}
                indent
                negative
              />
              <PnlLine
                label="Costos Financieros"
                values={tablePeriods.map((r) => r.costosFinancieros)}
                indent
                negative
              />
              <PnlLine
                label="Resultado antes de Ganancias"
                values={tablePeriods.map((r) => r.resultadoAntesGanancias)}
                bold
                border
              />
              <PnlLine
                label="Imp. a las Ganancias"
                values={tablePeriods.map((r) => r.ganancias)}
                indent
                negative
              />
              <PnlLine
                label="Resultado Neto"
                values={tablePeriods.map((r) => r.resultadoNeto)}
                bold
                border
              />
              {/* Margin % row */}
              <TableRow className="border-t">
                <TableCell className="italic text-muted-foreground">Margen neto %</TableCell>
                {tablePeriods.map((r) => (
                  <TableCell
                    key={r.periodo}
                    className={`text-right italic ${
                      r.margenPct >= 0 ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {r.margenPct.toFixed(1)}%
                  </TableCell>
                ))}
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Ingresos vs Egresos & Resultado Neto — 2 column */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Ingresos vs Egresos */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ingresos vs Egresos</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart
                data={tablePeriods.map((r) => ({
                  label: shortLabel(r.periodo),
                  ingresos: r.ingresos,
                  egresos: r.costosOperativos + r.sueldos + r.costosComercialesAdmin + r.costosFinancieros,
                }))}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                <Tooltip formatter={arsTooltip} />
                <Bar dataKey="ingresos" name="Ingresos Netos" fill="#22c55e" radius={[4, 4, 0, 0]} />
                <Bar dataKey="egresos" name="Total Egresos" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Resultado Neto Mensual */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Resultado Neto Mensual</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart
                data={tablePeriods.map((r) => ({
                  label: shortLabel(r.periodo),
                  resultado: r.resultadoNeto,
                }))}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                <Tooltip formatter={arsTooltip} />
                <ReferenceLine y={0} stroke="#666" />
                <Bar dataKey="resultado" name="Resultado Neto" radius={[4, 4, 0, 0]}>
                  {tablePeriods.map((r, i) => (
                    <Cell key={i} fill={r.resultadoNeto >= 0 ? "#22c55e" : "#ef4444"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Charts — 2 column */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Waterfall */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Cascada — {periodoLabel(lastRow.periodo)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={350}>
              <BarChart data={waterfall}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="name" fontSize={11} />
                <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                <Tooltip formatter={arsTooltip} />
                <ReferenceLine y={0} stroke="#666" />
                {/* Invisible base */}
                <Bar dataKey="base" stackId="w" fill="transparent" />
                {/* Visible value */}
                <Bar dataKey="value" stackId="w" radius={[4, 4, 0, 0]}>
                  {waterfall.map((entry, index) => (
                    <Cell key={index} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Margin evolution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Evolución del Margen Neto</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={350}>
              <LineChart data={marginData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `${v.toFixed(0)}%`} />
                <Tooltip
                  formatter={((v: ValueType | undefined) => `${Number(v ?? 0).toFixed(1)}%`) as Formatter<ValueType, NameType>}
                />
                <ReferenceLine y={0} stroke="#666" strokeDasharray="3 3" />
                <Line
                  type="monotone"
                  dataKey="margen"
                  name="Margen neto %"
                  stroke="#ec4899"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
