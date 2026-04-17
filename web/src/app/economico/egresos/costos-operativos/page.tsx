"use client";

import { useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { EgresoDetailPage } from "@/components/egreso-detail-page";
import { Callout } from "@/components/callout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useInflation } from "@/lib/inflation";
import {
  type EgresoRow,
  COMERCIALES_PROVEEDOR_CATS,
  formatARS,
  shortLabel,
} from "@/lib/economic-queries";
import { useEgresosData } from "@/lib/use-egresos-data";
import type {
  Formatter, ValueType, NameType,
} from "recharts/types/component/DefaultTooltipContent";

const arsTooltip: Formatter<ValueType, NameType> = (v) => formatARS(Number(v ?? 0));

const COLORS = ["#f59e0b", "#ef4444", "#8b5cf6", "#3b82f6", "#ec4899", "#22c55e", "#06b6d4"];

const isComercialCat = (cat: string) =>
  (COMERCIALES_PROVEEDOR_CATS as readonly string[]).includes(cat);

/** Filtra categorías que van a Gastos Comerciales (Honorarios/Seguros/Telefonía). */
function filterOperativoCategorias(categorias: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(categorias)) {
    if (!isComercialCat(k)) out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Chart: Evolución de las top 5 categorías + resto
// ---------------------------------------------------------------------------
function EvolucionCategoriasChart({ data }: { data: EgresoRow[] }) {
  const { adjust } = useInflation();
  const { topKeys, chartData } = useMemo(() => {
    // Identificar top 5 categorías por monto total (excluyendo las que pasan a Comerciales)
    const totals = new Map<string, number>();
    for (const r of data) {
      for (const [cat, monto] of Object.entries(r.categorias)) {
        if (isComercialCat(cat)) continue;
        totals.set(cat, (totals.get(cat) ?? 0) + monto);
      }
    }
    const top = Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name]) => name);

    // Armar serie temporal
    const rows = data.slice(-24).map((r) => {
      const row: Record<string, string | number> = { label: shortLabel(r.periodo) };
      let resto = 0;
      for (const [cat, monto] of Object.entries(r.categorias)) {
        if (isComercialCat(cat)) continue;
        const adj = adjust(monto, r.periodo);
        if (top.includes(cat)) {
          row[cat] = adj;
        } else {
          resto += adj;
        }
      }
      row["Resto"] = resto;
      return row;
    });

    return { topKeys: [...top, "Resto"], chartData: rows };
  }, [data, adjust]);

  if (chartData.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Evolución de Categorías Principales</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={360}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="label" fontSize={12} />
            <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
            <Tooltip formatter={arsTooltip} />
            <Legend />
            {topKeys.map((k, i) => (
              <Line
                key={k}
                type="monotone"
                dataKey={k}
                stroke={COLORS[i % COLORS.length]}
                strokeWidth={k === "Resto" ? 1.5 : 2}
                strokeDasharray={k === "Resto" ? "4 4" : undefined}
                dot={{ r: 2 }}
                connectNulls={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
        <p className="mt-2 text-xs text-muted-foreground">
          Top 5 categorías de proveedores por monto histórico + &ldquo;Resto&rdquo;. En el line chart se lee mejor la evolución relativa que en la tabla.
        </p>
      </CardContent>
    </Card>
  );
}

function CostosOperativosExtras() {
  const { data } = useEgresosData();
  return <EvolucionCategoriasChart data={data} />;
}

export default function CostosOperativosPage() {
  return (
    <EgresoDetailPage
      title="Costos Operativos"
      subtitle="Proveedores por categoría — neto gravado sin IVA"
      callout={
        <Callout>
          <p>
            Facturas recibidas (proveedores) agrupadas por la categoría configurada en cada
            proveedor. <strong>Insumos</strong> se desglosa internamente en Alimentos /
            Bebidas / Papelería / Otros mediante la subcategoría (editable manualmente en
            la base).
          </p>
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
            <li>
              Notas de crédito se <strong className="text-foreground">restan</strong> (tipo_comprobante 3, 8, 203).
            </li>
            <li>
              Excluye <strong>Honorarios, Seguros y Telefonía</strong>: esas categorías se contabilizan
              en <strong>Gastos Comerciales</strong> junto a los impuestos.
            </li>
            <li>
              Sueldos, impuestos y movimientos bancarios tampoco entran acá — están en las otras
              subsecciones de Egresos.
            </li>
          </ul>
        </Callout>
      }
      extractValue={(r: EgresoRow) =>
        Object.entries(r.categorias)
          .filter(([cat]) => !isComercialCat(cat))
          .reduce((a, [, v]) => a + v, 0)
      }
      extractBreakdown={(r: EgresoRow) => filterOperativoCategorias(r.categorias)}
    >
      <CostosOperativosExtras />
    </EgresoDetailPage>
  );
}
