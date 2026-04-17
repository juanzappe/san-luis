"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpDown, ArrowUp, ArrowDown, Check, Loader2, AlertCircle, Search } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { supabase } from "@/lib/supabase";
import { formatARS } from "@/lib/economic-queries";

// ---------------------------------------------------------------------------
// Taxonomía
// ---------------------------------------------------------------------------

const TIPO_ENTIDAD_OPTIONS = ["Público", "Privado"] as const;

/**
 * Clasificaciones sugeridas por tipo de entidad. Se usan como datalist —
 * se puede tipear una nueva si hiciera falta, pero la idea es mantenerse
 * dentro de ≤8 por grupo.
 */
const CLASIF_SUGERIDAS: Record<string, string[]> = {
  "Público": [
    "Ministerio",
    "Universidad",
    "Hospital",
    "Organismo público",
    "Poder judicial",
    "Gobierno",
    "Otros",
  ],
  "Privado": [
    "Empresa",
    "Laboratorio",
    "Clínica",
    "Sindicato",
    "Colegio Profesional",
    "Asociación/Cooperativa",
    "Particular",
    "Otros",
  ],
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ClienteEdit {
  id: number;
  razon_social: string;
  cuit: string | null;
  tipo_entidad: string | null;
  clasificacion: string | null;
  volumen: number;
}

type RowStatus = "idle" | "saving" | "saved" | "error";
type SortKey = keyof ClienteEdit;

// ---------------------------------------------------------------------------
// Data load
// ---------------------------------------------------------------------------

async function fetchClientes(): Promise<ClienteEdit[]> {
  const [clsRes, volRes] = await Promise.all([
    supabase
      .from("cliente")
      .select("id, razon_social, cuit, tipo_entidad, clasificacion")
      .order("razon_social"),
    // RPC porque factura_emitida tiene ~97k filas y el select plano corta a ~1000.
    supabase.rpc("get_cliente_volumen_total"),
  ]);
  if (clsRes.error) throw clsRes.error;
  if (volRes.error) throw volRes.error;

  const vol = new Map<number, number>();
  for (const v of (volRes.data ?? []) as { cliente_id: number; volumen: number }[]) {
    vol.set(v.cliente_id, Number(v.volumen || 0));
  }

  return ((clsRes.data ?? []) as Omit<ClienteEdit, "volumen">[])
    .map((c) => ({ ...c, volumen: vol.get(c.id) ?? 0 }));
}

// ---------------------------------------------------------------------------
// Status indicator
// ---------------------------------------------------------------------------

function StatusIcon({ status }: { status: RowStatus }) {
  if (status === "saving") return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  if (status === "saved") return <Check className="h-4 w-4 text-green-600" />;
  if (status === "error") return <AlertCircle className="h-4 w-4 text-red-500" />;
  return <span className="inline-block h-4 w-4" />;
}

// ---------------------------------------------------------------------------
// Sortable header
// ---------------------------------------------------------------------------

function SortableHead({
  label,
  sortKey,
  currentSort,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  currentSort: { key: SortKey; dir: "asc" | "desc" } | null;
  onSort: (k: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = currentSort?.key === sortKey;
  const Arrow = !active ? ArrowUpDown : currentSort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead className={align === "right" ? "text-right" : ""}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${
          active ? "text-foreground font-semibold" : "text-muted-foreground"
        }`}
      >
        {label}
        <Arrow className="h-3 w-3" />
      </button>
    </TableHead>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export default function EditarClientesPage() {
  const [rows, setRows] = useState<ClienteEdit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<number, RowStatus>>({});
  const [query, setQuery] = useState("");
  const [tipoFilter, setTipoFilter] = useState("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" } | null>({
    key: "volumen",
    dir: "desc",
  });

  useEffect(() => {
    fetchClientes()
      .then(setRows)
      .catch((e) => setError(e.message ?? "Error"))
      .finally(() => setLoading(false));
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (q && !r.razon_social.toLowerCase().includes(q) && !(r.cuit ?? "").includes(q)) return false;
      if (tipoFilter !== "all" && r.tipo_entidad !== tipoFilter) return false;
      return true;
    });
    if (sort) {
      const dir = sort.dir === "asc" ? 1 : -1;
      out = [...out].sort((a, b) => {
        const av = a[sort.key];
        const bv = b[sort.key];
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
        return String(av).localeCompare(String(bv)) * dir;
      });
    }
    return out;
  }, [rows, query, tipoFilter, sort]);

  const onSort = (k: SortKey) => {
    setSort((cur) => {
      if (cur?.key === k) return { key: k, dir: cur.dir === "asc" ? "desc" : "asc" };
      return { key: k, dir: k === "volumen" ? "desc" : "asc" };
    });
  };

  const saveFields = async (
    id: number,
    patch: Partial<Pick<ClienteEdit, "tipo_entidad" | "clasificacion">>,
  ) => {
    setStatus((s) => ({ ...s, [id]: "saving" }));
    const { error } = await supabase
      .from("cliente")
      .update(patch)
      .eq("id", id);
    if (error) {
      setStatus((s) => ({ ...s, [id]: "error" }));
      console.error("Error al guardar:", error);
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setStatus((s) => ({ ...s, [id]: "saved" }));
    setTimeout(() => {
      setStatus((s) => (s[id] === "saved" ? { ...s, [id]: "idle" } : s));
    }, 1500);
  };

  const changeTipo = (c: ClienteEdit, nuevo: string | null) => {
    if (nuevo === c.tipo_entidad) return;
    const opts = nuevo ? CLASIF_SUGERIDAS[nuevo] ?? [] : [];
    const patch: Partial<ClienteEdit> = { tipo_entidad: nuevo };
    if (c.clasificacion && !opts.includes(c.clasificacion)) {
      // Si la clasificación actual no existe en el nuevo grupo, la reseteamos
      // a null para que el usuario elija una del listado sugerido.
      patch.clasificacion = null;
    }
    saveFields(c.id, patch);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-3 text-muted-foreground">Cargando clientes…</span>
      </div>
    );
  }

  if (error) {
    return (
      <Card><CardContent className="flex items-center gap-3 py-8">
        <AlertCircle className="h-5 w-5 text-red-500" /><p className="text-sm">{error}</p>
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <Link href="/comercial/clientes" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" /> Volver
          </Link>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Editar Clientes</h1>
            <p className="text-sm text-muted-foreground">
              Modificá tipo (público/privado) y clasificación. Los cambios se guardan al salir del campo.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={tipoFilter}
            onChange={(e) => setTipoFilter(e.target.value)}
            className="rounded-lg border border-input bg-background px-3 py-1.5 text-xs font-medium cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            <option value="all">Todos</option>
            {TIPO_ENTIDAD_OPTIONS.map((t) => (<option key={t} value={t}>{t}</option>))}
          </select>
        </div>
      </div>

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Buscar por nombre o CUIT…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8"
            />
          </div>

          {/* Datalists, una por tipo — el input decide cuál usar */}
          {TIPO_ENTIDAD_OPTIONS.map((t) => (
            <datalist key={t} id={`clasif-${t}`}>
              {(CLASIF_SUGERIDAS[t] ?? []).map((c) => (<option key={c} value={c} />))}
            </datalist>
          ))}

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHead label="Razón Social" sortKey="razon_social" currentSort={sort} onSort={onSort} />
                  <SortableHead label="CUIT" sortKey="cuit" currentSort={sort} onSort={onSort} />
                  <SortableHead label="Tipo" sortKey="tipo_entidad" currentSort={sort} onSort={onSort} />
                  <SortableHead label="Clasificación" sortKey="clasificacion" currentSort={sort} onSort={onSort} />
                  <SortableHead label="Volumen" sortKey="volumen" currentSort={sort} onSort={onSort} align="right" />
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium max-w-[260px] truncate" title={c.razon_social}>
                      {c.razon_social}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{c.cuit ?? "—"}</TableCell>
                    <TableCell>
                      <select
                        value={c.tipo_entidad ?? ""}
                        onChange={(e) => changeTipo(c, e.target.value || null)}
                        className="w-28 rounded border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      >
                        <option value="">—</option>
                        {TIPO_ENTIDAD_OPTIONS.map((t) => (<option key={t} value={t}>{t}</option>))}
                      </select>
                    </TableCell>
                    <TableCell>
                      <input
                        defaultValue={c.clasificacion ?? ""}
                        list={c.tipo_entidad ? `clasif-${c.tipo_entidad}` : undefined}
                        key={`${c.id}-${c.tipo_entidad}-${c.clasificacion ?? ""}`}
                        onBlur={(e) => {
                          const v = e.target.value.trim() || null;
                          if (v !== c.clasificacion) saveFields(c.id, { clasificacion: v });
                        }}
                        className="w-52 rounded border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs whitespace-nowrap">
                      {formatARS(c.volumen)}
                    </TableCell>
                    <TableCell>
                      <StatusIcon status={status[c.id] ?? "idle"} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">
            Mostrando {visible.length} de {rows.length} clientes. El campo Clasificación sugiere un listado por tipo (≤8 opciones). Si tipeás algo fuera del listado, también se guarda.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
