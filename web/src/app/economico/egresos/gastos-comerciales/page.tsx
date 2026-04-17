"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { Loader2 } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Callout } from "@/components/callout";
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
  "Imp. al Cheque": "#8b5cf6",
  "Honorarios": "#22c55e",
  "Seguros": "#14b8a6",
  "Telefonía": "#a855f7",
  "Servicios públicos": "#0ea5e9",
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

  // Saldo IVA acumulado: últimos 24 meses, acumulando posicionNeta mes a mes.
  // Positivo = saldo a pagar acumulado; negativo = saldo a favor.
  const saldoAcumuladoData = useMemo(() => {
    const slice = ivaData.slice(-24);
    let acumulado = 0;
    return slice.map((r) => {
      acumulado += r.posicionNeta;
      return {
        label: shortLabel(r.periodo),
        mensual: r.posicionNeta,
        acumulado,
      };
    });
  }, [ivaData]);

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

      {/* Saldo IVA acumulado */}
      {saldoAcumuladoData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Saldo IVA Acumulado</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={saldoAcumuladoData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                <Tooltip formatter={arsTooltip} />
                <ReferenceLine y={0} stroke="#666" />
                <Legend />
                <Line type="monotone" dataKey="mensual" name="Saldo del mes" stroke="#94a3b8" strokeWidth={1.5} dot={{ r: 2 }} strokeDasharray="3 3" />
                <Line type="monotone" dataKey="acumulado" name="Saldo acumulado" stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
            <p className="mt-2 text-xs text-muted-foreground">
              Posición neta de IVA acumulada mes a mes (positivo = saldo a pagar; negativo = saldo a favor). Si crece sin cesar el saldo a favor, hay problema de flujo (estás financiando al fisco). Si se va arriba de cero de forma persistente, revisar crédito fiscal no aprovechado.
            </p>
          </CardContent>
        </Card>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export default function GastosComercialesPage() {
  const { adjust } = useInflation();

  const extractValue = useCallback(
    (r: EgresoRow, tax?: ResumenMensualRow, resultado?: ResultadoRow): number => {
      const ingresos = resultado?.ingresos ?? 0;
      const periodo = resultado?.periodo ?? r.periodo;
      const cheque = tax?.cheque ?? 0;
      const devengado = adjust(computeGastosComerciales(ingresos, periodo) + cheque, periodo);
      // Proveedor-based cats ya ajustados por inflación en r.categorias.
      const honorarios = r.categorias["Honorarios"] ?? 0;
      const seguros = r.categorias["Seguros"] ?? 0;
      const telefonia = r.categorias["Telefonía"] ?? 0;
      const sp = r.categorias["Servicios públicos"] ?? 0;
      return devengado + honorarios + seguros + telefonia + sp;
    },
    [adjust],
  );

  const extractBreakdown = useCallback(
    (r: EgresoRow, tax?: ResumenMensualRow, resultado?: ResultadoRow): Record<string, number> => {
      const ingresos = resultado?.ingresos ?? 0;
      const periodo = resultado?.periodo ?? r.periodo;
      const bd: Record<string, number> = {};
      const iibb = adjust(ingresos * 0.045, periodo);
      const segHig = adjust(ingresos * 0.01, periodo);
      const pub = adjust(getCuotaFija('publicidad', periodo), periodo);
      const esp = adjust(getCuotaFija('espacioPublico', periodo), periodo);
      const cheque = adjust(tax?.cheque ?? 0, periodo);
      const honorarios = r.categorias["Honorarios"] ?? 0;
      const seguros = r.categorias["Seguros"] ?? 0;
      const telefonia = r.categorias["Telefonía"] ?? 0;
      const sp = r.categorias["Servicios públicos"] ?? 0;
      if (iibb > 0) bd["Ingresos Brutos"] = iibb;
      if (segHig > 0) bd["Seg. e Higiene"] = segHig;
      if (pub > 0) bd["Publicidad"] = pub;
      if (esp > 0) bd["Ocupación Esp. Público"] = esp;
      if (cheque > 0) bd["Imp. al Cheque"] = cheque;
      if (honorarios > 0) bd["Honorarios"] = honorarios;
      if (seguros > 0) bd["Seguros"] = seguros;
      if (telefonia > 0) bd["Telefonía"] = telefonia;
      if (sp > 0) bd["Servicios públicos"] = sp;
      return bd;
    },
    [adjust],
  );

  return (
    <EgresoDetailPage
      title="Gastos Comerciales"
      subtitle="Impuestos devengados + Honorarios, Seguros y Telefonía"
      callout={
        <Callout>
          <p>
            Gastos comerciales e impositivos <strong>devengados</strong> — se estiman cada mes en base a los
            ingresos y cuotas fijas municipales, sin esperar la liquidación de la boleta.
          </p>
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
            <li>
              <strong className="text-foreground">Ingresos Brutos</strong>: 4,5 % de los ingresos netos del mes.
            </li>
            <li>
              <strong className="text-foreground">Seg. e Higiene</strong>: 1 % de los ingresos netos.
            </li>
            <li>
              <strong className="text-foreground">Publicidad y Espacio Público</strong>: cuotas fijas municipales
              actualizadas por año.
            </li>
            <li>
              <strong className="text-foreground">Imp. al Cheque</strong> (LEY 25.413): débitos y créditos
              bancarios. Se incluye acá por ser un impuesto nacional (antes estaba en Gastos Financieros).
            </li>
            <li>
              <strong className="text-foreground">Honorarios</strong>: facturas del estudio contable (Zambernardi).
            </li>
            <li>
              <strong className="text-foreground">Seguros</strong>: pólizas (Federación Patronal y demás
              proveedores clasificados como &ldquo;Seguros&rdquo;).
            </li>
            <li>
              <strong className="text-foreground">Telefonía</strong>: Telecom, Telefónica y otras líneas.
            </li>
            <li>
              No incluye <strong>IVA</strong> — es neutral (sale por la sección Posición IVA abajo).
            </li>
          </ul>
        </Callout>
      }
      extractValue={extractValue}
      extractBreakdown={extractBreakdown}
      breakdownColors={COLORS}
    >
      <PosicionIvaSection />
    </EgresoDetailPage>
  );
}
