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
import {
  formatARS,
  PROVEEDOR_CATEGORIAS_OPERATIVAS,
  PROVEEDOR_CATEGORIAS_COMERCIALES,
} from "@/lib/economic-queries";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProveedorEdit {
  id: number;
  razon_social: string;
  cuit: string | null;
  grupo_costo: string | null;
  categoria_egreso: string | null;
  tipo_costo: string | null;
  volumen: number;
}

type RowStatus = "idle" | "saving" | "saved" | "error";

const TIPO_COSTO_OPTIONS = ["fijo", "variable"] as const;
const GRUPO_COSTO_OPTIONS = ["operativo", "comercial"] as const;

/** Categorías válidas según grupo_costo. */
function categoriaOptionsFor(grupo: string | null): readonly string[] {
  if (grupo === "comercial") return PROVEEDOR_CATEGORIAS_COMERCIALES;
  if (grupo === "operativo") return PROVEEDOR_CATEGORIAS_OPERATIVAS;
  return [];
}

type SortKey = keyof ProveedorEdit;

// ---------------------------------------------------------------------------
// Data load
// ---------------------------------------------------------------------------

async function fetchProveedores(): Promise<ProveedorEdit[]> {
  const [provsRes, volRes] = await Promise.all([
    supabase
      .from("proveedor")
      .select("id, razon_social, cuit, grupo_costo, categoria_egreso, tipo_costo")
      .order("razon_social"),
    // RPC porque `select` plano en factura_recibida corta a ~1000 filas.
    supabase.rpc("get_proveedor_volumen_total"),
  ]);
  if (provsRes.error) throw provsRes.error;
  if (volRes.error) throw volRes.error;

  const vol = new Map<number, number>();
  for (const v of (volRes.data ?? []) as { proveedor_id: number; volumen: number }[]) {
    vol.set(v.proveedor_id, Number(v.volumen || 0));
  }

  return ((provsRes.data ?? []) as Omit<ProveedorEdit, "volumen">[])
    .map((p) => ({ ...p, volumen: vol.get(p.id) ?? 0 }));
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

export default function EditarProveedoresPage() {
  const [rows, setRows] = useState<ProveedorEdit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<number, RowStatus>>({});
  const [query, setQuery] = useState("");
  const [catFilter, setCatFilter] = useState<string>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" } | null>({
    key: "volumen",
    dir: "desc",
  });

  useEffect(() => {
    fetchProveedores()
      .then(setRows)
      .catch((e) => setError(e.message ?? "Error"))
      .finally(() => setLoading(false));
  }, []);

  const categorias = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) if (r.categoria_egreso) s.add(r.categoria_egreso);
    return Array.from(s).sort();
  }, [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (q && !r.razon_social.toLowerCase().includes(q) && !(r.cuit ?? "").includes(q)) return false;
      if (catFilter !== "all" && r.categoria_egreso !== catFilter) return false;
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
  }, [rows, query, catFilter, sort]);

  const onSort = (k: SortKey) => {
    setSort((cur) => {
      if (cur?.key === k) return { key: k, dir: cur.dir === "asc" ? "desc" : "asc" };
      return { key: k, dir: k === "volumen" ? "desc" : "asc" };
    });
  };

  const saveFields = async (
    id: number,
    patch: Partial<Pick<ProveedorEdit, "grupo_costo" | "categoria_egreso" | "tipo_costo">>,
  ) => {
    setStatus((s) => ({ ...s, [id]: "saving" }));
    const { error } = await supabase
      .from("proveedor")
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

  // Al cambiar grupo_costo, si la categoría actual no es válida para el nuevo
  // grupo, se resetea a "Otros" (que existe en ambos grupos).
  const changeGrupo = (p: ProveedorEdit, nuevo: string | null) => {
    if (nuevo === p.grupo_costo) return;
    const opts = categoriaOptionsFor(nuevo);
    const patch: Partial<ProveedorEdit> = { grupo_costo: nuevo };
    if (!opts.includes(p.categoria_egreso ?? "")) {
      patch.categoria_egreso = nuevo ? "Otros" : null;
    }
    saveFields(p.id, patch);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-3 text-muted-foreground">Cargando proveedores…</span>
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
          <Link href="/comercial/proveedores" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" /> Volver
          </Link>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Editar Proveedores</h1>
            <p className="text-sm text-muted-foreground">
              Modificá categoría, subcategoría y tipo de costo. Los cambios se guardan al salir del campo.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={catFilter}
            onChange={(e) => setCatFilter(e.target.value)}
            className="rounded-lg border border-input bg-background px-3 py-1.5 text-xs font-medium cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            <option value="all">Todas las categorías</option>
            {categorias.map((c) => (<option key={c} value={c}>{c}</option>))}
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

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHead label="Razón Social" sortKey="razon_social" currentSort={sort} onSort={onSort} />
                  <SortableHead label="CUIT" sortKey="cuit" currentSort={sort} onSort={onSort} />
                  <SortableHead label="Grupo" sortKey="grupo_costo" currentSort={sort} onSort={onSort} />
                  <SortableHead label="Categoría" sortKey="categoria_egreso" currentSort={sort} onSort={onSort} />
                  <SortableHead label="Tipo Costo" sortKey="tipo_costo" currentSort={sort} onSort={onSort} />
                  <SortableHead label="Volumen" sortKey="volumen" currentSort={sort} onSort={onSort} align="right" />
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((p) => {
                  const catOpts = categoriaOptionsFor(p.grupo_costo);
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium max-w-[260px] truncate" title={p.razon_social}>
                        {p.razon_social}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{p.cuit ?? "—"}</TableCell>
                      <TableCell>
                        <select
                          value={p.grupo_costo ?? ""}
                          onChange={(e) => changeGrupo(p, e.target.value || null)}
                          className="w-28 rounded border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                        >
                          <option value="">—</option>
                          {GRUPO_COSTO_OPTIONS.map((g) => (<option key={g} value={g}>{g}</option>))}
                        </select>
                      </TableCell>
                      <TableCell>
                        <select
                          value={p.categoria_egreso ?? ""}
                          onChange={(e) => {
                            const v = e.target.value || null;
                            if (v !== p.categoria_egreso) saveFields(p.id, { categoria_egreso: v });
                          }}
                          disabled={catOpts.length === 0}
                          className="w-52 rounded border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                        >
                          <option value="">—</option>
                          {catOpts.map((c) => (<option key={c} value={c}>{c}</option>))}
                        </select>
                      </TableCell>
                      <TableCell>
                        <select
                          value={p.tipo_costo ?? ""}
                          onChange={(e) => {
                            const v = e.target.value || null;
                            if (v !== p.tipo_costo) saveFields(p.id, { tipo_costo: v });
                          }}
                          className="w-28 rounded border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                        >
                          <option value="">—</option>
                          {TIPO_COSTO_OPTIONS.map((s) => (<option key={s} value={s}>{s}</option>))}
                        </select>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs whitespace-nowrap">
                        {formatARS(p.volumen)}
                      </TableCell>
                      <TableCell>
                        <StatusIcon status={status[p.id] ?? "idle"} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">
            Mostrando {visible.length} de {rows.length} proveedores. Elegí primero el grupo (operativo/comercial) y después la categoría del listado cerrado.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
