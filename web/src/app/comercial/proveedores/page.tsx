"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  Users,
  DollarSign,
  Target,
  ArrowLeft,
  Loader2,
  AlertCircle,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  type ProveedoresData,
  type ProveedorDetalle,
  fetchProveedores,
  fetchProveedorDetalle,
  formatARS,
  formatPct,
  pctDelta,
  periodoLabel,
  shortLabel,
} from "@/lib/commercial-queries";
import { InflationToggle, useInflation } from "@/lib/inflation";
import type {
  Formatter, ValueType, NameType,
} from "recharts/types/component/DefaultTooltipContent";

const arsTooltip: Formatter<ValueType, NameType> = (v) => formatARS(Number(v ?? 0));

const PIE_COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1"];
const CAT_COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1", "#14b8a6", "#e11d48", "#a855f7", "#0ea5e9"];

function KpiCard({ title, value, delta, icon: Icon }: { title: string; value: string; delta?: string | null; icon: React.ElementType }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {delta && (
          <p className={`text-xs ${delta.startsWith("-") ? "text-green-600" : "text-red-600"}`}>
            {delta} vs período anterior
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function ProveedoresPage() {
  const [raw, setRaw] = useState<ProveedoresData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCuit, setSelectedCuit] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<ProveedorDetalle | null>(null);
  const [detalleLoading, setDetalleLoading] = useState(false);
  const { adjust } = useInflation();

  useEffect(() => {
    fetchProveedores()
      .then(setRaw)
      .catch((e) => setError(e.message ?? "Error"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedCuit) { setDetalle(null); return; }
    setDetalleLoading(true);
    fetchProveedorDetalle(selectedCuit)
      .then(setDetalle)
      .catch(() => setDetalle(null))
      .finally(() => setDetalleLoading(false));
  }, [selectedCuit]);

  const mensual = useMemo(() => {
    if (!raw) return [];
    return raw.mensual.map((m) => {
      const adjCat: Record<string, number> = {};
      for (const [k, v] of Object.entries(m.porCategoria)) {
        adjCat[k] = adjust(v, m.periodo);
      }
      return { ...m, monto: adjust(m.monto, m.periodo), porCategoria: adjCat };
    });
  }, [raw, adjust]);

  // All categories for stacked chart
  const allCats = useMemo(() => {
    const totals = new Map<string, number>();
    for (const m of mensual) {
      for (const [k, v] of Object.entries(m.porCategoria)) {
        totals.set(k, (totals.get(k) ?? 0) + v);
      }
    }
    return Array.from(totals.entries()).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  }, [mensual]);

  const chartMonthly = useMemo(() => {
    return mensual.slice(-24).map((m) => {
      const flat: Record<string, string | number> = { label: shortLabel(m.periodo), cantProveedores: m.cantProveedores };
      for (const cat of allCats) flat[cat] = m.porCategoria[cat] ?? 0;
      return flat;
    });
  }, [mensual, allCats]);

  const top20 = useMemo(() => {
    if (!raw) return [];
    return raw.ranking.slice(0, 20).map((p) => ({
      nombre: p.nombre.length > 30 ? p.nombre.slice(0, 28) + "…" : p.nombre,
      monto: p.montoTotal,
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
  if (error || !raw) {
    return (
      <Card><CardContent className="flex items-center gap-3 py-8">
        <AlertCircle className="h-5 w-5 text-red-500" /><p className="text-sm">{error ?? "Error"}</p>
      </CardContent></Card>
    );
  }
  if (raw.ranking.length === 0) {
    return (
      <Card><CardContent className="py-8 text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-3 font-medium">Sin datos de proveedores</p>
        <p className="text-sm text-muted-foreground">Importá facturas recibidas para ver el análisis.</p>
      </CardContent></Card>
    );
  }

  // Detail view
  if (selectedCuit) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <button onClick={() => setSelectedCuit(null)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" /> Volver al listado
          </button>
          <InflationToggle />
        </div>
        {detalleLoading ? (
          <div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
        ) : detalle ? (
          <>
            <Card>
              <CardHeader><CardTitle>{detalle.nombre}</CardTitle></CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div><p className="text-sm text-muted-foreground">CUIT</p><p className="font-medium">{detalle.cuit}</p></div>
                  <div><p className="text-sm text-muted-foreground">Tipo Costo</p><p className="font-medium">{detalle.tipoCosto}</p></div>
                  <div><p className="text-sm text-muted-foreground">Categoría Egreso</p><p className="font-medium">{detalle.categoriaEgreso}</p></div>
                  <div><p className="text-sm text-muted-foreground">Frecuencia</p><p className="font-medium">{detalle.frecuenciaDias ? `Cada ${detalle.frecuenciaDias} días` : "—"}</p></div>
                </div>
              </CardContent>
            </Card>
            {detalle.mensual.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-base">Evolución de Compras</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={detalle.mensual.map((m) => ({ label: shortLabel(m.periodo), monto: adjust(m.monto, m.periodo) }))}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="label" fontSize={12} />
                      <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                      <Tooltip formatter={arsTooltip} />
                      <Bar dataKey="monto" name="Compras" fill="#ef4444" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}
            <Card>
              <CardHeader><CardTitle className="text-base">Historial Mensual</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Período</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                    <TableHead className="text-right">Facturas</TableHead>
                    <TableHead className="text-right">Prom. Factura</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {[...detalle.mensual].reverse().map((m) => (
                      <TableRow key={m.periodo}>
                        <TableCell className="font-medium">{periodoLabel(m.periodo)}</TableCell>
                        <TableCell className="text-right">{formatARS(adjust(m.monto, m.periodo))}</TableCell>
                        <TableCell className="text-right">{m.cantFacturas}</TableCell>
                        <TableCell className="text-right">{formatARS(adjust(m.promedioFactura, m.periodo))}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        ) : (
          <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Sin datos del proveedor.</CardContent></Card>
        )}
      </div>
    );
  }

  // Main view KPIs
  const totalCompras = raw.ranking.reduce((s, p) => s + p.montoTotal, 0);
  const cantProv = raw.ranking.length;
  const compraProm = cantProv > 0 ? totalCompras / cantProv : 0;
  const last12 = mensual.slice(-12);
  const prev12 = mensual.slice(-24, -12);
  const total12 = last12.reduce((s, m) => s + m.monto, 0);
  const totalPrev12 = prev12.reduce((s, m) => s + m.monto, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Proveedores</h1>
          <p className="text-muted-foreground">Análisis de proveedores, concentración y categorización</p>
        </div>
        <InflationToggle />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Proveedores Activos" value={String(cantProv)} icon={Users} />
        <KpiCard title="Total Compras 12m" value={formatARS(total12)} delta={totalPrev12 > 0 ? formatPct(pctDelta(total12, totalPrev12)) : null} icon={DollarSign} />
        <KpiCard title="Compra Prom." value={formatARS(compraProm)} icon={DollarSign} />
        <KpiCard title="Concentración Top 10" value={`${raw.concentracionTop10.toFixed(1)}%`} icon={Target} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Top 20 Proveedores por Monto</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={Math.max(400, top20.length * 28)}>
              <BarChart data={top20} layout="vertical" margin={{ left: 120 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis type="number" fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                <YAxis type="category" dataKey="nombre" fontSize={11} width={120} />
                <Tooltip formatter={arsTooltip} />
                <Bar dataKey="monto" name="Compras" fill="#ef4444" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Por Tipo de Costo</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={raw.porTipoCosto} cx="50%" cy="50%" innerRadius={55} outerRadius={100} dataKey="value" nameKey="name"
                  label={({ name, percent }) => `${String(name).slice(0, 18)} ${((percent ?? 0) * 100).toFixed(0)}%`} labelLine={false} fontSize={10}>
                  {raw.porTipoCosto.map((_, i) => (<Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />))}
                </Pie>
                <Tooltip formatter={arsTooltip} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Por Categoría de Egreso</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={raw.porCategoriaEgreso.slice(0, 10)} cx="50%" cy="50%" innerRadius={55} outerRadius={100} dataKey="value" nameKey="name"
                  label={({ name, percent }) => `${String(name).slice(0, 12)} ${((percent ?? 0) * 100).toFixed(0)}%`} labelLine={false} fontSize={10}>
                  {raw.porCategoriaEgreso.slice(0, 10).map((_, i) => (<Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />))}
                </Pie>
                <Tooltip formatter={arsTooltip} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Monthly by category stacked */}
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Compras Mensuales por Categoría</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={chartMonthly}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                <Tooltip formatter={arsTooltip} />
                <Legend />
                {allCats.slice(0, 10).map((cat, i) => (
                  <Bar key={cat} dataKey={cat} name={cat} stackId="a" fill={CAT_COLORS[i % CAT_COLORS.length]}
                    radius={i === Math.min(allCats.length, 10) - 1 ? [4, 4, 0, 0] : undefined} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Concentración</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={raw.concentracionDonut} cx="50%" cy="50%" innerRadius={55} outerRadius={100} dataKey="value" nameKey="name"
                  label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`} labelLine={false} fontSize={11}>
                  {raw.concentracionDonut.map((_, i) => (<Cell key={i} fill={PIE_COLORS[i]} />))}
                </Pie>
                <Tooltip formatter={arsTooltip} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Proveedores Activos por Mes</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={chartMonthly}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip />
                <Line type="monotone" dataKey="cantProveedores" name="Proveedores" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Ranking de Proveedores</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>Proveedor</TableHead>
                  <TableHead>CUIT</TableHead>
                  <TableHead>Tipo Costo</TableHead>
                  <TableHead>Categoría</TableHead>
                  <TableHead className="text-right">Monto Total</TableHead>
                  <TableHead className="text-right">Facturas</TableHead>
                  <TableHead className="text-right">Compra Prom.</TableHead>
                  <TableHead className="text-right">% Total</TableHead>
                  <TableHead className="text-right">% Acum.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {raw.ranking.slice(0, 50).map((p, i) => (
                  <TableRow key={p.cuit} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedCuit(p.cuit)}>
                    <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="font-medium max-w-[200px] truncate">{p.nombre}</TableCell>
                    <TableCell className="whitespace-nowrap">{p.cuit}</TableCell>
                    <TableCell>{p.tipoCosto}</TableCell>
                    <TableCell>{p.categoriaEgreso}</TableCell>
                    <TableCell className="text-right">{formatARS(p.montoTotal)}</TableCell>
                    <TableCell className="text-right">{p.cantFacturas}</TableCell>
                    <TableCell className="text-right">{formatARS(p.compraPromedio)}</TableCell>
                    <TableCell className="text-right">{p.pctTotal.toFixed(1)}%</TableCell>
                    <TableCell className="text-right">{p.pctAcumulado.toFixed(1)}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {raw.ranking.length > 50 && (
              <p className="mt-2 text-center text-xs text-muted-foreground">Mostrando los primeros 50 de {raw.ranking.length} proveedores</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
