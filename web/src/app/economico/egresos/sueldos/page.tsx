"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { EgresoDetailPage } from "@/components/egreso-detail-page";
import { Callout } from "@/components/callout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useInflation } from "@/lib/inflation";
import {
  type EgresoRow,
  formatARS,
  shortLabel,
} from "@/lib/economic-queries";
import { useEgresosData } from "@/lib/use-egresos-data";
import { supabase } from "@/lib/supabase";
import type {
  Formatter, ValueType, NameType,
} from "recharts/types/component/DefaultTooltipContent";

const COLORS: Record<string, string> = {
  "Sueldos Neto": "#6366f1",
  "Cargas Sociales": "#a855f7",
};

// ---------------------------------------------------------------------------
// Composición del Costo Laboral — de cada peso de costo laboral, qué % va al
// empleado (neto) y qué % al Estado (cargas).
// ---------------------------------------------------------------------------
function ComposicionCostoLaboralChart({ data }: { data: EgresoRow[] }) {
  const chartData = useMemo(
    () =>
      data.slice(-24).map((r) => {
        const total = r.sueldosNeto + r.cargasSociales;
        return {
          label: shortLabel(r.periodo),
          "Al empleado (Neto)": total > 0 ? (r.sueldosNeto / total) * 100 : 0,
          "Al Estado (Cargas)": total > 0 ? (r.cargasSociales / total) * 100 : 0,
        };
      }),
    [data],
  );
  if (chartData.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Composición del Costo Laboral</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="label" fontSize={12} />
            <YAxis fontSize={12} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
            <Tooltip formatter={((v: ValueType | undefined) => `${Number(v ?? 0).toFixed(1)}%`) as Formatter<ValueType, NameType>} />
            <Legend />
            <Bar dataKey="Al empleado (Neto)" stackId="a" fill="#6366f1" />
            <Bar dataKey="Al Estado (Cargas)" stackId="a" fill="#a855f7" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
        <p className="mt-2 text-xs text-muted-foreground">
          De cada peso que cuesta el personal, qué porción va efectivamente al bolsillo del empleado vs al Estado (cargas patronales F.931). Típicamente el neto es ~75-78% y las cargas ~22-25%; se mueve con paritarias y cambios en alícuotas AFIP.
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Costo promedio por empleado — usa liquidacion_sueldo para headcount
// ---------------------------------------------------------------------------
function CostoPorEmpleadoChart({ data }: { data: EgresoRow[] }) {
  const { adjust } = useInflation();
  const [headcountByPeriodo, setHeadcountByPeriodo] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    (async () => {
      const { data: rows, error } = await supabase
        .from("liquidacion_sueldo")
        .select("periodo, empleado_id")
        .not("periodo", "ilike", "%SAC%"); // excluir aguinaldo
      if (error) return;
      const map = new Map<string, Set<string>>();
      for (const r of (rows ?? []) as { periodo: string; empleado_id: string }[]) {
        if (!map.has(r.periodo)) map.set(r.periodo, new Set());
        map.get(r.periodo)!.add(r.empleado_id);
      }
      const byPeriodo = new Map<string, number>();
      map.forEach((set, periodo) => byPeriodo.set(periodo, set.size));
      setHeadcountByPeriodo(byPeriodo);
    })();
  }, []);

  const chartData = useMemo(() => {
    return data
      .slice(-24)
      .map((r) => {
        const headcount = headcountByPeriodo.get(r.periodo) ?? 0;
        const costoTotal = r.sueldosNeto + r.cargasSociales;
        const costoReal = adjust(costoTotal, r.periodo);
        return {
          label: shortLabel(r.periodo),
          headcount,
          costoPorEmpleado: headcount > 0 ? costoReal / headcount : 0,
        };
      })
      .filter((r) => r.headcount > 0);
  }, [data, headcountByPeriodo, adjust]);

  if (chartData.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Costo Total por Empleado</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="label" fontSize={12} />
            <YAxis yAxisId="left" fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
            <YAxis yAxisId="right" orientation="right" fontSize={12} allowDecimals={false} />
            <Tooltip formatter={(v, name) => name === "Costo por empleado" ? formatARS(Number(v ?? 0)) : Number(v ?? 0).toLocaleString("es-AR")} />
            <Legend />
            <Bar yAxisId="left" dataKey="costoPorEmpleado" name="Costo por empleado" fill="#6366f1" radius={[4, 4, 0, 0]} />
            <Line yAxisId="right" type="monotone" dataKey="headcount" name="Empleados" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} />
          </BarChart>
        </ResponsiveContainer>
        <p className="mt-2 text-xs text-muted-foreground">
          (Sueldo neto + cargas) ajustado por inflación, dividido por la cantidad de empleados del mes (<code>liquidacion_sueldo</code> sin SAC). Sube con paritarias y con contrataciones que desbalancean.
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function SueldosExtras() {
  const { data } = useEgresosData();
  return (
    <>
      <ComposicionCostoLaboralChart data={data} />
      <CostoPorEmpleadoChart data={data} />
    </>
  );
}

export default function SueldosPage() {
  return (
    <EgresoDetailPage
      title="Sueldos"
      subtitle="Sueldos netos y cargas sociales patronales (F.931)"
      callout={
        <Callout>
          <p>
            Costo laboral total del período, en criterio <strong>devengado</strong> — lo que corresponde a ese mes,
            no cuándo se paga.
          </p>
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
            <li>
              <strong className="text-foreground">Sueldos Neto</strong>: lo que efectivamente cobra el empleado
              (después de aportes y retenciones).
            </li>
            <li>
              <strong className="text-foreground">Cargas Sociales</strong>: contribuciones patronales del
              formulario F.931 (jubilación, obra social, ART, etc.) — lo que paga la empresa además del sueldo.
            </li>
            <li>
              El costo laboral total (lo que figura en el P&L) es la suma de ambos.
              Para ver el desglose empleado por empleado, ir a la sección <strong>Personal</strong>.
            </li>
          </ul>
        </Callout>
      }
      extractValue={(r: EgresoRow) => r.sueldosNeto + r.cargasSociales}
      extractBreakdown={(r: EgresoRow) => ({
        "Sueldos Neto": r.sueldosNeto,
        "Cargas Sociales": r.cargasSociales,
      })}
      breakdownColors={COLORS}
    >
      <SueldosExtras />
    </EgresoDetailPage>
  );
}
