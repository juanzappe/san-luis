"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { useInflation } from "@/lib/inflation";
import {
  type EgresoRow,
  type ResultadoRow,
  fetchEgresos,
  fetchResultado,
  fetchFinancierosDesglose,
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

// Claves SWR compartidas: todas las páginas que usan este hook apuntan al
// mismo slot de caché, así que la segunda navegación vuelve instantánea.
const SWR_OPTS = {
  dedupingInterval: 300_000, // 5 min
  revalidateOnFocus: false,
  revalidateIfStale: false,
} as const;

const EMPTY_EGRESOS: EgresoRow[] = [];
const EMPTY_RESULTADO: ResultadoRow[] = [];
const EMPTY_IPC = new Map<string, number>();
const EMPTY_TAX = { mensual: [] as ResumenMensualRow[] };
const EMPTY_FIN: Array<{ periodo: string; comisionesBancarias: number; intereses: number; comisionesMp: number }> = [];

/**
 * Shared hook that fetches egresos + resultado + IPC + tax data,
 * applies inflation adjustment, and returns processed data.
 *
 * Cacheado con SWR — se dedupa entre páginas y se preserva entre navegaciones
 * durante el intervalo configurado.
 */
export function useEgresosData(): UseEgresosDataResult {
  const { adjust } = useInflation();

  const egresosSWR = useSWR("egresos:fetchEgresos", fetchEgresos, SWR_OPTS);
  const resultadoSWR = useSWR("egresos:fetchResultado", fetchResultado, SWR_OPTS);
  const ipcSWR = useSWR("egresos:fetchIpcMensualMap", fetchIpcMensualMap, SWR_OPTS);
  const taxSWR = useSWR("egresos:fetchResumenFiscal", fetchResumenFiscal, SWR_OPTS);
  const finSWR = useSWR("egresos:fetchFinancierosDesglose", fetchFinancierosDesglose, SWR_OPTS);

  const raw = egresosSWR.data ?? EMPTY_EGRESOS;
  const rawResultado = resultadoSWR.data ?? EMPTY_RESULTADO;
  const ipcMap = ipcSWR.data ?? EMPTY_IPC;
  const taxData = taxSWR.data ?? EMPTY_TAX;
  const financieros = finSWR.data ?? EMPTY_FIN;

  const loading =
    egresosSWR.isLoading ||
    resultadoSWR.isLoading ||
    ipcSWR.isLoading ||
    taxSWR.isLoading ||
    finSWR.isLoading;

  const error =
    egresosSWR.error?.message ??
    resultadoSWR.error?.message ??
    ipcSWR.error?.message ??
    taxSWR.error?.message ??
    finSWR.error?.message ??
    null;

  const taxMap = useMemo(
    () => new Map(taxData.mensual.map((r) => [r.periodo, r])),
    [taxData],
  );

  const finCoreMap = useMemo(
    () =>
      new Map(
        financieros.map((r) => [
          r.periodo,
          r.comisionesBancarias + r.intereses + r.comisionesMp,
        ]),
      ),
    [financieros],
  );

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
      // Imp. al Cheque va con Gastos Comerciales (antes estaba en Financieros).
      // `r.financieros` queda tal cual (sólo banco), `r.total` no se altera
      // porque ya incluía el cheque — sólo cambia a qué grupo se le asigna en
      // los consumers.
      const cheque = taxMap.get(r.periodo)?.cheque ?? 0;
      const totalSinCheque = r.total; // cheque se contabiliza en comerciales

      // Compute gananciasBase mirroring EERR logic exactly:
      // resultadoAntesGanancias = margenBruto - costCom(computeGastosComerciales + cheque) - costFin - recpam
      let gananciasBaseAdj = 0;
      if (resultadoRow) {
        const year = r.periodo.split("-")[0];
        const ing = adjust(resultadoRow.ingresos, r.periodo);
        const costOp = adjust(resultadoRow.costosOperativos, r.periodo);
        const sueldos = adjust(resultadoRow.sueldos, r.periodo);
        const cargasSoc = adjust(resultadoRow.cargasSociales, r.periodo);
        const margenBruto = ing - costOp - sueldos - cargasSoc;

        // Gastos Comerciales: IIBB+SegHig+cuotas+cheque + facturas de
        // Honorarios/Seguros/Telefonía/Servicios públicos — mismo criterio
        // que /economico/egresos/gastos-comerciales.
        const costComNominal =
          computeGastosComerciales(resultadoRow.ingresos, r.periodo) +
          cheque +
          (resultadoRow.comercialesProveedor ?? 0);
        const costCom = adjust(costComNominal, r.periodo);
        const costFin = adjust(resultadoRow.costosFinancieros, r.periodo);

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

      // Financieros = sólo los 3 conceptos core (nominal → ajustado).
      const finCoreNom = finCoreMap.get(r.periodo) ?? r.financieros;
      return {
        ...r,
        operativos: adjust(r.operativos, r.periodo),
        comerciales: adjust(r.comerciales, r.periodo),
        financieros: adjust(finCoreNom, r.periodo),
        ganancias: adjust(gananciasNom, r.periodo),
        gananciasBase: gananciasBaseAdj,
        total: adjust(totalSinCheque, r.periodo),
        categorias: adjCats,
        sueldos: adjust(r.sueldos, r.periodo),
        sueldosNeto: adjust(r.sueldosNeto, r.periodo),
        cargasSociales: adjust(r.cargasSociales, r.periodo),
        impuestos: adjust(r.impuestos, r.periodo),
      };
    });
  }, [raw, adjust, resultadoMap, ipcMap, ipcFallback, taxMap, finCoreMap]);

  const periodos = useMemo(() => data.map((r) => r.periodo), [data]);

  return { data, taxData: taxMap, resultadoData: resultadoMap, loading, error, periodos };
}
