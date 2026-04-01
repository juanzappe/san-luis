"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { Loader2, AlertCircle } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { InflationToggle, useInflation } from "@/lib/inflation";
import {
  type BalanceRubroRow,
  type EstadoResultadosContableRow,
  fetchBalanceRubros,
  fetchEstadoResultadosContable,
  formatARS,
  formatARSAccounting,
} from "@/lib/economic-queries";
import type {
  Formatter, ValueType, NameType,
} from "recharts/types/component/DefaultTooltipContent";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const arsTooltip: Formatter<ValueType, NameType> = (v) => formatARS(Number(v ?? 0));

const EJERCICIOS = ["2021", "2022", "2023", "2024"] as const;
type EjercicioFilter = (typeof EJERCICIOS)[number] | "Todos";

const BALANCE_SECTIONS = [
  "activo_corriente",
  "activo_no_corriente",
  "pasivo_corriente",
  "pasivo_no_corriente",
  "patrimonio_neto",
] as const;

const SECCION_LABELS: Record<string, string> = {
  activo_corriente: "ACTIVO CORRIENTE",
  activo_no_corriente: "ACTIVO NO CORRIENTE",
  pasivo_corriente: "PASIVO CORRIENTE",
  pasivo_no_corriente: "PASIVO NO CORRIENTE",
  patrimonio_neto: "PATRIMONIO NETO",
};

const ER_SECTION_ORDER = [
  "ingresos",
  "costo_operativo",
  "gasto_administracion",
  "gasto_comercializacion",
  "gasto_financiero",
  "otros_ingresos",
  "impuestos",
  "resultado",
] as const;

// Chart colors
const ACTIVO_CORRIENTE_COLOR = "#22c55e";
const ACTIVO_NO_CORRIENTE_COLOR = "#16a34a";
const PASIVO_CORRIENTE_COLOR = "#ef4444";
const PASIVO_NO_CORRIENTE_COLOR = "#dc2626";
const PATRIMONIO_NETO_COLOR = "#3b82f6";

// Complementary rubros shown in smaller text
const COMPLEMENTARY_RUBROS = new Set([
  "Cantidad de Acciones",
  "Valor Libro de la Acción",
]);

// Total rubros that get highlighted background
const TOTAL_RUBROS = new Set([
  "Total del activo",
  "Total del pasivo",
  "TOTAL PASIVO Y PATRIMONIO NETO",
]);

// Subtotal rubros that get bold
const SUBTOTAL_KEYWORDS = ["total del", "total patrimonio", "total pasivo y"];

function isSubtotal(rubro: string): boolean {
  const lower = rubro.toLowerCase();
  return SUBTOTAL_KEYWORDS.some((k) => lower.includes(k));
}

// ---------------------------------------------------------------------------
// Ejercicio Selector
// ---------------------------------------------------------------------------

function EjercicioSelector({
  value,
  onChange,
}: {
  value: EjercicioFilter;
  onChange: (v: EjercicioFilter) => void;
}) {
  const options: EjercicioFilter[] = [...EJERCICIOS, "Todos"];
  return (
    <div className="flex items-center rounded-lg border text-xs font-medium">
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={`px-3 py-1.5 transition-colors first:rounded-l-lg last:rounded-r-lg ${
            value === opt
              ? "bg-primary text-primary-foreground"
              : "hover:bg-accent"
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export default function BalancePage() {
  const { adjust } = useInflation();
  const [rawBalance, setRawBalance] = useState<BalanceRubroRow[]>([]);
  const [rawER, setRawER] = useState<EstadoResultadosContableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ejercicio, setEjercicio] = useState<EjercicioFilter>("Todos");

  useEffect(() => {
    Promise.all([fetchBalanceRubros(), fetchEstadoResultadosContable()])
      .then(([b, er]) => {
        setRawBalance(b);
        setRawER(er);
      })
      .catch((e) => setError(e.message ?? "Error"))
      .finally(() => setLoading(false));
  }, []);

  // Inflation-adjusted balance data
  const balanceData = useMemo(
    () =>
      rawBalance.map((r) => ({
        ...r,
        monto: adjust(r.monto, `${r.ejercicio}-12`),
        monto_ejercicio_anterior: adjust(
          r.monto_ejercicio_anterior,
          `${Number(r.ejercicio) - 1}-12`,
        ),
      })),
    [rawBalance, adjust],
  );

  // Inflation-adjusted ER data
  const erData = useMemo(
    () =>
      rawER.map((r) => ({
        ...r,
        monto: adjust(r.monto, `${r.ejercicio}-12`),
        monto_ejercicio_anterior: adjust(
          r.monto_ejercicio_anterior,
          `${Number(r.ejercicio) - 1}-12`,
        ),
      })),
    [rawER, adjust],
  );

  // Available ejercicios in the data
  const availableEjercicios = useMemo(() => {
    const set = new Set<string>();
    balanceData.forEach((r) => set.add(r.ejercicio));
    return Array.from(set).sort();
  }, [balanceData]);

  // Filtered balance for tables
  const filteredBalance = useMemo(
    () =>
      ejercicio === "Todos"
        ? balanceData
        : balanceData.filter((r) => r.ejercicio === ejercicio),
    [balanceData, ejercicio],
  );

  // Filtered ER for tables
  const filteredER = useMemo(
    () =>
      ejercicio === "Todos"
        ? erData
        : erData.filter((r) => r.ejercicio === ejercicio),
    [erData, ejercicio],
  );

  // -----------------------------------------------------------------------
  // Balance table: pivot data by (seccion, rubro) → monto per ejercicio
  // -----------------------------------------------------------------------
  const balanceTableData = useMemo(() => {
    const years = ejercicio === "Todos" ? availableEjercicios : [ejercicio];

    // Group rows by seccion, preserving unique rubros in orden
    const sectionMap = new Map<
      string,
      { rubro: string; orden: number; values: Map<string, number> }[]
    >();

    for (const sec of BALANCE_SECTIONS) {
      const sectionRows = filteredBalance
        .filter((r) => r.seccion === sec)
        .sort((a, b) => a.orden - b.orden);

      const rubroMap = new Map<
        string,
        { rubro: string; orden: number; values: Map<string, number> }
      >();

      for (const r of sectionRows) {
        if (!rubroMap.has(r.rubro)) {
          rubroMap.set(r.rubro, {
            rubro: r.rubro,
            orden: r.orden,
            values: new Map(),
          });
        }
        rubroMap.get(r.rubro)!.values.set(r.ejercicio, r.monto);
      }

      sectionMap.set(
        sec,
        Array.from(rubroMap.values()).sort((a, b) => a.orden - b.orden),
      );
    }

    return { years, sectionMap };
  }, [filteredBalance, ejercicio, availableEjercicios]);

  // -----------------------------------------------------------------------
  // ER table: pivot data by (seccion, linea) → monto per ejercicio
  // -----------------------------------------------------------------------
  const erTableData = useMemo(() => {
    const years = ejercicio === "Todos" ? availableEjercicios : [ejercicio];

    const sectionMap = new Map<
      string,
      { linea: string; orden: number; values: Map<string, number> }[]
    >();

    for (const sec of ER_SECTION_ORDER) {
      const sectionRows = filteredER
        .filter((r) => r.seccion === sec)
        .sort((a, b) => a.orden - b.orden);

      const lineaMap = new Map<
        string,
        { linea: string; orden: number; values: Map<string, number> }
      >();

      for (const r of sectionRows) {
        if (!lineaMap.has(r.linea)) {
          lineaMap.set(r.linea, {
            linea: r.linea,
            orden: r.orden,
            values: new Map(),
          });
        }
        lineaMap.get(r.linea)!.values.set(r.ejercicio, r.monto);
      }

      sectionMap.set(
        sec,
        Array.from(lineaMap.values()).sort((a, b) => a.orden - b.orden),
      );
    }

    return { years, sectionMap };
  }, [filteredER, ejercicio, availableEjercicios]);

  // -----------------------------------------------------------------------
  // Chart data — always use all ejercicios
  // -----------------------------------------------------------------------
  const balanceChartData = useMemo(() => {
    return availableEjercicios.map((ej) => {
      const rows = balanceData.filter((r) => r.ejercicio === ej);
      const sum = (sec: string) =>
        rows
          .filter((r) => r.seccion === sec && !isSubtotal(r.rubro) && !COMPLEMENTARY_RUBROS.has(r.rubro))
          .reduce((acc, r) => acc + r.monto, 0);
      return {
        ejercicio: ej,
        activoCorriente: sum("activo_corriente"),
        activoNoCorriente: sum("activo_no_corriente"),
        pasivoCorriente: sum("pasivo_corriente"),
        pasivoNoCorriente: sum("pasivo_no_corriente"),
        patrimonioNeto: sum("patrimonio_neto"),
      };
    });
  }, [balanceData, availableEjercicios]);

  const erChartData = useMemo(() => {
    return availableEjercicios.map((ej) => {
      const rows = erData.filter((r) => r.ejercicio === ej);
      const ingresosRow = rows.find(
        (r) => r.seccion === "ingresos" && r.linea.toLowerCase().includes("venta"),
      );
      const resultadoRow = rows.find(
        (r) =>
          r.seccion === "resultado" &&
          r.linea.toLowerCase().includes("resultado integral"),
      );
      return {
        ejercicio: ej,
        ingresos: ingresosRow?.monto ?? 0,
        resultado: resultadoRow?.monto ?? 0,
      };
    });
  }, [erData, availableEjercicios]);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

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

  if (rawBalance.length === 0 && rawER.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 font-medium">Sin datos de balance</p>
          <p className="text-sm text-muted-foreground">
            Ejecutá el ETL para importar los estados contables.
          </p>
        </CardContent>
      </Card>
    );
  }

  const { years, sectionMap } = balanceTableData;
  const colSpan = years.length + 1;

  // Helpers for the ER table
  const isResultLine = (linea: string) => {
    const l = linea.toLowerCase();
    return (
      l.includes("resultado bruto") ||
      l.includes("resultado operativo") ||
      l.includes("resultado antes") ||
      l.includes("resultado integral") ||
      l.includes("resultado del ejercicio")
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Balance</h1>
          <p className="text-muted-foreground">
            Estados contables auditados — Ejercicios {availableEjercicios[0]} a{" "}
            {availableEjercicios[availableEjercicios.length - 1]}
          </p>
        </div>
        <InflationToggle />
      </div>

      {/* Ejercicio selector */}
      <EjercicioSelector value={ejercicio} onChange={setEjercicio} />

      {/* Estado de Situación Patrimonial */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Estado de Situación Patrimonial
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[240px]">Rubro</TableHead>
                  {years.map((y) => (
                    <TableHead key={y} className="text-right">
                      {y}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {BALANCE_SECTIONS.map((sec) => {
                  const rows = sectionMap.get(sec) ?? [];
                  if (rows.length === 0) return null;

                  // Insert separator before pasivo_corriente
                  const showSeparatorBefore =
                    sec === "pasivo_corriente" || sec === "patrimonio_neto";

                  return (
                    <BalanceSection
                      key={sec}
                      seccion={sec}
                      label={SECCION_LABELS[sec]}
                      rows={rows}
                      years={years}
                      colSpan={colSpan}
                      showSeparatorBefore={showSeparatorBefore}
                    />
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Balance charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Composición del Activo
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={balanceChartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="ejercicio" fontSize={12} />
                <YAxis
                  fontSize={12}
                  tickFormatter={(v) => `${(v / 1e6).toFixed(0)}M`}
                />
                <Tooltip formatter={arsTooltip} />
                <Legend />
                <Bar
                  dataKey="activoCorriente"
                  name="Activo Corriente"
                  stackId="a"
                  fill={ACTIVO_CORRIENTE_COLOR}
                />
                <Bar
                  dataKey="activoNoCorriente"
                  name="Activo No Corriente"
                  stackId="a"
                  fill={ACTIVO_NO_CORRIENTE_COLOR}
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Estructura Financiera
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={balanceChartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="ejercicio" fontSize={12} />
                <YAxis
                  fontSize={12}
                  tickFormatter={(v) => `${(v / 1e6).toFixed(0)}M`}
                />
                <Tooltip formatter={arsTooltip} />
                <Legend />
                <Bar
                  dataKey="pasivoCorriente"
                  name="Pasivo Corriente"
                  stackId="a"
                  fill={PASIVO_CORRIENTE_COLOR}
                />
                <Bar
                  dataKey="pasivoNoCorriente"
                  name="Pasivo No Corriente"
                  stackId="a"
                  fill={PASIVO_NO_CORRIENTE_COLOR}
                />
                <Bar
                  dataKey="patrimonioNeto"
                  name="Patrimonio Neto"
                  stackId="a"
                  fill={PATRIMONIO_NETO_COLOR}
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Estado de Resultados Contable */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Estado de Resultados Contable
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[280px]">Concepto</TableHead>
                  {erTableData.years.map((y) => (
                    <TableHead key={y} className="text-right">
                      {y}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {ER_SECTION_ORDER.map((sec) => {
                  const rows = erTableData.sectionMap.get(sec) ?? [];
                  return rows.map((row) => {
                    const bold = isResultLine(row.linea);
                    const isSectionResult = sec === "resultado";
                    return (
                      <TableRow
                        key={`${sec}-${row.linea}`}
                        className={
                          isSectionResult
                            ? "border-t-2 border-foreground/20"
                            : ""
                        }
                      >
                        <TableCell
                          className={`${bold || isSectionResult ? "font-bold" : ""} ${
                            !bold && !isSectionResult ? "pl-8" : ""
                          }`}
                        >
                          {row.linea}
                        </TableCell>
                        {erTableData.years.map((y) => {
                          const val = row.values.get(y) ?? 0;
                          const isNeg = val < 0;
                          const isResult = isSectionResult || bold;
                          return (
                            <TableCell
                              key={y}
                              className={`text-right ${
                                isResult ? "font-bold" : ""
                              } ${
                                isResult && isNeg
                                  ? "text-red-600"
                                  : isResult && val > 0
                                    ? "text-green-600"
                                    : ""
                              }`}
                            >
                              {formatARSAccounting(val)}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    );
                  });
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Results evolution chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Evolución de Resultados</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={erChartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="ejercicio" fontSize={12} />
              <YAxis
                fontSize={12}
                tickFormatter={(v) => `${(v / 1e6).toFixed(0)}M`}
              />
              <Tooltip formatter={arsTooltip} />
              <Legend />
              <Bar
                dataKey="ingresos"
                name="Ingresos por ventas"
                fill="#22c55e"
                radius={[4, 4, 0, 0]}
              />
              <Bar
                dataKey="resultado"
                name="Resultado del ejercicio"
                radius={[4, 4, 0, 0]}
              >
                {erChartData.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={entry.resultado >= 0 ? "#3b82f6" : "#ef4444"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Balance Section sub-component
// ---------------------------------------------------------------------------

function BalanceSection({
  seccion,
  label,
  rows,
  years,
  colSpan,
  showSeparatorBefore,
}: {
  seccion: string;
  label: string;
  rows: { rubro: string; orden: number; values: Map<string, number> }[];
  years: string[];
  colSpan: number;
  showSeparatorBefore: boolean;
}) {
  return (
    <>
      {/* Separator */}
      {showSeparatorBefore && (
        <TableRow>
          <TableCell colSpan={colSpan} className="h-4 border-0" />
        </TableRow>
      )}
      {/* Section header */}
      <TableRow className="bg-muted/50">
        <TableCell
          colSpan={colSpan}
          className="font-bold text-xs uppercase tracking-wider"
        >
          {label}
        </TableCell>
      </TableRow>
      {/* Rubro rows */}
      {rows.map((row) => {
        const isTotalRow = TOTAL_RUBROS.has(row.rubro);
        const isSubtotalRow = isSubtotal(row.rubro);
        const isComplementary = COMPLEMENTARY_RUBROS.has(row.rubro);

        return (
          <TableRow
            key={`${seccion}-${row.rubro}`}
            className={isTotalRow ? "bg-primary/10" : ""}
          >
            <TableCell
              className={`${
                isTotalRow || isSubtotalRow ? "font-bold" : ""
              } ${isComplementary ? "text-xs text-muted-foreground" : ""} ${
                !isTotalRow && !isSubtotalRow && !isComplementary ? "pl-8" : ""
              }`}
            >
              {row.rubro}
            </TableCell>
            {years.map((y) => {
              const val = row.values.get(y) ?? 0;
              return (
                <TableCell
                  key={y}
                  className={`text-right ${
                    isTotalRow || isSubtotalRow ? "font-bold" : ""
                  } ${isComplementary ? "text-xs text-muted-foreground" : ""}`}
                >
                  {isComplementary && !row.rubro.includes("Valor")
                    ? val.toLocaleString("es-AR")
                    : formatARS(val)}
                </TableCell>
              );
            })}
          </TableRow>
        );
      })}
    </>
  );
}
