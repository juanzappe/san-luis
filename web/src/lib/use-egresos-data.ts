"use client";

import { useEffect, useMemo, useState } from "react";
import { useInflation } from "@/lib/inflation";
import {
  type EgresoRow,
  type ResultadoRow,
  fetchEgresos,
  fetchResultado,
  computeIpcFallback,
  computeGananciasNominal,
  RECPAM_HISTORICO,
  RATIO_PMN,
} from "@/lib/economic-queries";
import { fetchResumenFiscal, computeGastosComerciales, type ResumenMensualRow } from "@/lib/tax-queries";
import { fetchIpcMensualMap } from "@/lib/macro-queries";

export interface UseEgresosDataResult {
  data: EgresoRow[];
  taxData: Map<string, ResumenMensualRow>;
  resultadoData: Map<string, ResultadoRow>;
  loading: boolean;
  error: string | null;
  periodos: string[];
}

/**
 * Shared hook that fetches egresos + resultado + IPC + tax data,
 * applies inflation adjustment, and returns processed data.
 *
 * Extracted from economico/egresos/page.tsx to be reused by sub-pages.
 */
export function useEgresosData(): UseEgresosDataResult {
  const { adjust } = useInflation();
  const [raw, setRaw] = useState<EgresoRow[]>([]);
  const [rawResultado, setRawResultado] = useState<ResultadoRow[]>([]);
  const [ipcMap, setIpcMap] = useState<Map<string, number>>(new Map());
  const [taxMap, setTaxMap] = useState<Map<string, ResumenMensualRow>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchEgresos(), fetchResultado(), fetchIpcMensualMap(), fetchResumenFiscal()])
      .then(([egresos, resultado, ipc, fiscal]) => {
        setRaw(egresos);
        setRawResultado(resultado);
        setIpcMap(ipc);
        setTaxMap(new Map(fiscal.mensual.map((r) => [r.periodo, r])));
      })
      .catch((e) => setError(e.message ?? "Error"))
      .finally(() => setLoading(false));
  }, []);

  const resultadoMap = useMemo(
    () => new Map(rawResultado.map((r) => [r.periodo, r])),
    [rawResultado],
  );

  const ipcFallback = useMemo(() => computeIpcFallback(ipcMap), [ipcMap]);

  const data: EgresoRow[] = useMemo(() => {
    return raw.map((r) => {
      const adjCats: Record<string, number> = {};
      for (const [cat, monto] of Object.entries(r.categorias)) {
        adjCats[cat] = adjust(monto, r.periodo);
      }
      const resultadoRow = resultadoMap.get(r.periodo);
      const gananciasNom = resultadoRow
        ? computeGananciasNominal(resultadoRow, ipcMap, ipcFallback)
        : 0;
      // Add Imp. al Cheque from Resumen Fiscal to Financieros
      const cheque = taxMap.get(r.periodo)?.cheque ?? 0;
      const financierosConCheque = r.financieros + cheque;
      const totalConCheque = r.total + cheque;

      // Compute gananciasBase mirroring EERR logic exactly:
      // resultadoAntesGanancias = margenBruto - costCom(computeGastosComerciales) - costFin(+cheque) - recpam
      let gananciasBaseAdj = 0;
      if (resultadoRow) {
        const year = r.periodo.split("-")[0];
        const ing = adjust(resultadoRow.ingresos, r.periodo);
        const costOp = adjust(resultadoRow.costosOperativos, r.periodo);
        const sueldos = adjust(resultadoRow.sueldos, r.periodo);
        const cargasSoc = adjust(resultadoRow.cargasSociales, r.periodo);
        const margenBruto = ing - costOp - sueldos - cargasSoc;

        const costComNominal = computeGastosComerciales(resultadoRow.ingresos, r.periodo);
        const costCom = adjust(costComNominal, r.periodo);
        const costFin = adjust(resultadoRow.costosFinancieros + cheque, r.periodo);

        // RECPAM — same as EERR
        let recpamNominal: number;
        if (year in RECPAM_HISTORICO) {
          recpamNominal = RECPAM_HISTORICO[year] / 12;
        } else {
          recpamNominal = resultadoRow.ingresos * RATIO_PMN * (ipcMap.get(r.periodo) ?? ipcFallback);
        }
        const recpamBase = (year in RECPAM_HISTORICO) ? `${year}-12` : r.periodo;
        const recpam = adjust(recpamNominal, recpamBase);

        gananciasBaseAdj = margenBruto - costCom - costFin - recpam;
      }

      return {
        ...r,
        operativos: adjust(r.operativos, r.periodo),
        comerciales: adjust(r.comerciales, r.periodo),
        financieros: adjust(financierosConCheque, r.periodo),
        ganancias: adjust(gananciasNom, r.periodo),
        gananciasBase: gananciasBaseAdj,
        total: adjust(totalConCheque, r.periodo),
        categorias: adjCats,
        sueldos: adjust(r.sueldos, r.periodo),
        sueldosNeto: adjust(r.sueldosNeto, r.periodo),
        cargasSociales: adjust(r.cargasSociales, r.periodo),
        impuestos: adjust(r.impuestos, r.periodo),
      };
    });
  }, [raw, adjust, resultadoMap, ipcMap, ipcFallback, taxMap]);

  const periodos = useMemo(() => data.map((r) => r.periodo), [data]);

  return { data, taxData: taxMap, resultadoData: resultadoMap, loading, error, periodos };
}
