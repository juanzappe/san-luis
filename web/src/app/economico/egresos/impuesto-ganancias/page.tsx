"use client";

import { EgresoDetailPage } from "@/components/egreso-detail-page";
import type { EgresoRow } from "@/lib/economic-queries";

export default function ImpuestoGananciasPage() {
  return (
    <EgresoDetailPage
      title="Imp. a las Ganancias"
      subtitle="Devengado — estimado al 36,7% sobre resultado antes de ganancias ajustado por RECPAM"
      extractValue={(r: EgresoRow) => r.ganancias}
    />
  );
}
