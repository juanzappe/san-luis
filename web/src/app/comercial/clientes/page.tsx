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
  AlertTriangle,
  ArrowLeft,
  Loader2,
  AlertCircle,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  type ClientesData,
  type ClienteDetalle,
  fetchClientes,
  fetchClienteDetalle,
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

const PIE_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#8b5cf6", "#ef4444", "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1"];

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
          <p className={`text-xs ${delta.startsWith("-") ? "text-red-600" : "text-green-600"}`}>
            {delta} vs período anterior
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function ClientesPage() {
  const [raw, setRaw] = useState<ClientesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCuit, setSelectedCuit] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<ClienteDetalle | null>(null);
  const [detalleLoading, setDetalleLoading] = useState(false);
  const { adjust } = useInflation();

  useEffect(() => {
    fetchClientes()
      .then(setRaw)
      .catch((e) => setError(e.message ?? "Error"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedCuit) { setDetalle(null); return; }
    setDetalleLoading(true);
    fetchClienteDetalle(selectedCuit)
      .then(setDetalle)
      .catch(() => setDetalle(null))
      .finally(() => setDetalleLoading(false));
  }, [selectedCuit]);

  const mensual = useMemo(() => {
    if (!raw) return [];
    return raw.mensual.map((m) => ({
      ...m,
      monto: adjust(m.monto, m.periodo),
      montoPublico: adjust(m.montoPublico, m.periodo),
      montoPrivado: adjust(m.montoPrivado, m.periodo),
    }));
  }, [raw, adjust]);

  const chartMonthly = useMemo(
    () => mensual.slice(-24).map((m) => ({ label: shortLabel(m.periodo), ...m })),
    [mensual],
  );

  const top20 = useMemo(() => {
    if (!raw) return [];
    return raw.ranking.slice(0, 20).map((c) => ({
      nombre: c.nombre.length > 30 ? c.nombre.slice(0, 28) + "…" : c.nombre,
      monto: c.facturacionTotal,
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
        <p className="mt-3 font-medium">Sin datos de clientes</p>
        <p className="text-sm text-muted-foreground">Importá facturas emitidas para ver el análisis.</p>
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
                  <div><p className="text-sm text-muted-foreground">Tipo Entidad</p><p className="font-medium">{detalle.tipoEntidad}</p></div>
                  <div><p className="text-sm text-muted-foreground">Clasificación</p><p className="font-medium">{detalle.clasificacion}</p></div>
                  <div><p className="text-sm text-muted-foreground">Frecuencia</p><p className="font-medium">{detalle.frecuenciaDias ? `Cada ${detalle.frecuenciaDias} días` : "—"}</p></div>
                </div>
              </CardContent>
            </Card>
            {detalle.mensual.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-base">Evolución de Facturación</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={detalle.mensual.map((m) => ({ label: shortLabel(m.periodo), monto: adjust(m.monto, m.periodo) }))}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="label" fontSize={12} />
                      <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                      <Tooltip formatter={arsTooltip} />
                      <Bar dataKey="monto" name="Facturación" fill="#3b82f6" radius={[4, 4, 0, 0]} />
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
                    <TableHead className="text-right">Facturación</TableHead>
                    <TableHead className="text-right">Facturas</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {[...detalle.mensual].reverse().map((m) => (
                      <TableRow key={m.periodo}>
                        <TableCell className="font-medium">{periodoLabel(m.periodo)}</TableCell>
                        <TableCell className="text-right">{formatARS(adjust(m.monto, m.periodo))}</TableCell>
                        <TableCell className="text-right">{m.cantFacturas}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        ) : (
          <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Sin datos del cliente.</CardContent></Card>
        )}
      </div>
    );
  }

  // Main view
  const totalFact = raw.ranking.reduce((s, c) => s + c.facturacionTotal, 0);
  const cantClientes = raw.ranking.length;
  const ticketProm = cantClientes > 0 ? totalFact / cantClientes : 0;
  const last12 = mensual.slice(-12);
  const prev12 = mensual.slice(-24, -12);
  const total12 = last12.reduce((s, m) => s + m.monto, 0);
  const totalPrev12 = prev12.reduce((s, m) => s + m.monto, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Clientes</h1>
          <p className="text-muted-foreground">Análisis de cartera, concentración y segmentación</p>
        </div>
        <InflationToggle />
      </div>

      {raw.pctPublico > 80 && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0" />
            <p className="text-sm text-amber-800">
              <span className="font-semibold">Alta concentración en sector público:</span> {raw.pctPublico.toFixed(0)}% de la facturación depende de organismos gubernamentales
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Clientes Activos" value={String(cantClientes)} icon={Users} />
        <KpiCard title="Facturación 12m" value={formatARS(total12)} delta={totalPrev12 > 0 ? formatPct(pctDelta(total12, totalPrev12)) : null} icon={DollarSign} />
        <KpiCard title="Ticket Promedio" value={formatARS(ticketProm)} icon={DollarSign} />
        <KpiCard title="Concentración Top 10" value={`${raw.concentracionTop10.toFixed(1)}%`} icon={Target} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Top 20 Clientes por Facturación</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={Math.max(400, top20.length * 28)}>
              <BarChart data={top20} layout="vertical" margin={{ left: 120 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis type="number" fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                <YAxis type="category" dataKey="nombre" fontSize={11} width={120} />
                <Tooltip formatter={arsTooltip} />
                <Bar dataKey="monto" name="Facturación" fill="#3b82f6" radius={[0, 4, 4, 0]} />
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
          <CardHeader><CardTitle className="text-base">Por Tipo de Entidad</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={raw.porTipoEntidad} cx="50%" cy="50%" innerRadius={55} outerRadius={100} dataKey="value" nameKey="name"
                  label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`} labelLine={false} fontSize={11}>
                  {raw.porTipoEntidad.map((_, i) => (<Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />))}
                </Pie>
                <Tooltip formatter={arsTooltip} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Por Clasificación</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={raw.porClasificacion.slice(0, 8)} cx="50%" cy="50%" innerRadius={55} outerRadius={100} dataKey="value" nameKey="name"
                  label={({ name, percent }) => `${String(name).slice(0, 15)} ${((percent ?? 0) * 100).toFixed(0)}%`} labelLine={false} fontSize={10}>
                  {raw.porClasificacion.slice(0, 8).map((_, i) => (<Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />))}
                </Pie>
                <Tooltip formatter={arsTooltip} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Facturación Mensual por Tipo</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartMonthly}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                <Tooltip formatter={arsTooltip} />
                <Legend />
                <Bar dataKey="montoPublico" name="Público" stackId="a" fill="#3b82f6" />
                <Bar dataKey="montoPrivado" name="Privado" stackId="a" fill="#22c55e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Clientes Activos por Mes</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={chartMonthly}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip />
                <Line type="monotone" dataKey="cantClientes" name="Clientes" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Ranking de Clientes</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>CUIT</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Clasificación</TableHead>
                  <TableHead className="text-right">Facturación</TableHead>
                  <TableHead className="text-right">Facturas</TableHead>
                  <TableHead className="text-right">Ticket Prom.</TableHead>
                  <TableHead className="text-right">% Total</TableHead>
                  <TableHead className="text-right">% Acum.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {raw.ranking.slice(0, 50).map((c, i) => (
                  <TableRow key={c.cuit} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedCuit(c.cuit)}>
                    <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="font-medium max-w-[200px] truncate">{c.nombre}</TableCell>
                    <TableCell className="whitespace-nowrap">{c.cuit}</TableCell>
                    <TableCell>{c.tipoEntidad}</TableCell>
                    <TableCell>{c.clasificacion}</TableCell>
                    <TableCell className="text-right">{formatARS(c.facturacionTotal)}</TableCell>
                    <TableCell className="text-right">{c.cantFacturas}</TableCell>
                    <TableCell className="text-right">{formatARS(c.ticketPromedio)}</TableCell>
                    <TableCell className="text-right">{c.pctTotal.toFixed(1)}%</TableCell>
                    <TableCell className="text-right">{c.pctAcumulado.toFixed(1)}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {raw.ranking.length > 50 && (
              <p className="mt-2 text-center text-xs text-muted-foreground">Mostrando los primeros 50 de {raw.ranking.length} clientes</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
