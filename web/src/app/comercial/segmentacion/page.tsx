"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, AlertCircle } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  type ClientesData,
  type ProveedoresData,
  type CatalogRow,
  fetchClientes,
  fetchProveedores,
  fetchCatalogoCategorias,
  fetchCatalogoSectores,
  calcAbcGroups,
  formatARS,
} from "@/lib/commercial-queries";
import { InflationToggle } from "@/lib/inflation";

type Tab = "clientes" | "proveedores" | "catalogos";

const ABC_COLORS = {
  "A (80%)": "bg-green-50 text-green-700",
  "B (15%)": "bg-amber-50 text-amber-700",
  "C (5%)": "bg-red-50 text-red-700",
};

export default function SegmentacionPage() {
  const [cliData, setCliData] = useState<ClientesData | null>(null);
  const [provData, setProvData] = useState<ProveedoresData | null>(null);
  const [catCatalog, setCatCatalog] = useState<CatalogRow[]>([]);
  const [secCatalog, setSecCatalog] = useState<CatalogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("clientes");
  const [catTab, setCatTab] = useState<"categorias" | "sectores">("categorias");

  useEffect(() => {
    Promise.all([
      fetchClientes(),
      fetchProveedores(),
      fetchCatalogoCategorias(),
      fetchCatalogoSectores(),
    ])
      .then(([cli, prov, cats, secs]) => {
        setCliData(cli);
        setProvData(prov);
        setCatCatalog(cats);
        setSecCatalog(secs);
      })
      .catch((e) => setError(e.message ?? "Error"))
      .finally(() => setLoading(false));
  }, []);

  // ABC groups
  const cliAbc = useMemo(() => {
    if (!cliData) return [];
    return calcAbcGroups(cliData.ranking);
  }, [cliData]);

  const provAbc = useMemo(() => {
    if (!provData) return [];
    return calcAbcGroups(provData.ranking);
  }, [provData]);

  // Heatmap data: Clasificación × TipoEntidad for clients
  const cliHeatmap = useMemo(() => {
    if (!cliData) return { rows: [] as string[], cols: [] as string[], cells: new Map<string, { monto: number; count: number }>() };
    const cells = new Map<string, { monto: number; count: number }>();
    const rowSet = new Set<string>();
    const colSet = new Set<string>();
    for (const c of cliData.ranking) {
      const row = c.clasificacion;
      const col = c.tipoEntidad;
      rowSet.add(row);
      colSet.add(col);
      const key = `${row}|${col}`;
      const existing = cells.get(key) ?? { monto: 0, count: 0 };
      existing.monto += c.facturacionTotal;
      existing.count += 1;
      cells.set(key, existing);
    }
    return { rows: Array.from(rowSet).sort(), cols: Array.from(colSet).sort(), cells };
  }, [cliData]);

  // Heatmap: CategoriaEgreso × TipoCosto for providers
  const provHeatmap = useMemo(() => {
    if (!provData) return { rows: [] as string[], cols: [] as string[], cells: new Map<string, { monto: number; count: number }>() };
    const cells = new Map<string, { monto: number; count: number }>();
    const rowSet = new Set<string>();
    const colSet = new Set<string>();
    for (const p of provData.ranking) {
      const row = p.categoriaEgreso;
      const col = p.tipoCosto;
      rowSet.add(row);
      colSet.add(col);
      const key = `${row}|${col}`;
      const existing = cells.get(key) ?? { monto: 0, count: 0 };
      existing.monto += p.montoTotal;
      existing.count += 1;
      cells.set(key, existing);
    }
    return { rows: Array.from(rowSet).sort(), cols: Array.from(colSet).sort(), cells };
  }, [provData]);

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Segmentación</h1>
          <p className="text-muted-foreground">Análisis ABC, matrices y catálogos de referencia</p>
        </div>
        <InflationToggle />
      </div>

      {/* Tabs */}
      <div className="flex gap-1">
        {(["clientes", "proveedores", "catalogos"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded px-4 py-2 text-sm font-medium transition-colors ${
              tab === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"
            }`}
          >
            {t === "clientes" ? "Clientes" : t === "proveedores" ? "Proveedores" : "Catálogos"}
          </button>
        ))}
      </div>

      {tab === "clientes" && cliData && (
        <div className="space-y-6">
          {/* Heatmap */}
          <Card>
            <CardHeader><CardTitle className="text-base">Matriz Clasificación × Tipo Entidad</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Clasificación</TableHead>
                      {cliHeatmap.cols.map((col) => (
                        <TableHead key={col} className="text-center">{col}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cliHeatmap.rows.map((row) => (
                      <TableRow key={row}>
                        <TableCell className="font-medium">{row}</TableCell>
                        {cliHeatmap.cols.map((col) => {
                          const cell = cliHeatmap.cells.get(`${row}|${col}`);
                          return (
                            <TableCell key={col} className="text-center">
                              {cell ? (
                                <div>
                                  <div className="font-medium text-sm">{formatARS(cell.monto)}</div>
                                  <div className="text-xs text-muted-foreground">{cell.count} clientes</div>
                                </div>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* ABC Analysis */}
          <Card>
            <CardHeader><CardTitle className="text-base">Análisis ABC de Clientes</CardTitle></CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-3 mb-6">
                {cliAbc.map((g) => (
                  <div key={g.label} className={`rounded-lg p-4 ${ABC_COLORS[g.label as keyof typeof ABC_COLORS] ?? "bg-gray-50"}`}>
                    <p className="font-semibold text-lg">{g.label}</p>
                    <p className="text-2xl font-bold">{g.count} clientes</p>
                    <p className="text-sm">{formatARS(g.totalMonto)} ({g.totalPct.toFixed(1)}%)</p>
                  </div>
                ))}
              </div>
              {cliAbc.map((g) => (
                <div key={g.label} className="mb-4">
                  <h4 className="font-medium text-sm mb-2">Grupo {g.label} — {g.count} clientes</h4>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Cliente</TableHead>
                          <TableHead>CUIT</TableHead>
                          <TableHead className="text-right">Facturación</TableHead>
                          <TableHead className="text-right">% Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {g.clientes.slice(0, 20).map((c) => (
                          <TableRow key={c.cuit}>
                            <TableCell className="font-medium max-w-[200px] truncate">{c.nombre}</TableCell>
                            <TableCell>{c.cuit}</TableCell>
                            <TableCell className="text-right">{formatARS(c.monto)}</TableCell>
                            <TableCell className="text-right">{c.pct.toFixed(1)}%</TableCell>
                          </TableRow>
                        ))}
                        {g.clientes.length > 20 && (
                          <TableRow>
                            <TableCell colSpan={4} className="text-center text-xs text-muted-foreground">
                              +{g.clientes.length - 20} clientes más
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "proveedores" && provData && (
        <div className="space-y-6">
          {/* Heatmap */}
          <Card>
            <CardHeader><CardTitle className="text-base">Matriz Categoría Egreso × Tipo Costo</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Categoría Egreso</TableHead>
                      {provHeatmap.cols.map((col) => (
                        <TableHead key={col} className="text-center">{col}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {provHeatmap.rows.map((row) => (
                      <TableRow key={row}>
                        <TableCell className="font-medium">{row}</TableCell>
                        {provHeatmap.cols.map((col) => {
                          const cell = provHeatmap.cells.get(`${row}|${col}`);
                          return (
                            <TableCell key={col} className="text-center">
                              {cell ? (
                                <div>
                                  <div className="font-medium text-sm">{formatARS(cell.monto)}</div>
                                  <div className="text-xs text-muted-foreground">{cell.count} proveedores</div>
                                </div>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* ABC Analysis */}
          <Card>
            <CardHeader><CardTitle className="text-base">Análisis ABC de Proveedores</CardTitle></CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-3 mb-6">
                {provAbc.map((g) => (
                  <div key={g.label} className={`rounded-lg p-4 ${ABC_COLORS[g.label as keyof typeof ABC_COLORS] ?? "bg-gray-50"}`}>
                    <p className="font-semibold text-lg">{g.label}</p>
                    <p className="text-2xl font-bold">{g.count} proveedores</p>
                    <p className="text-sm">{formatARS(g.totalMonto)} ({g.totalPct.toFixed(1)}%)</p>
                  </div>
                ))}
              </div>
              {provAbc.map((g) => (
                <div key={g.label} className="mb-4">
                  <h4 className="font-medium text-sm mb-2">Grupo {g.label} — {g.count} proveedores</h4>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Proveedor</TableHead>
                          <TableHead>CUIT</TableHead>
                          <TableHead className="text-right">Monto</TableHead>
                          <TableHead className="text-right">% Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {g.clientes.slice(0, 20).map((p) => (
                          <TableRow key={p.cuit}>
                            <TableCell className="font-medium max-w-[200px] truncate">{p.nombre}</TableCell>
                            <TableCell>{p.cuit}</TableCell>
                            <TableCell className="text-right">{formatARS(p.monto)}</TableCell>
                            <TableCell className="text-right">{p.pct.toFixed(1)}%</TableCell>
                          </TableRow>
                        ))}
                        {g.clientes.length > 20 && (
                          <TableRow>
                            <TableCell colSpan={4} className="text-center text-xs text-muted-foreground">
                              +{g.clientes.length - 20} proveedores más
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "catalogos" && (
        <div className="space-y-6">
          <div className="flex gap-1">
            {(["categorias", "sectores"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setCatTab(t)}
                className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                  catTab === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"
                }`}
              >
                {t === "categorias" ? "Categorías de Egreso" : "Sectores de Clientes"}
              </button>
            ))}
          </div>

          {catTab === "categorias" && (
            <Card>
              <CardHeader><CardTitle className="text-base">Categorías de Egreso ({catCatalog.length})</CardTitle></CardHeader>
              <CardContent>
                {catCatalog.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nombre</TableHead>
                        <TableHead>Tipo Costo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {catCatalog.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell className="font-medium">{c.nombre}</TableCell>
                          <TableCell>
                            <span className={`rounded px-2 py-0.5 text-xs font-medium ${
                              c.extra === "fijo" ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700"
                            }`}>
                              {c.extra ?? "—"}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">Sin datos — carga manual pendiente</p>
                )}
              </CardContent>
            </Card>
          )}

          {catTab === "sectores" && (
            <Card>
              <CardHeader><CardTitle className="text-base">Sectores de Clientes ({secCatalog.length})</CardTitle></CardHeader>
              <CardContent>
                {secCatalog.length > 0 ? (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {secCatalog.map((s) => (
                      <div key={s.id} className="rounded border px-3 py-2 text-sm">{s.nombre}</div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">Sin datos — carga manual pendiente</p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
