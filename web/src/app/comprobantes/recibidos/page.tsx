"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FileText,
  CheckCircle2,
  XCircle,
  Percent,
  Loader2,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type ComprobanteRecibido,
  type ComprobantesFilters,
  type ComprobantesResumen,
  TIPO_COMPROBANTE_OPTIONS,
  fetchComprobantesRecibidos,
  fetchComprobantesResumen,
  formatARS2,
  formatComprobanteNumero,
  tipoComprobanteLabel,
  updateCopiaFisica,
} from "@/lib/comprobantes-queries";

const PAGE_SIZE = 50;

const AÑOS = [2024, 2025, 2026];

const MESES: Array<{ value: number | null; label: string }> = [
  { value: null, label: "Todos" },
  { value: 1, label: "Enero" },
  { value: 2, label: "Febrero" },
  { value: 3, label: "Marzo" },
  { value: 4, label: "Abril" },
  { value: 5, label: "Mayo" },
  { value: 6, label: "Junio" },
  { value: 7, label: "Julio" },
  { value: 8, label: "Agosto" },
  { value: 9, label: "Septiembre" },
  { value: 10, label: "Octubre" },
  { value: 11, label: "Noviembre" },
  { value: 12, label: "Diciembre" },
];

function formatFechaDMY(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

const SELECT_CLASS =
  "h-8 rounded-lg border border-input bg-background px-2.5 py-1 text-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2";

export default function ComprobantesRecibidosPage() {
  const currentYear = new Date().getFullYear();
  const initialYear = AÑOS.includes(currentYear) ? currentYear : AÑOS[AÑOS.length - 1];

  const [filters, setFilters] = useState<ComprobantesFilters>({
    anio: initialYear,
    mes: null,
    cuit: null,
    tipoComprobante: null,
    tieneCopiaFisica: null,
    search: null,
  });

  // search input is separate from `filters.search` so we can debounce it
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(0);

  const [rows, setRows] = useState<ComprobanteRecibido[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [resumen, setResumen] = useState<ComprobantesResumen | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Debounce the search input (300ms) into filters.search
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((prev) => {
        const normalized = searchInput.trim() === "" ? null : searchInput.trim();
        if (prev.search === normalized) return prev;
        return { ...prev, search: normalized };
      });
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Reset page when non-search filters change
  const filtersKey = useMemo(
    () =>
      JSON.stringify({
        anio: filters.anio,
        mes: filters.mes,
        tipo: filters.tipoComprobante,
        copia: filters.tieneCopiaFisica,
        search: filters.search,
      }),
    [filters],
  );

  // Fetch data whenever filters or page change
  const lastReqRef = useRef(0);
  useEffect(() => {
    const reqId = ++lastReqRef.current;
    setLoading(true);
    setError(null);

    Promise.all([
      fetchComprobantesRecibidos(filters, PAGE_SIZE, page * PAGE_SIZE),
      fetchComprobantesResumen(filters.anio, filters.mes),
    ])
      .then(([listing, kpis]) => {
        if (reqId !== lastReqRef.current) return;
        setRows(listing.rows);
        setTotalCount(listing.totalCount);
        setResumen(kpis);
      })
      .catch((e: unknown) => {
        if (reqId !== lastReqRef.current) return;
        setError(e instanceof Error ? e.message : "Error al cargar comprobantes");
      })
      .finally(() => {
        if (reqId !== lastReqRef.current) return;
        setLoading(false);
      });
  }, [filters, page]);

  // Auto-dismiss error toast
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const handleToggleCopia = useCallback(
    async (comprobante: ComprobanteRecibido) => {
      const nuevoValor = !comprobante.tieneCopiaFisica;
      const delta = nuevoValor ? 1 : -1;

      // Optimistic UI: update the row and KPIs locally
      setRows((prev) =>
        prev.map((r) => (r.id === comprobante.id ? { ...r, tieneCopiaFisica: nuevoValor } : r)),
      );
      setResumen((prev) => {
        if (!prev) return prev;
        const conCopia = prev.conCopia + delta;
        const sinCopia = prev.sinCopia - delta;
        const total = prev.totalComprobantes;
        const porcentajeCopia =
          total > 0 ? Math.round((conCopia / total) * 1000) / 10 : 0;
        return { ...prev, conCopia, sinCopia, porcentajeCopia };
      });

      try {
        await updateCopiaFisica(comprobante.id, nuevoValor);
      } catch (e: unknown) {
        // Revert on failure
        setRows((prev) =>
          prev.map((r) =>
            r.id === comprobante.id ? { ...r, tieneCopiaFisica: comprobante.tieneCopiaFisica } : r,
          ),
        );
        setResumen((prev) => {
          if (!prev) return prev;
          const conCopia = prev.conCopia - delta;
          const sinCopia = prev.sinCopia + delta;
          const total = prev.totalComprobantes;
          const porcentajeCopia =
            total > 0 ? Math.round((conCopia / total) * 1000) / 10 : 0;
          return { ...prev, conCopia, sinCopia, porcentajeCopia };
        });
        const msg = e instanceof Error ? e.message : "Error al actualizar";
        setToast(`No se pudo actualizar la copia física: ${msg}`);
      }
    },
    [],
  );

  const limpiarFiltros = () => {
    setFilters({
      anio: initialYear,
      mes: null,
      cuit: null,
      tipoComprobante: null,
      tieneCopiaFisica: null,
      search: null,
    });
    setSearchInput("");
    setPage(0);
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const showingFrom = totalCount === 0 ? 0 : page * PAGE_SIZE + 1;
  const showingTo = Math.min(totalCount, (page + 1) * PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Comprobantes Recibidos</h1>
        <p className="text-muted-foreground">
          Facturas de proveedores cargadas desde ARCA. Tildá la copia física cuando la archives en la
          carpeta del mes.
        </p>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Comprobantes</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {resumen ? resumen.totalComprobantes.toLocaleString("es-AR") : "—"}
            </div>
            <p className="text-xs text-muted-foreground">
              {resumen
                ? `${resumen.proveedoresUnicos} proveedores · $${formatARS2(resumen.montoTotal)}`
                : "Del período seleccionado"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Con Copia Física</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600">
              {resumen ? resumen.conCopia.toLocaleString("es-AR") : "—"}
            </div>
            <div className="mt-1">
              <span className="inline-flex items-center rounded-full border border-transparent bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-800">
                Archivadas
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Sin Copia Física</CardTitle>
            <XCircle className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-amber-600">
              {resumen ? resumen.sinCopia.toLocaleString("es-AR") : "—"}
            </div>
            <div className="mt-1">
              <span className="inline-flex items-center rounded-full border border-transparent bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                Pendientes
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">% Cobertura</CardTitle>
            <Percent className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-600">
              {resumen ? `${resumen.porcentajeCopia.toFixed(1)}%` : "—"}
            </div>
            <p className="text-xs text-muted-foreground">Comprobantes con copia física</p>
          </CardContent>
        </Card>
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Año</label>
              <select
                value={filters.anio ?? ""}
                onChange={(e) => {
                  const v = e.target.value === "" ? null : Number(e.target.value);
                  setFilters((p) => ({ ...p, anio: v }));
                  setPage(0);
                }}
                className={SELECT_CLASS}
              >
                {AÑOS.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Mes</label>
              <select
                value={filters.mes ?? ""}
                onChange={(e) => {
                  const v = e.target.value === "" ? null : Number(e.target.value);
                  setFilters((p) => ({ ...p, mes: v }));
                  setPage(0);
                }}
                className={SELECT_CLASS}
              >
                {MESES.map((m) => (
                  <option key={m.label} value={m.value ?? ""}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Tipo Comprobante</label>
              <select
                value={filters.tipoComprobante ?? ""}
                onChange={(e) => {
                  const v = e.target.value === "" ? null : Number(e.target.value);
                  setFilters((p) => ({ ...p, tipoComprobante: v }));
                  setPage(0);
                }}
                className={SELECT_CLASS}
              >
                <option value="">Todos</option>
                {TIPO_COMPROBANTE_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Copia Física</label>
              <select
                value={
                  filters.tieneCopiaFisica === null
                    ? ""
                    : filters.tieneCopiaFisica
                      ? "true"
                      : "false"
                }
                onChange={(e) => {
                  const raw = e.target.value;
                  const v = raw === "" ? null : raw === "true";
                  setFilters((p) => ({ ...p, tieneCopiaFisica: v }));
                  setPage(0);
                }}
                className={SELECT_CLASS}
              >
                <option value="">Todas</option>
                <option value="true">Con copia</option>
                <option value="false">Sin copia</option>
              </select>
            </div>

            <div className="flex flex-col gap-1 min-w-[220px] flex-1">
              <label className="text-xs text-muted-foreground">Buscar proveedor</label>
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Razón social del emisor..."
              />
            </div>

            <Button variant="outline" size="sm" onClick={limpiarFiltros}>
              Limpiar filtros
            </Button>
          </div>
          {/* filtersKey keeps the memo alive for future use (e.g. server-side caching) */}
          <span className="hidden" aria-hidden data-filters-key={filtersKey} />
        </CardContent>
      </Card>

      {/* Toast de error para optimistic update */}
      {toast && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive bg-destructive/10 px-4 py-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          <span>{toast}</span>
        </div>
      )}

      {/* Tabla */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Listado</CardTitle>
            <p className="text-sm text-muted-foreground">
              {totalCount === 0
                ? "Sin resultados"
                : `Mostrando ${showingFrom}-${showingTo} de ${totalCount.toLocaleString("es-AR")} comprobantes`}
            </p>
          </div>
        </CardHeader>
        <CardContent>
          {error ? (
            <div className="flex h-48 flex-col items-center justify-center gap-2 text-muted-foreground">
              <AlertCircle className="h-8 w-8" />
              <p>{error}</p>
            </div>
          ) : loading ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded bg-muted" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
              No hay comprobantes que coincidan con los filtros.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16 text-center">Copia</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>PV-Número</TableHead>
                    <TableHead>CUIT Emisor</TableHead>
                    <TableHead>Razón Social</TableHead>
                    <TableHead className="text-right">Neto Gravado</TableHead>
                    <TableHead className="text-right">IVA</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-center">
                        <input
                          type="checkbox"
                          checked={r.tieneCopiaFisica}
                          onChange={() => handleToggleCopia(r)}
                          className="h-4 w-4 cursor-pointer accent-primary"
                          aria-label={`Marcar copia física ${r.id}`}
                        />
                      </TableCell>
                      <TableCell>{formatFechaDMY(r.fechaEmision)}</TableCell>
                      <TableCell>
                        <span className="font-mono text-xs">
                          {tipoComprobanteLabel(r.tipoComprobante)}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {formatComprobanteNumero(r.puntoVenta, r.numeroDesde)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {r.nroDocEmisor ?? "—"}
                      </TableCell>
                      <TableCell className="max-w-[280px] truncate" title={r.denominacionEmisor ?? ""}>
                        {r.denominacionEmisor ?? "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatARS2(r.impNetoGravadoTotal)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatARS2(r.totalIva)}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatARS2(r.impTotal)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Paginación */}
          {totalCount > PAGE_SIZE && (
            <div className="mt-4 flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                Página {page + 1} de {totalPages}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0 || loading}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1 || loading}
                >
                  Siguiente
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {loading && rows.length > 0 && (
            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Actualizando...
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
