"use client";

import { EgresoDetailPage } from "@/components/egreso-detail-page";
import type { EgresoRow } from "@/lib/economic-queries";

const COLORS: Record<string, string> = {
  "Sueldos Neto": "#6366f1",
  "Cargas Sociales": "#a855f7",
};

export default function SueldosPage() {
  return (
    <EgresoDetailPage
      title="Sueldos"
      subtitle="Sueldos netos y cargas sociales patronales (F.931)"
      extractValue={(r: EgresoRow) => r.sueldosNeto + r.cargasSociales}
      extractBreakdown={(r: EgresoRow) => ({
        "Sueldos Neto": r.sueldosNeto,
        "Cargas Sociales": r.cargasSociales,
      })}
      breakdownColors={COLORS}
    />
  );
}
