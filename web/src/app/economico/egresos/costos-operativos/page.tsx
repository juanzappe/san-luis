"use client";

import { EgresoDetailPage } from "@/components/egreso-detail-page";
import type { EgresoRow } from "@/lib/economic-queries";

export default function CostosOperativosPage() {
  return (
    <EgresoDetailPage
      title="Costos Operativos"
      subtitle="Proveedores por categoría — neto gravado sin IVA"
      extractValue={(r: EgresoRow) =>
        Object.values(r.categorias).reduce((a, b) => a + b, 0)
      }
      extractBreakdown={(r: EgresoRow) => r.categorias}
    />
  );
}
