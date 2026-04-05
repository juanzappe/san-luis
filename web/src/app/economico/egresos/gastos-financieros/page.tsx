"use client";

import { EgresoDetailPage } from "@/components/egreso-detail-page";
import type { EgresoRow } from "@/lib/economic-queries";

export default function GastosFinancierosPage() {
  return (
    <EgresoDetailPage
      title="Gastos Financieros"
      subtitle="Comisiones bancarias, intereses, Imp. al Cheque, mantenimiento y seguro"
      extractValue={(r: EgresoRow) => r.financieros}
    />
  );
}
