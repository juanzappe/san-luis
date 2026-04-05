"use client";

/**
 * Página de diagnóstico temporal — investiga patrones de transferencias cruzadas
 * en movimiento_mp y movimiento_bancario para corregir el doble conteo en
 * get_flujo_fondos().
 *
 * BORRAR después de aplicar el fix.
 */

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

/* ---------- helpers ---------- */
const fmt = (n: number) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);

interface QueryResult {
  title: string;
  description: string;
  rows: Record<string, unknown>[];
  error?: string;
  loading: boolean;
}

/* ---------- component ---------- */
export default function DebugFlujoDeFondos() {
  const [results, setResults] = useState<QueryResult[]>([
    {
      title: "A. Tipos de operación en MP",
      description: "Identificar retiros al banco y otros tipos",
      rows: [],
      loading: true,
    },
    {
      title: "B. Columnas de movimiento_caja",
      description: "¿Hay campo que identifique depósitos de caja al banco?",
      rows: [],
      loading: true,
    },
    {
      title: "C. Conceptos bancarios — depósitos de efectivo",
      description: "Créditos con conceptos de depósito/efectivo",
      rows: [],
      loading: true,
    },
    {
      title: "D. Transferencias inter-banco",
      description: "Conceptos con santander/provincia/transf propia",
      rows: [],
      loading: true,
    },
    {
      title: "E. Conceptos bancarios — créditos con 'mercado' o 'merpag'",
      description: "Créditos que parecen venir de MP",
      rows: [],
      loading: true,
    },
    {
      title: "F. Top 20 conceptos de créditos bancarios (por monto)",
      description: "Los 20 conceptos con mayor total de créditos",
      rows: [],
      loading: true,
    },
  ]);

  useEffect(() => {
    runAllQueries();
  }, []);

  async function runAllQueries() {
    // A. Tipos de operación en MP
    const queryA = async () => {
      const { data, error } = await supabase
        .from("movimiento_mp")
        .select("tipo_operacion, importe");
      if (error) return { rows: [], error: error.message };
      // Aggregate client-side
      const map = new Map<string, { count: number; positivos: number; negativos: number }>();
      for (const r of data ?? []) {
        const key = r.tipo_operacion ?? "(null)";
        const entry = map.get(key) ?? { count: 0, positivos: 0, negativos: 0 };
        entry.count++;
        const imp = Number(r.importe) || 0;
        if (imp > 0) entry.positivos += imp;
        else entry.negativos += Math.abs(imp);
        map.set(key, entry);
      }
      const rows = Array.from(map.entries())
        .map(([tipo, v]) => ({
          tipo_operacion: tipo,
          count: v.count,
          positivos: fmt(v.positivos),
          negativos: fmt(v.negativos),
        }))
        .sort((a, b) => b.count - a.count);
      return { rows };
    };

    // B. Columnas de movimiento_caja
    const queryB = async () => {
      // Fetch one row to inspect column names
      const { data, error } = await supabase
        .from("movimiento_caja")
        .select("*")
        .limit(1);
      if (error) return { rows: [], error: error.message };
      if (!data || data.length === 0) return { rows: [{ info: "Tabla vacía" }] };
      const cols = Object.keys(data[0]).map((col) => ({
        column_name: col,
        sample_value: String(data[0][col] ?? "NULL").substring(0, 80),
      }));
      return { rows: cols };
    };

    // C. Conceptos bancarios — depósitos de efectivo
    const queryC = async () => {
      const { data, error } = await supabase
        .from("movimiento_bancario")
        .select("concepto, credito")
        .or("concepto.ilike.%deposito%,concepto.ilike.%efectivo%,concepto.ilike.%dep.efec%,concepto.ilike.%dep efec%");
      if (error) return { rows: [], error: error.message };
      const map = new Map<string, { count: number; total: number }>();
      for (const r of data ?? []) {
        const key = r.concepto ?? "(null)";
        const entry = map.get(key) ?? { count: 0, total: 0 };
        entry.count++;
        entry.total += Number(r.credito) || 0;
        map.set(key, entry);
      }
      const rows = Array.from(map.entries())
        .map(([concepto, v]) => ({ concepto, count: v.count, total_credito: fmt(v.total) }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 15);
      return { rows };
    };

    // D. Transferencias inter-banco
    const queryD = async () => {
      const { data, error } = await supabase
        .from("movimiento_bancario")
        .select("concepto, credito, debito")
        .or("concepto.ilike.%santander%,concepto.ilike.%provincia%,concepto.ilike.%transf%propia%");
      if (error) return { rows: [], error: error.message };
      const map = new Map<string, { count: number; creditos: number; debitos: number }>();
      for (const r of data ?? []) {
        const key = r.concepto ?? "(null)";
        const entry = map.get(key) ?? { count: 0, creditos: 0, debitos: 0 };
        entry.count++;
        entry.creditos += Number(r.credito) || 0;
        entry.debitos += Number(r.debito) || 0;
        map.set(key, entry);
      }
      const rows = Array.from(map.entries())
        .map(([concepto, v]) => ({
          concepto,
          count: v.count,
          creditos: fmt(v.creditos),
          debitos: fmt(v.debitos),
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 15);
      return { rows };
    };

    // E. Conceptos bancarios — créditos que parecen MP
    const queryE = async () => {
      const { data, error } = await supabase
        .from("movimiento_bancario")
        .select("concepto, credito")
        .gt("credito", 0)
        .or("concepto.ilike.%mercado%,concepto.ilike.%merpag%,concepto.ilike.%m.pago%,concepto.ilike.%mp %");
      if (error) return { rows: [], error: error.message };
      const map = new Map<string, { count: number; total: number }>();
      for (const r of data ?? []) {
        const key = r.concepto ?? "(null)";
        const entry = map.get(key) ?? { count: 0, total: 0 };
        entry.count++;
        entry.total += Number(r.credito) || 0;
        map.set(key, entry);
      }
      const rows = Array.from(map.entries())
        .map(([concepto, v]) => ({ concepto, count: v.count, total_credito: fmt(v.total) }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 15);
      return { rows };
    };

    // F. Top 20 conceptos de créditos por monto total
    const queryF = async () => {
      const { data, error } = await supabase
        .from("movimiento_bancario")
        .select("concepto, credito")
        .gt("credito", 0);
      if (error) return { rows: [], error: error.message };
      const map = new Map<string, { count: number; total: number }>();
      for (const r of data ?? []) {
        const key = r.concepto ?? "(null)";
        const entry = map.get(key) ?? { count: 0, total: 0 };
        entry.count++;
        entry.total += Number(r.credito) || 0;
        map.set(key, entry);
      }
      const rows = Array.from(map.entries())
        .map(([concepto, v]) => ({ concepto, count: v.count, total_credito: fmt(v.total) }))
        .sort((a, b) => {
          const totalA = Number(String(a.total_credito).replace(/[^0-9,-]/g, "").replace(",", ".")) || 0;
          const totalB = Number(String(b.total_credito).replace(/[^0-9,-]/g, "").replace(",", ".")) || 0;
          // Sort by raw total instead
          return 0;
        });
      // Re-sort by raw total
      const rawMap = new Map<string, number>();
      for (const r of data ?? []) {
        const key = r.concepto ?? "(null)";
        rawMap.set(key, (rawMap.get(key) ?? 0) + (Number(r.credito) || 0));
      }
      const sorted = rows.sort((a, b) => (rawMap.get(b.concepto) ?? 0) - (rawMap.get(a.concepto) ?? 0));
      return { rows: sorted.slice(0, 20) };
    };

    const queries = [queryA, queryB, queryC, queryD, queryE, queryF];
    const newResults = [...results];

    await Promise.all(
      queries.map(async (fn, i) => {
        try {
          const res = await fn();
          newResults[i] = { ...newResults[i], ...res, loading: false };
        } catch (e) {
          newResults[i] = {
            ...newResults[i],
            error: String(e),
            loading: false,
          };
        }
      })
    );

    setResults([...newResults]);
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      <div className="bg-yellow-900/30 border border-yellow-600 rounded-lg p-4">
        <h1 className="text-xl font-bold text-yellow-400">
          🔍 Debug: Flujo de Fondos — Patrones de Transferencias Cruzadas
        </h1>
        <p className="text-yellow-200 text-sm mt-1">
          Página temporal para investigar doble conteo. Borrar después del fix.
        </p>
      </div>

      {results.map((q, i) => (
        <div key={i} className="bg-zinc-900 border border-zinc-700 rounded-lg p-4">
          <h2 className="text-lg font-semibold text-white">{q.title}</h2>
          <p className="text-zinc-400 text-sm mb-3">{q.description}</p>

          {q.loading && (
            <p className="text-zinc-500 animate-pulse">Cargando...</p>
          )}

          {q.error && (
            <p className="text-red-400 text-sm">Error: {q.error}</p>
          )}

          {!q.loading && !q.error && q.rows.length === 0 && (
            <p className="text-zinc-500">Sin resultados</p>
          )}

          {!q.loading && q.rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-700">
                    {Object.keys(q.rows[0]).map((col) => (
                      <th
                        key={col}
                        className="text-left py-2 px-3 text-zinc-400 font-medium"
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {q.rows.map((row, ri) => (
                    <tr
                      key={ri}
                      className="border-b border-zinc-800 hover:bg-zinc-800/50"
                    >
                      {Object.values(row).map((val, ci) => (
                        <td key={ci} className="py-1.5 px-3 text-zinc-300">
                          {String(val)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
