"use client";

import React, { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Database,
  Hash,
  Calendar,
  AlertTriangle,
  Loader2,
  AlertCircle,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  fetchDatasetsStatus,
  fetchDatasetMonthly,
  formatNumber,
  formatDateAR,
  type DatasetRow,
  type DatasetEstado,
  type DatasetMonthlyRow,
} from "@/lib/datasets-queries";

// ---------------------------------------------------------------------------
// Status badge config
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<
  DatasetEstado,
  { label: string; dot: string; bg: string }
> = {
  al_dia: { label: "Al día", dot: "bg-green-500", bg: "bg-green-50 text-green-700" },
  anual: { label: "Anual", dot: "bg-yellow-500", bg: "bg-yellow-50 text-yellow-700" },
  desactualizado: {
    label: "Desactualizado",
    dot: "bg-red-500",
    bg: "bg-red-50 text-red-700",
  },
  catalogo: { label: "Catálogo", dot: "bg-gray-400", bg: "bg-gray-50 text-gray-600" },
};

function StatusBadge({ estado }: { estado: DatasetEstado }) {
  const c = STATUS_CONFIG[estado];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${c.bg}`}
    >
      <span className={`inline-block h-2 w-2 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// KPI Card
// ---------------------------------------------------------------------------

function KpiCard({
  title,
  value,
  icon: Icon,
  alert,
}: {
  title: string;
  value: string;
  icon: React.ElementType;
  alert?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon
          className={`h-4 w-4 ${alert ? "text-red-500" : "text-muted-foreground"}`}
        />
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${alert ? "text-red-600" : ""}`}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Expandable detail row
// ---------------------------------------------------------------------------

function DetailRow({ tabla }: { tabla: string }) {
  const [monthly, setMonthly] = useState<DatasetMonthlyRow[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDatasetMonthly(tabla)
      .then(setMonthly)
      .catch(() => setMonthly([]))
      .finally(() => setLoading(false));
  }, [tabla]);

  if (loading) {
    return (
      <TableRow>
        <TableCell colSpan={7} className="bg-muted/30 py-6">
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Cargando distribución…</span>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  if (!monthly || monthly.length === 0) {
    return (
      <TableRow>
        <TableCell colSpan={7} className="bg-muted/30 py-4">
          <p className="text-center text-sm text-muted-foreground">
            Sin distribución temporal (tabla de catálogo)
          </p>
        </TableCell>
      </TableRow>
    );
  }

  // Show last 24 months max
  const chartData = monthly.slice(-24).map((r) => ({
    periodo: r.periodo.slice(2), // "24-01" instead of "2024-01"
    registros: r.registros,
  }));

  return (
    <TableRow>
      <TableCell colSpan={7} className="bg-muted/30 p-4">
        <div className="mx-auto max-w-3xl">
          <p className="mb-2 text-sm font-medium">
            Registros por mes — {tabla}
          </p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData}>
              <CartesianGrid
                strokeDasharray="3 3"
                className="stroke-muted"
              />
              <XAxis dataKey="periodo" fontSize={10} interval="preserveStartEnd" />
              <YAxis fontSize={10} tickFormatter={(v) => formatNumber(v)} />
              <Tooltip
                formatter={(v) => [formatNumber(Number(v)), "Registros"]}
              />
              <Bar dataKey="registros" fill="#3b82f6" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </TableCell>
    </TableRow>
  );
}

// ---------------------------------------------------------------------------
// Cobertura visual
// ---------------------------------------------------------------------------

function CoberturaCell({ meses }: { meses: number | null }) {
  if (meses === null) return <span className="text-muted-foreground">—</span>;
  const label =
    meses >= 12
      ? `${Math.floor(meses / 12)}a ${meses % 12}m`
      : `${meses} meses`;
  // Bar fill: max 36 months = 100%
  const pct = Math.min((meses / 36) * 100, 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-16 rounded-full bg-muted">
        <div
          className="h-2 rounded-full bg-blue-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function DatasetsPage() {
  const [datasets, setDatasets] = useState<DatasetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedTable, setExpandedTable] = useState<string | null>(null);

  useEffect(() => {
    fetchDatasetsStatus()
      .then(setDatasets)
      .catch((e) => setError(e.message ?? "Error"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-3 text-muted-foreground">Cargando estado de datasets…</span>
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

  // KPI calculations
  const tablasConDatos = datasets.filter((d) => d.registros > 0).length;
  const totalRegistros = datasets.reduce((s, d) => s + d.registros, 0);
  const datoMasReciente = datasets
    .filter((d) => d.ultimoDato)
    .sort((a, b) => (b.ultimoDato ?? "").localeCompare(a.ultimoDato ?? ""))
    [0]?.ultimoDato ?? null;
  const tablasDesactualizadas = datasets.filter(
    (d) => d.estado === "desactualizado"
  ).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Datasets</h1>
        <p className="text-muted-foreground">
          Estado de las {datasets.length} fuentes de datos importadas
        </p>
      </div>

      {/* Section 1: KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Tablas con datos"
          value={`${tablasConDatos} / ${datasets.length}`}
          icon={Database}
        />
        <KpiCard
          title="Total registros"
          value={formatNumber(totalRegistros)}
          icon={Hash}
        />
        <KpiCard
          title="Dato más reciente"
          value={formatDateAR(datoMasReciente)}
          icon={Calendar}
        />
        <KpiCard
          title="Tablas desactualizadas"
          value={String(tablasDesactualizadas)}
          icon={AlertTriangle}
          alert={tablasDesactualizadas > 0}
        />
      </div>

      {/* Section 2: Status Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Estado de cada dataset</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Tabla</TableHead>
                <TableHead>Fuente</TableHead>
                <TableHead className="text-right">Registros</TableHead>
                <TableHead>Primer dato</TableHead>
                <TableHead>Último dato</TableHead>
                <TableHead>Cobertura</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {datasets.map((d) => {
                const isExpanded = expandedTable === d.tabla;
                const hasDate = d.tipo !== "catalogo";
                return (
                  <React.Fragment key={d.tabla}>
                    <TableRow
                      className={`cursor-pointer hover:bg-muted/50 ${isExpanded ? "bg-muted/30" : ""}`}
                      onClick={() =>
                        setExpandedTable(isExpanded ? null : d.tabla)
                      }
                    >
                      <TableCell className="w-8 px-2">
                        {hasDate ? (
                          isExpanded ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          )
                        ) : null}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {d.tabla}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {d.fuente}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatNumber(d.registros)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {formatDateAR(d.primerDato)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {formatDateAR(d.ultimoDato)}
                      </TableCell>
                      <TableCell>
                        <CoberturaCell meses={d.coberturaMeses} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge estado={d.estado} />
                      </TableCell>
                    </TableRow>
                    {isExpanded && hasDate && (
                      <DetailRow tabla={d.tabla} />
                    )}
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
