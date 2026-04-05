"use client";

import { EgresoDetailPage } from "@/components/egreso-detail-page";
import { type EgresoRow, TASA_GANANCIAS } from "@/lib/economic-queries";

export default function ImpuestoGananciasPage() {
  return (
    <EgresoDetailPage
      title="Imp. a las Ganancias"
      subtitle="Devengado — estimado al 36,7% sobre resultado antes de ganancias ajustado por RECPAM"
      extractValue={(r: EgresoRow) => r.ganancias}
      aggregateValue={(rows: EgresoRow[]) => {
        const totalBase = rows.reduce((sum, r) => sum + r.gananciasBase, 0);
        return totalBase > 0 ? totalBase * TASA_GANANCIAS : 0;
      }}
    />
  );
}
