"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IpcEntry {
  fecha: string; // YYYY-MM-DD
  valor: number;
}

interface InflationCtx {
  /** true = pesos constantes (ajustado), false = pesos corrientes (nominal) */
  adjusted: boolean;
  setAdjusted: (v: boolean) => void;
  /** Adjusts a nominal amount from `periodo` (YYYY-MM) to constant pesos */
  adjust: (monto: number, periodo: string) => number;
  /** IPC data loaded? */
  ipcLoaded: boolean;
}

const InflationContext = createContext<InflationCtx>({
  adjusted: true,
  setAdjusted: () => {},
  adjust: (m) => m,
  ipcLoaded: false,
});

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function InflationProvider({ children }: { children: ReactNode }) {
  const [adjusted, setAdjusted] = useState(true); // default: pesos constantes
  const [ipcMap, setIpcMap] = useState<Map<string, number>>(new Map());
  const [ipcLoaded, setIpcLoaded] = useState(false);

  // Fetch IPC from indicador_macro
  useEffect(() => {
    supabase
      .from("indicador_macro")
      .select("fecha, valor")
      .eq("tipo", "ipc")
      .order("fecha", { ascending: true })
      .then(({ data, error }) => {
        if (error || !data || data.length === 0) {
          setIpcLoaded(true);
          return;
        }
        const map = new Map<string, number>();
        for (const row of data as IpcEntry[]) {
          // key = YYYY-MM
          const periodo = row.fecha.slice(0, 7);
          map.set(periodo, Number(row.valor));
        }
        setIpcMap(map);
        setIpcLoaded(true);
      });
  }, []);

  // Base IPC = último mes disponible
  const ipcBase = useMemo(() => {
    if (ipcMap.size === 0) return 1;
    const sorted = Array.from(ipcMap.entries()).sort((a, b) =>
      a[0].localeCompare(b[0]),
    );
    return sorted[sorted.length - 1][1];
  }, [ipcMap]);

  const adjust = useCallback(
    (monto: number, periodo: string): number => {
      if (!adjusted || ipcMap.size === 0) return monto;
      const ipcMes = ipcMap.get(periodo);
      if (!ipcMes || ipcMes === 0) return monto;
      return monto * (ipcBase / ipcMes);
    },
    [adjusted, ipcMap, ipcBase],
  );

  const value = useMemo(
    () => ({ adjusted, setAdjusted, adjust, ipcLoaded }),
    [adjusted, setAdjusted, adjust, ipcLoaded],
  );

  return (
    <InflationContext.Provider value={value}>
      {children}
    </InflationContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useInflation() {
  return useContext(InflationContext);
}

// ---------------------------------------------------------------------------
// Toggle component
// ---------------------------------------------------------------------------

export function InflationToggle() {
  const { adjusted, setAdjusted } = useInflation();

  return (
    <button
      onClick={() => setAdjusted(!adjusted)}
      className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
      title={
        adjusted
          ? "Mostrando pesos constantes (ajustados por IPC)"
          : "Mostrando pesos corrientes (nominales)"
      }
    >
      <span
        className={`inline-block h-2 w-2 rounded-full ${
          adjusted ? "bg-green-500" : "bg-amber-500"
        }`}
      />
      {adjusted ? "Pesos constantes" : "Pesos corrientes"}
    </button>
  );
}
