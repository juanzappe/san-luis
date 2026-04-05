"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { Loader2 } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EgresoDetailPage } from "@/components/egreso-detail-page";
import type { EgresoRow, ResultadoRow } from "@/lib/economic-queries";
import { formatARS, shortLabel } from "@/lib/economic-queries";
import { useInflation } from "@/lib/inflation";
import type { ResumenMensualRow } from "@/lib/tax-queries";
import { fetchPosicionIva, computeGastosComerciales, getCuotaFija, type IvaMensualRow } from "@/lib/tax-queries";
import type {
  Formatter, ValueType, NameType,
} from "recharts/types/component/DefaultTooltipContent";

const arsTooltip: Formatter<ValueType, NameType> = (v) => formatARS(Number(v ?? 0));

const COLORS: Record<string, string> = {
  "Ingresos Brutos": "#ef4444",
  "Seg. e Higiene": "#f59e0b",
  "Publicidad": "#06b6d4",
  "Ocupación Esp. Público": "#ec4899",
};

// extractValue and extractBreakdown are defined inside the component
// so they can access useInflation().adjust via closure.

// ---------------------------------------------------------------------------
// Posición IVA Section (informational, separate from Gastos Comerciales total)
// ---------------------------------------------------------------------------

function PosicionIvaSection() {
  const [ivaData, setIvaData] = useState<IvaMensualRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPosicionIva()
      .then(setIvaData)
      .catch(() => setIvaData([]))
      .finally(() => setLoading(false));
  }, []);

  const last = ivaData.length > 0 ? ivaData[ivaData.length - 1] : null;

  const chartData = useMemo(
    () =>
      ivaData.slice(-12).map((r) => ({
        label: shortLabel(r.periodo),
        "Débito Fiscal": r.totalDebito,
        "Crédito Fiscal": r.totalCredito,
      })),
    [ivaData],
  );

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">Cargando posición IVA...</span>
        </CardContent>
      </Card>
    );
  }

  if (ivaData.length === 0) return null;

  return (
    <>
      {/* Visual separator */}
      <div className="border-t pt-6">
        <h2 className="text-xl font-semibold tracking-tight mb-1">Posición IVA</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Informativo — no suma al total de Gastos Comerciales
        </p>
      </div>

      {/* IVA KPI Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">IVA Débito Fiscal</CardTitle>
            <span className="h-3 w-3 rounded-full bg-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatARS(last?.totalDebito ?? 0)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">IVA Crédito Fiscal</CardTitle>
            <span className="h-3 w-3 rounded-full bg-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatARS(last?.totalCredito ?? 0)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Saldo IVA</CardTitle>
            <span className="h-3 w-3 rounded-full bg-blue-500" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${(last?.posicionNeta ?? 0) > 0 ? "text-red-600" : "text-green-600"}`}>
              {formatARS(last?.posicionNeta ?? 0)}
            </div>
            <p className="text-xs text-muted-foreground">
              {(last?.posicionNeta ?? 0) > 0 ? "Saldo a pagar" : "Saldo a favor"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* IVA Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">IVA Débito vs Crédito — últimos 12 meses</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="label" fontSize={12} />
              <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
              <Tooltip formatter={arsTooltip} />
              <Legend />
              <Bar dataKey="Débito Fiscal" fill="#ef4444" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Crédito Fiscal" fill="#22c55e" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export default function GastosComercialesPage() {
  const { adjust } = useInflation();

  const extractValue = useCallback(
    (_r: EgresoRow, _tax?: ResumenMensualRow, resultado?: ResultadoRow): number => {
      const ingresos = resultado?.ingresos ?? 0;
      const periodo = resultado?.periodo ?? _r.periodo;
      return adjust(computeGastosComerciales(ingresos, periodo), periodo);
    },
    [adjust],
  );

  const extractBreakdown = useCallback(
    (_r: EgresoRow, _tax?: ResumenMensualRow, resultado?: ResultadoRow): Record<string, number> => {
      const ingresos = resultado?.ingresos ?? 0;
      const periodo = resultado?.periodo ?? _r.periodo;
      const bd: Record<string, number> = {};
      const iibb = adjust(ingresos * 0.045, periodo);
      const segHig = adjust(ingresos * 0.01, periodo);
      const pub = adjust(getCuotaFija('publicidad', periodo), periodo);
      const esp = adjust(getCuotaFija('espacioPublico', periodo), periodo);
      if (iibb > 0) bd["Ingresos Brutos"] = iibb;
      if (segHig > 0) bd["Seg. e Higiene"] = segHig;
      if (pub > 0) bd["Publicidad"] = pub;
      if (esp > 0) bd["Ocupación Esp. Público"] = esp;
      return bd;
    },
    [adjust],
  );

  return (
    <EgresoDetailPage
      title="Gastos Comerciales"
      subtitle="IIBB, Tasa Seg. e Higiene y tasas municipales — sin IVA ni Imp. al Cheque"
      extractValue={extractValue}
      extractBreakdown={extractBreakdown}
      breakdownColors={COLORS}
    >
      <PosicionIvaSection />
    </EgresoDetailPage>
  );
}
