"use client";

import { useEffect, useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";
import {
  Landmark, Building2, CreditCard, Wallet, Loader2, AlertCircle,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  type SaldoCuenta,
  type InversionRow,
  type EvolucionSaldoRow,
  fetchSaldosCuentas,
  fetchInversionesActuales,
  fetchEvolucionSaldos,
  formatARS,
  shortLabel,
} from "@/lib/financial-queries";
import type {
  Formatter, ValueType, NameType,
} from "recharts/types/component/DefaultTooltipContent";

const arsTooltip: Formatter<ValueType, NameType> = (v) => formatARS(Number(v ?? 0));

function formatFecha(iso: string | null): string {
  if (!iso) return "Sin datos";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function formatUSD(n: number): string {
  return n.toLocaleString("es-AR", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

const BANCO_COLORS: Record<string, string> = {
  provincia: "#3b82f6",
  santander: "#ef4444",
};

export default function TesoreriaPage() {
  const [saldos, setSaldos] = useState<SaldoCuenta[]>([]);
  const [inversiones, setInversiones] = useState<InversionRow[]>([]);
  const [evolucion, setEvolucion] = useState<EvolucionSaldoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetchSaldosCuentas(),
      fetchInversionesActuales(),
      fetchEvolucionSaldos(12),
    ])
      .then(([sc, inv, evo]) => {
        setSaldos(sc);
        setInversiones(inv);
        setEvolucion(evo);
      })
      .catch((e) => setError(e.message ?? "Error"))
      .finally(() => setLoading(false));
  }, []);

  const provincia = saldos.find((s) => s.cuenta === "provincia");
  const santander = saldos.find((s) => s.cuenta === "santander");
  const mp = saldos.find((s) => s.cuenta === "mercado_pago");

  const disponible = (provincia?.saldoArs ?? 0) + (santander?.saldoArs ?? 0) + (mp?.saldoArs ?? 0);
  const totalInversiones = inversiones.reduce((s, i) => s + i.valuacionMonto, 0);
  const totalInversionesUsd = inversiones.reduce((s, i) => s + i.valuacionUsd, 0);
  const posicionTotal = disponible + totalInversiones;
  const fechaInversiones = inversiones[0]?.fechaValuacion ?? null;

  // Pivot evolution data for line chart: { periodo, provincia, santander }
  const chartData = useMemo(() => {
    const map = new Map<string, { periodo: string; label: string; provincia: number; santander: number }>();
    for (const row of evolucion) {
      if (!map.has(row.periodo)) {
        map.set(row.periodo, { periodo: row.periodo, label: shortLabel(row.periodo), provincia: 0, santander: 0 });
      }
      const entry = map.get(row.periodo)!;
      if (row.banco === "provincia") entry.provincia = row.saldo;
      if (row.banco === "santander") entry.santander = row.saldo;
    }
    return Array.from(map.values()).sort((a, b) => a.periodo.localeCompare(b.periodo));
  }, [evolucion]);

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-2 text-muted-foreground">
        <AlertCircle className="h-8 w-8" />
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Posición de Tesorería</h1>
        <p className="text-muted-foreground">Saldos actuales, inversiones y evolución bancaria</p>
      </div>

      {/* Row 1: Saldo cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Banco Provincia</CardTitle>
            <Landmark className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-600">{formatARS(provincia?.saldoArs ?? 0)}</div>
            <p className="text-xs text-muted-foreground">{formatFecha(provincia?.fechaDato ?? null)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Banco Santander</CardTitle>
            <Building2 className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-600">{formatARS(santander?.saldoArs ?? 0)}</div>
            <p className="text-xs text-muted-foreground">{formatFecha(santander?.fechaDato ?? null)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Mercado Pago</CardTitle>
            <CreditCard className="h-4 w-4 text-cyan-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-cyan-600">{formatARS(mp?.saldoArs ?? 0)}</div>
            <p className="text-xs text-muted-foreground">{formatFecha(mp?.fechaDato ?? null)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Disponible</CardTitle>
            <Wallet className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600">{formatARS(disponible)}</div>
            <p className="text-xs text-muted-foreground">Bancos + Mercado Pago</p>
          </CardContent>
        </Card>
      </div>

      {/* Row 2: Inversiones table */}
      {inversiones.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cartera de Inversiones</CardTitle>
            {fechaInversiones && (
              <p className="text-sm text-muted-foreground">Valuación al {formatFecha(fechaInversiones)}</p>
            )}
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Ticker</TableHead>
                    <TableHead>Moneda</TableHead>
                    <TableHead className="text-right">Disponibles</TableHead>
                    <TableHead className="text-right">Valuación ARS</TableHead>
                    <TableHead className="text-right">Valuación USD</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inversiones.map((inv, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{inv.nombre}</TableCell>
                      <TableCell>{inv.ticker ?? "—"}</TableCell>
                      <TableCell>{inv.moneda}</TableCell>
                      <TableCell className="text-right">{inv.disponibles.toLocaleString("es-AR", { maximumFractionDigits: 4 })}</TableCell>
                      <TableCell className="text-right">{formatARS(inv.valuacionMonto)}</TableCell>
                      <TableCell className="text-right">{formatUSD(inv.valuacionUsd)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-bold border-t-2">
                    <TableCell colSpan={4}>Total</TableCell>
                    <TableCell className="text-right">{formatARS(totalInversiones)}</TableCell>
                    <TableCell className="text-right">{formatUSD(totalInversionesUsd)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Row 3: Posición Total */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Posición Total</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <p className="text-sm text-muted-foreground">Disponible en cuentas</p>
              <p className="text-2xl font-bold">{formatARS(disponible)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Inversiones</p>
              <p className="text-2xl font-bold">{formatARS(totalInversiones)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Posición total</p>
              <p className="text-2xl font-bold text-green-600">{formatARS(posicionTotal)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Row 4: Evolución de saldos chart */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Evolución de Saldos Bancarios (últimos 12 meses)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={400}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                <Tooltip formatter={arsTooltip} />
                <Legend />
                <Line type="monotone" dataKey="provincia" name="Bco. Provincia" stroke={BANCO_COLORS.provincia} strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="santander" name="Bco. Santander" stroke={BANCO_COLORS.santander} strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
