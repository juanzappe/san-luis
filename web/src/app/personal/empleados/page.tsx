"use client";

import { useEffect, useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  Users,
  ArrowLeft,
  Loader2,
  AlertCircle,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  type EmpleadoRow,
  type EmpleadoDetalle,
  fetchEmpleados,
  fetchEmpleadoDetalle,
  formatARS,
  periodoLabel,
  shortLabel,
} from "@/lib/personal-queries";
import { InflationToggle, useInflation } from "@/lib/inflation";
import type {
  Formatter, ValueType, NameType,
} from "recharts/types/component/DefaultTooltipContent";

const arsTooltip: Formatter<ValueType, NameType> = (v) => formatARS(Number(v ?? 0));

export default function EmpleadosPage() {
  const [empleados, setEmpleados] = useState<EmpleadoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detalle, setDetalle] = useState<EmpleadoDetalle | null>(null);
  const [detalleLoading, setDetalleLoading] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const { adjust } = useInflation();

  useEffect(() => {
    fetchEmpleados()
      .then(setEmpleados)
      .catch((e) => setError(e.message ?? "Error"))
      .finally(() => setLoading(false));
  }, []);

  // Load detail when selectedId changes
  useEffect(() => {
    if (selectedId === null) { setDetalle(null); return; }
    setDetalleLoading(true);
    fetchEmpleadoDetalle(selectedId)
      .then(setDetalle)
      .catch(() => setDetalle(null))
      .finally(() => setDetalleLoading(false));
  }, [selectedId]);

  // Filter + sort: activos first, then by nombre
  const sorted = useMemo(
    () => [...empleados]
      .filter((e) => showInactive || e.activo)
      .sort((a, b) => {
        if (a.activo !== b.activo) return a.activo ? -1 : 1;
        return a.nombre.localeCompare(b.nombre);
      }),
    [empleados, showInactive],
  );

  const activosCount = useMemo(() => empleados.filter((e) => e.activo).length, [empleados]);

  // Chart data for detail view
  const salaryChart = useMemo(() => {
    if (!detalle) return [];
    return detalle.liquidaciones.map((l) => ({
      label: shortLabel(l.periodo),
      periodo: l.periodo,
      sueldo: adjust(l.sueldoNeto, l.periodo),
    }));
  }, [detalle, adjust]);

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
  if (empleados.length === 0) {
    return (
      <Card><CardContent className="py-8 text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-3 font-medium">Sin empleados cargados</p>
        <p className="text-sm text-muted-foreground">Importá datos de empleados para ver el listado.</p>
      </CardContent></Card>
    );
  }

  // Detail view
  if (selectedId !== null) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <button onClick={() => setSelectedId(null)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" /> Volver al listado
          </button>
          <InflationToggle />
        </div>

        {detalleLoading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : detalle ? (
          <>
            {/* Employee info card */}
            <Card>
              <CardHeader>
                <CardTitle>{detalle.empleado.nombre}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <p className="text-sm text-muted-foreground">CUIL</p>
                    <p className="font-medium">{detalle.empleado.cuil || "—"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Puesto</p>
                    <p className="font-medium">{detalle.empleado.puesto || "—"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Fecha Ingreso</p>
                    <p className="font-medium">{detalle.empleado.fechaIngreso ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Antigüedad</p>
                    <p className="font-medium">{detalle.empleado.antiguedad}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Último Sueldo</p>
                    <p className="font-medium">{formatARS(detalle.empleado.ultimoSueldo)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Estado</p>
                    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${detalle.empleado.activo ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                      {detalle.empleado.activo ? "Activo" : "Inactivo"}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Salary evolution chart */}
            {salaryChart.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-base">Evolución Salarial</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={salaryChart}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="label" fontSize={12} />
                      <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                      <Tooltip formatter={arsTooltip} />
                      <Line type="monotone" dataKey="sueldo" name="Sueldo Neto" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* Salary history table */}
            <Card>
              <CardHeader><CardTitle className="text-base">Historial de Liquidaciones</CardTitle></CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Período</TableHead>
                        <TableHead className="text-right">Sueldo Neto</TableHead>
                        <TableHead className="text-right">Variación %</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...detalle.liquidaciones].reverse().map((l) => (
                        <TableRow key={l.periodo}>
                          <TableCell className="font-medium">{periodoLabel(l.periodo)}</TableCell>
                          <TableCell className="text-right">{formatARS(adjust(l.sueldoNeto, l.periodo))}</TableCell>
                          <TableCell className={`text-right ${l.variacionPct !== null ? (l.variacionPct >= 0 ? "text-green-600" : "text-red-600") : ""}`}>
                            {l.variacionPct !== null ? `${l.variacionPct >= 0 ? "+" : ""}${l.variacionPct.toFixed(1)}%` : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </>
        ) : (
          <Card><CardContent className="py-8 text-center">
            <p className="text-sm text-muted-foreground">No se encontraron datos del empleado.</p>
          </CardContent></Card>
        )}
      </div>
    );
  }

  // Main list view
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Empleados</h1>
          <p className="text-muted-foreground">{activosCount} activos</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="rounded border-gray-300"
            />
            Ver inactivos
          </label>
          <InflationToggle />
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>CUIL</TableHead>
                  <TableHead className="text-right">Último Sueldo</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((e) => (
                  <TableRow
                    key={e.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setSelectedId(e.id)}
                  >
                    <TableCell className="font-medium">{e.nombre}</TableCell>
                    <TableCell className="whitespace-nowrap">{e.cuil || "—"}</TableCell>
                    <TableCell className="text-right">{formatARS(e.ultimoSueldo)}</TableCell>
                    <TableCell>
                      <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${e.activo ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                        {e.activo ? "Activo" : "Inactivo"}
                      </span>
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
