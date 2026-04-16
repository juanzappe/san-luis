"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import {
  AreaChart, Area, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import {
  Landmark, Building2, CreditCard, Wallet, TrendingUp, TrendingDown, Minus, Home,
  Loader2, AlertCircle, Pencil, Check, X, Plus, Trash2, ChevronDown, ChevronRight,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  type SaldoCuenta,
  type InversionActualRow,
  type EvolucionSaldoRow,
  type InmuebleRow,
  fetchSaldosCuentas,
  fetchInversionesActuales,
  fetchEvolucionSaldos,
  fetchConfigManual,
  upsertConfigManual,
  fetchInmuebles,
  insertInmueble,
  updateInmueble,
  deleteInmueble,
  formatARS,
  shortLabel,
} from "@/lib/financial-queries";
import type {
  Formatter, ValueType, NameType,
} from "recharts/types/component/DefaultTooltipContent";

const arsTooltip: Formatter<ValueType, NameType> = (v) => formatARS(Number(v ?? 0));

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatFecha(iso: string | null): string {
  if (!iso) return "Sin datos";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function formatUSD(n: number): string {
  return n.toLocaleString("es-AR", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  });
}

// ─── Account config ─────────────────────────────────────────────────────────

interface AccountConfig {
  key: string;
  label: string;
  color: string;
  borderColor: string;
  icon: React.ElementType;
}

const ACCOUNTS: AccountConfig[] = [
  { key: "provincia", label: "Banco Provincia", color: "#3b82f6", borderColor: "border-l-blue-500", icon: Landmark },
  { key: "santander", label: "Banco Santander", color: "#ef4444", borderColor: "border-l-red-500", icon: Building2 },
  { key: "mercado_pago", label: "Mercado Pago", color: "#6366f1", borderColor: "border-l-indigo-500", icon: CreditCard },
  { key: "inviu", label: "InvertirOnline", color: "#22c55e", borderColor: "border-l-green-500", icon: TrendingUp },
  { key: "caja", label: "Efectivo en caja", color: "#f59e0b", borderColor: "border-l-amber-500", icon: Wallet },
];

// ═══════════════════════════════════════════════════════════════════════════
// PAGE
// ═══════════════════════════════════════════════════════════════════════════

export default function TesoreriaPage() {
  const [saldos, setSaldos] = useState<SaldoCuenta[]>([]);
  const [inversiones, setInversiones] = useState<InversionActualRow[]>([]);
  const [evolucion, setEvolucion] = useState<EvolucionSaldoRow[]>([]);
  const [inmuebles, setInmuebles] = useState<InmuebleRow[]>([]);
  const [efectivoCaja, setEfectivoCaja] = useState<number>(0);
  const [editingCaja, setEditingCaja] = useState(false);
  const [cajaInput, setCajaInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [invOpen, setInvOpen] = useState(false);

  useEffect(() => {
    Promise.all([
      fetchSaldosCuentas(),
      fetchInversionesActuales(),
      fetchEvolucionSaldos(12),
      fetchConfigManual("efectivo_caja"),
      fetchInmuebles().catch(() => [] as InmuebleRow[]),
    ])
      .then(([sc, inv, evo, caja, inm]) => {
        setSaldos(sc);
        setInversiones(inv);
        setEvolucion(evo);
        setInmuebles(inm);
        const cajaVal = Number(caja) || 0;
        setEfectivoCaja(cajaVal);
        setCajaInput(cajaVal > 0 ? cajaVal.toString() : "");
      })
      .catch((e) => setError(e.message ?? "Error"))
      .finally(() => setLoading(false));
  }, []);

  // ─── Derived values ─────────────────────────────────────────────────────
  const provincia = saldos.find((s) => s.cuenta === "provincia");
  const santander = saldos.find((s) => s.cuenta === "santander");
  const mp = saldos.find((s) => s.cuenta === "mercado_pago");
  const inviu = saldos.find((s) => s.cuenta === "inviu");

  const totalInversiones = inversiones.reduce((s, i) => s + i.valuacionMonto, 0);
  const totalInversionesUsd = inversiones.reduce((s, i) => s + i.valuacionUsd, 0);
  const fechaInversiones = inversiones[0]?.fechaValuacion ?? null;

  // Build saldo map: key → amount
  const saldoMap = useMemo(() => {
    const m: Record<string, { saldo: number; fecha: string | null }> = {
      provincia: { saldo: provincia?.saldoArs ?? 0, fecha: provincia?.fechaDato ?? null },
      santander: { saldo: santander?.saldoArs ?? 0, fecha: santander?.fechaDato ?? null },
      mercado_pago: { saldo: mp?.saldoArs ?? 0, fecha: mp?.fechaDato ?? null },
      inviu: { saldo: totalInversiones, fecha: fechaInversiones },
      caja: { saldo: efectivoCaja, fecha: null },
    };
    return m;
  }, [provincia, santander, mp, totalInversiones, fechaInversiones, efectivoCaja]);

  const liquidezTotal = Object.values(saldoMap).reduce((s, v) => s + v.saldo, 0);

  // Sparkline data per account (from evolucion, monthly)
  const sparklineData = useMemo(() => {
    const byBanco = new Map<string, { label: string; saldo: number }[]>();
    const sorted = [...evolucion].sort((a, b) => a.periodo.localeCompare(b.periodo));
    for (const row of sorted) {
      const arr = byBanco.get(row.banco) ?? [];
      arr.push({ label: shortLabel(row.periodo), saldo: row.saldo });
      byBanco.set(row.banco, arr);
    }
    return byBanco;
  }, [evolucion]);

  // ─── Caja edit handlers ─────────────────────────────────────────────────
  const startEditCaja = useCallback(() => {
    setCajaInput(efectivoCaja > 0 ? efectivoCaja.toString() : "");
    setEditingCaja(true);
  }, [efectivoCaja]);

  const saveCaja = useCallback(async () => {
    const val = Number(cajaInput) || 0;
    try {
      await upsertConfigManual("efectivo_caja", val.toString());
      setEfectivoCaja(val);
      setEditingCaja(false);
    } catch {
      // silently fail, keep editing
    }
  }, [cajaInput]);

  const cancelEditCaja = useCallback(() => {
    setEditingCaja(false);
    setCajaInput(efectivoCaja > 0 ? efectivoCaja.toString() : "");
  }, [efectivoCaja]);

  // ─── Inmuebles handlers ─────────────────────────────────────────────────
  const [editingInmuebleId, setEditingInmuebleId] = useState<number | null>(null);
  const [inmuebleForm, setInmuebleForm] = useState({ descripcion: "", direccion: "", valorEstimado: "", fechaValuacion: "", observaciones: "" });
  const [addingInmueble, setAddingInmueble] = useState(false);
  const [savingInmueble, setSavingInmueble] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const inmueblesTotalValue = inmuebles.reduce((s, i) => s + i.valorEstimado, 0);

  const startEditInmueble = useCallback((inm: InmuebleRow) => {
    setEditingInmuebleId(inm.id);
    setInmuebleForm({
      descripcion: inm.descripcion,
      direccion: inm.direccion ?? "",
      valorEstimado: inm.valorEstimado.toString(),
      fechaValuacion: inm.fechaValuacion ?? "",
      observaciones: inm.observaciones ?? "",
    });
  }, []);

  const cancelEditInmueble = useCallback(() => {
    setEditingInmuebleId(null);
    setAddingInmueble(false);
    setInmuebleForm({ descripcion: "", direccion: "", valorEstimado: "", fechaValuacion: "", observaciones: "" });
  }, []);

  const startAddInmueble = useCallback(() => {
    setAddingInmueble(true);
    setEditingInmuebleId(null);
    setInmuebleForm({ descripcion: "", direccion: "", valorEstimado: "", fechaValuacion: "", observaciones: "" });
  }, []);

  const saveInmueble = useCallback(async () => {
    if (!inmuebleForm.descripcion.trim()) return;
    setSavingInmueble(true);
    try {
      const data = {
        descripcion: inmuebleForm.descripcion.trim(),
        direccion: inmuebleForm.direccion.trim() || null,
        valorEstimado: Number(inmuebleForm.valorEstimado) || 0,
        fechaValuacion: inmuebleForm.fechaValuacion || null,
        observaciones: inmuebleForm.observaciones.trim() || null,
      };
      if (addingInmueble) {
        const created = await insertInmueble(data);
        setInmuebles((prev) => [...prev, created]);
      } else if (editingInmuebleId !== null) {
        await updateInmueble(editingInmuebleId, data);
        setInmuebles((prev) => prev.map((i) => i.id === editingInmuebleId ? { ...i, ...data } : i));
      }
      cancelEditInmueble();
    } catch {
      // stay in edit mode on error
    } finally {
      setSavingInmueble(false);
    }
  }, [inmuebleForm, addingInmueble, editingInmuebleId, cancelEditInmueble]);

  const handleDeleteInmueble = useCallback(async (id: number) => {
    if (deletingId === id) {
      // Second click = confirm
      try {
        await deleteInmueble(id);
        setInmuebles((prev) => prev.filter((i) => i.id !== id));
      } catch { /* ignore */ }
      setDeletingId(null);
    } else {
      setDeletingId(id);
      // Auto-cancel after 3 seconds
      setTimeout(() => setDeletingId((prev) => prev === id ? null : prev), 3000);
    }
  }, [deletingId]);

  // ─── Evolution + Projection per account ─────────────────────────────────
  const [expandedAccount, setExpandedAccount] = useState<string | null>(null);

  const EVOLUTION_ACCOUNTS = [
    { key: "provincia", label: "Banco Provincia", color: "#3b82f6" },
    { key: "santander", label: "Banco Santander", color: "#ef4444" },
    { key: "mercado_pago", label: "Mercado Pago", color: "#6366f1" },
    { key: "inviu", label: "InvertirOnline", color: "#22c55e" },
  ];

  // Build per-account evolution data with SMA projection
  const evolutionByAccount = useMemo(() => {
    const result = new Map<string, { label: string; periodo: string; saldo: number; projected?: boolean }[]>();

    for (const acc of EVOLUTION_ACCOUNTS) {
      const rows = evolucion
        .filter((r) => r.banco === acc.key)
        .sort((a, b) => a.periodo.localeCompare(b.periodo))
        .map((r) => ({
          label: shortLabel(r.periodo),
          periodo: r.periodo,
          saldo: r.saldo,
          projected: false,
        }));

      if (rows.length < 3) {
        result.set(acc.key, rows);
        continue;
      }

      // Simple Moving Average (last 3 months) for projection
      const lastN = rows.slice(-3);
      const smaChange = lastN.length >= 2
        ? (lastN[lastN.length - 1].saldo - lastN[0].saldo) / (lastN.length - 1)
        : 0;

      const lastSaldo = rows[rows.length - 1].saldo;
      const lastPeriodo = rows[rows.length - 1].periodo;
      const [lastY, lastM] = lastPeriodo.split("-").map(Number);

      const projMonths = ["30d", "60d", "90d"];
      const SHORT_M = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

      for (let i = 1; i <= 3; i++) {
        let nm = lastM + i;
        let ny = lastY;
        if (nm > 12) { nm -= 12; ny += 1; }
        rows.push({
          label: `${SHORT_M[nm - 1]} (proy.)`,
          periodo: `${ny}-${String(nm).padStart(2, "0")}`,
          saldo: Math.max(0, lastSaldo + smaChange * i),
          projected: true,
        });
      }

      result.set(acc.key, rows);
    }
    return result;
  }, [evolucion]);

  // Trend indicator per account
  const trendByAccount = useMemo(() => {
    const result = new Map<string, "up" | "down" | "flat">();
    for (const acc of EVOLUTION_ACCOUNTS) {
      const data = evolutionByAccount.get(acc.key) ?? [];
      const actual = data.filter((d) => !d.projected);
      if (actual.length < 2) { result.set(acc.key, "flat"); continue; }
      const last = actual[actual.length - 1].saldo;
      const prev = actual[actual.length - 2].saldo;
      const pct = prev !== 0 ? ((last - prev) / prev) * 100 : 0;
      result.set(acc.key, pct > 2 ? "up" : pct < -2 ? "down" : "flat");
    }
    return result;
  }, [evolutionByAccount]);

  // ─── Render ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-3 text-muted-foreground">Cargando datos...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-2 text-muted-foreground">
        <AlertCircle className="h-8 w-8" />
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Tesorería</h1>
        <p className="text-muted-foreground mt-1">Saldos actuales, inversiones e inmuebles</p>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* SECCIÓN 1: KPI de liquidez total                                  */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <div className="rounded-xl bg-muted/50 p-6 space-y-4">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Liquidez total disponible</p>
          <p className="text-3xl font-bold tracking-tight text-green-600">{formatARS(liquidezTotal)}</p>
          <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-muted-foreground">
            <span>Activos líquidos: <strong className="text-foreground">{formatARS(liquidezTotal)}</strong></span>
            <span>Real Estate: <strong className="text-foreground">{formatARS(inmueblesTotalValue)}</strong></span>
            <span>Total patrimonio: <strong className="text-foreground">{formatARS(liquidezTotal + inmueblesTotalValue)}</strong></span>
          </div>
        </div>

        {/* Horizontal proportion bar */}
        {liquidezTotal > 0 && (
          <div className="space-y-2">
            <div className="flex h-4 w-full overflow-hidden rounded-full">
              {ACCOUNTS.map((acc) => {
                const saldo = saldoMap[acc.key]?.saldo ?? 0;
                const pct = (saldo / liquidezTotal) * 100;
                if (pct < 0.5) return null;
                return (
                  <div key={acc.key} className="h-full first:rounded-l-full last:rounded-r-full transition-all duration-500"
                    style={{ width: `${pct}%`, backgroundColor: acc.color }}
                    title={`${acc.label}: ${formatARS(saldo)} (${pct.toFixed(1)}%)`} />
                );
              })}
            </div>
            <div className="flex flex-wrap gap-4">
              {ACCOUNTS.map((acc) => {
                const saldo = saldoMap[acc.key]?.saldo ?? 0;
                if (saldo === 0) return null;
                return (
                  <div key={acc.key} className="flex items-center gap-1.5">
                    <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: acc.color }} />
                    <span className="text-xs text-muted-foreground">{acc.label}: {((saldo / liquidezTotal) * 100).toFixed(1)}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* SECCIÓN 2: Saldos por cuenta (6 cards)                            */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {ACCOUNTS.map((acc) => {
          const info = saldoMap[acc.key];
          const saldo = info?.saldo ?? 0;
          const fecha = info?.fecha;
          const Icon = acc.icon;
          const isCaja = acc.key === "caja";
          const sparkData = sparklineData.get(acc.key);

          return (
            <Card key={acc.key} className={`border-l-4 ${acc.borderColor}`}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{acc.label}</CardTitle>
                <Icon className="h-4 w-4" style={{ color: acc.color }} />
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Saldo */}
                {isCaja && editingCaja ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-lg font-bold">$</span>
                    <input
                      type="number"
                      value={cajaInput}
                      onChange={(e) => setCajaInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveCaja(); if (e.key === "Escape") cancelEditCaja(); }}
                      className="w-full rounded border bg-background px-2 py-1 text-lg font-bold"
                      autoFocus
                    />
                    <button onClick={saveCaja} className="rounded p-1 hover:bg-accent text-green-600">
                      <Check className="h-4 w-4" />
                    </button>
                    <button onClick={cancelEditCaja} className="rounded p-1 hover:bg-accent text-red-500">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <p className="text-2xl font-bold tracking-tight">{formatARS(saldo)}</p>
                    {isCaja && (
                      <button onClick={startEditCaja} className="rounded p-1 hover:bg-accent text-muted-foreground">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                )}

                {/* Fecha */}
                <p className="text-xs text-muted-foreground">
                  {isCaja
                    ? (saldo > 0 ? "Ingresado manualmente" : "Click para editar")
                    : (fecha ? `Al ${formatFecha(fecha)}` : "Sin datos")
                  }
                </p>

                {/* Sparkline */}
                {sparkData && sparkData.length > 1 && (
                  <div className="h-12">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={sparkData}>
                        <Area
                          type="monotone"
                          dataKey="saldo"
                          stroke={acc.color}
                          fill={acc.color}
                          fillOpacity={0.1}
                          strokeWidth={1.5}
                          dot={false}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* InvertirOnline: show USD if available */}
                {acc.key === "inviu" && totalInversionesUsd > 0 && (
                  <p className="text-xs text-muted-foreground">{formatUSD(totalInversionesUsd)} USD</p>
                )}
              </CardContent>
            </Card>
          );
        })}

        {/* Real Estate card */}
        <Card className="border-l-4 border-l-pink-500">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Real Estate</CardTitle>
            <Home className="h-4 w-4 text-pink-500" />
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-2xl font-bold tracking-tight">{formatARS(inmueblesTotalValue)}</p>
            <p className="text-xs text-muted-foreground">
              {inmuebles.length > 0 ? `${inmuebles.length} ${inmuebles.length === 1 ? "propiedad" : "propiedades"}` : "Sin propiedades cargadas"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Inversiones (collapsible) */}
      {inversiones.length > 0 && (
        <Card>
          <CardHeader className="cursor-pointer" onClick={() => setInvOpen(!invOpen)}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CardTitle className="text-base">Cartera de Inversiones</CardTitle>
                <span className="text-sm font-semibold tabular-nums">{formatARS(totalInversiones)}</span>
                {fechaInversiones && <span className="text-xs text-muted-foreground">al {formatFecha(fechaInversiones)}</span>}
              </div>
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${invOpen ? "rotate-180" : ""}`} />
            </div>
          </CardHeader>
          {invOpen && (
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Ticker</TableHead>
                    <TableHead>Moneda</TableHead>
                    <TableHead className="text-right">Disponibles</TableHead>
                    <TableHead className="text-right">Valuación ARS</TableHead>
                    <TableHead className="text-right">Valuación USD</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inversiones.map((inv, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{inv.nombre}</TableCell>
                      <TableCell>{inv.ticker ?? "—"}</TableCell>
                      <TableCell>{inv.moneda}</TableCell>
                      <TableCell className="text-right tabular-nums">{inv.disponibles.toLocaleString("es-AR", { maximumFractionDigits: 4 })}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatARS(inv.valuacionMonto)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatUSD(inv.valuacionUsd)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-bold border-t-2">
                    <TableCell colSpan={4}>Total</TableCell>
                    <TableCell className="text-right tabular-nums">{formatARS(totalInversiones)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatUSD(totalInversionesUsd)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </CardContent>
          )}
        </Card>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* SECCIÓN 3: Inmuebles (editable)                                   */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Inmuebles</CardTitle>
            <button
              onClick={startAddInmueble}
              disabled={addingInmueble}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              Agregar inmueble
            </button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[180px]">Descripción</TableHead>
                  <TableHead className="min-w-[160px]">Dirección</TableHead>
                  <TableHead className="text-right min-w-[140px]">Valor estimado ($)</TableHead>
                  <TableHead className="min-w-[130px]">Fecha valuación</TableHead>
                  <TableHead className="min-w-[160px]">Observaciones</TableHead>
                  <TableHead className="w-[100px]">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inmuebles.map((inm) => {
                  const isEditing = editingInmuebleId === inm.id;

                  if (isEditing) {
                    return (
                      <TableRow key={inm.id} className="bg-muted/30">
                        <TableCell>
                          <input
                            value={inmuebleForm.descripcion}
                            onChange={(e) => setInmuebleForm((f) => ({ ...f, descripcion: e.target.value }))}
                            className="w-full rounded border bg-background px-2 py-1 text-sm"
                            placeholder="Descripción *"
                            autoFocus
                          />
                        </TableCell>
                        <TableCell>
                          <input
                            value={inmuebleForm.direccion}
                            onChange={(e) => setInmuebleForm((f) => ({ ...f, direccion: e.target.value }))}
                            className="w-full rounded border bg-background px-2 py-1 text-sm"
                            placeholder="Dirección"
                          />
                        </TableCell>
                        <TableCell>
                          <input
                            type="number"
                            value={inmuebleForm.valorEstimado}
                            onChange={(e) => setInmuebleForm((f) => ({ ...f, valorEstimado: e.target.value }))}
                            className="w-full rounded border bg-background px-2 py-1 text-sm text-right"
                            placeholder="0"
                          />
                        </TableCell>
                        <TableCell>
                          <input
                            type="date"
                            value={inmuebleForm.fechaValuacion}
                            onChange={(e) => setInmuebleForm((f) => ({ ...f, fechaValuacion: e.target.value }))}
                            className="w-full rounded border bg-background px-2 py-1 text-sm"
                          />
                        </TableCell>
                        <TableCell>
                          <input
                            value={inmuebleForm.observaciones}
                            onChange={(e) => setInmuebleForm((f) => ({ ...f, observaciones: e.target.value }))}
                            className="w-full rounded border bg-background px-2 py-1 text-sm"
                            placeholder="Notas"
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <button onClick={saveInmueble} disabled={savingInmueble} className="rounded p-1 hover:bg-accent text-green-600">
                              {savingInmueble ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                            </button>
                            <button onClick={cancelEditInmueble} className="rounded p-1 hover:bg-accent text-red-500">
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  }

                  return (
                    <TableRow key={inm.id}>
                      <TableCell className="font-medium">{inm.descripcion}</TableCell>
                      <TableCell className="text-sm">{inm.direccion ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatARS(inm.valorEstimado)}</TableCell>
                      <TableCell className="text-sm">{inm.fechaValuacion ? formatFecha(inm.fechaValuacion) : "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{inm.observaciones ?? "—"}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <button onClick={() => startEditInmueble(inm)} className="rounded p-1 hover:bg-accent text-muted-foreground">
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteInmueble(inm.id)}
                            className={`rounded p-1 hover:bg-accent ${deletingId === inm.id ? "text-red-600" : "text-muted-foreground"}`}
                            title={deletingId === inm.id ? "Click de nuevo para confirmar" : "Eliminar"}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}

                {/* Add new row */}
                {addingInmueble && (
                  <TableRow className="bg-muted/30">
                    <TableCell>
                      <input
                        value={inmuebleForm.descripcion}
                        onChange={(e) => setInmuebleForm((f) => ({ ...f, descripcion: e.target.value }))}
                        className="w-full rounded border bg-background px-2 py-1 text-sm"
                        placeholder="Descripción *"
                        autoFocus
                      />
                    </TableCell>
                    <TableCell>
                      <input
                        value={inmuebleForm.direccion}
                        onChange={(e) => setInmuebleForm((f) => ({ ...f, direccion: e.target.value }))}
                        className="w-full rounded border bg-background px-2 py-1 text-sm"
                        placeholder="Dirección"
                      />
                    </TableCell>
                    <TableCell>
                      <input
                        type="number"
                        value={inmuebleForm.valorEstimado}
                        onChange={(e) => setInmuebleForm((f) => ({ ...f, valorEstimado: e.target.value }))}
                        className="w-full rounded border bg-background px-2 py-1 text-sm text-right"
                        placeholder="0"
                      />
                    </TableCell>
                    <TableCell>
                      <input
                        type="date"
                        value={inmuebleForm.fechaValuacion}
                        onChange={(e) => setInmuebleForm((f) => ({ ...f, fechaValuacion: e.target.value }))}
                        className="w-full rounded border bg-background px-2 py-1 text-sm"
                      />
                    </TableCell>
                    <TableCell>
                      <input
                        value={inmuebleForm.observaciones}
                        onChange={(e) => setInmuebleForm((f) => ({ ...f, observaciones: e.target.value }))}
                        className="w-full rounded border bg-background px-2 py-1 text-sm"
                        placeholder="Notas"
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <button onClick={saveInmueble} disabled={savingInmueble || !inmuebleForm.descripcion.trim()} className="rounded p-1 hover:bg-accent text-green-600 disabled:opacity-50">
                          {savingInmueble ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                        </button>
                        <button onClick={cancelEditInmueble} className="rounded p-1 hover:bg-accent text-red-500">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                )}

                {/* Empty state */}
                {inmuebles.length === 0 && !addingInmueble && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      No hay inmuebles registrados. Click en &quot;Agregar inmueble&quot; para empezar.
                    </TableCell>
                  </TableRow>
                )}

                {/* Total row */}
                {inmuebles.length > 0 && (
                  <TableRow className="font-bold border-t-2">
                    <TableCell colSpan={2}>Total</TableCell>
                    <TableCell className="text-right tabular-nums">{formatARS(inmueblesTotalValue)}</TableCell>
                    <TableCell colSpan={3} />
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* SECCIÓN 4: Evolución y proyección por cuenta                      */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {evolucion.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Evolución y proyección por cuenta</CardTitle>
            <p className="text-sm text-muted-foreground">
              Saldo mensual + proyección a 90 días (media móvil simple)
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {EVOLUTION_ACCOUNTS.map((acc) => {
              const data = evolutionByAccount.get(acc.key) ?? [];
              const isOpen = expandedAccount === acc.key;
              const trend = trendByAccount.get(acc.key) ?? "flat";
              const TrendIcon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;
              const trendColor = trend === "up" ? "text-green-600" : trend === "down" ? "text-red-600" : "text-muted-foreground";
              const lastActual = data.filter((d) => !d.projected);
              const currentSaldo = lastActual.length > 0 ? lastActual[lastActual.length - 1].saldo : 0;

              if (data.length === 0) return null;

              return (
                <div key={acc.key} className="rounded-lg border overflow-hidden">
                  {/* Accordion header */}
                  <button
                    onClick={() => setExpandedAccount(isOpen ? null : acc.key)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-3 w-3 rounded-full" style={{ backgroundColor: acc.color }} />
                      <span className="font-medium text-sm">{acc.label}</span>
                      <TrendIcon className={`h-4 w-4 ${trendColor}`} />
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-sm tabular-nums">{formatARS(currentSaldo)}</span>
                      <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
                    </div>
                  </button>

                  {/* Accordion body */}
                  {isOpen && (
                    <div className="px-4 pb-4 pt-2">
                      <ResponsiveContainer width="100%" height={280}>
                        <LineChart data={data}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                          <XAxis dataKey="label" fontSize={11} tickLine={false} />
                          <YAxis fontSize={10} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} tickLine={false} />
                          <Tooltip
                            formatter={arsTooltip}
                            labelFormatter={(label) => String(label)}
                          />
                          <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                          {/* Actual data line */}
                          <Line
                            type="monotone"
                            dataKey="saldo"
                            name="Saldo"
                            stroke={acc.color}
                            strokeWidth={2}
                            dot={(props: Record<string, unknown>) => {
                              const { cx, cy, payload } = props as { cx: number; cy: number; payload: { projected?: boolean } };
                              if (payload?.projected) return <g key={`dot-${cx}`} />;
                              return (
                                <circle
                                  key={`dot-${cx}`}
                                  cx={cx}
                                  cy={cy}
                                  r={3}
                                  fill={acc.color}
                                  stroke="white"
                                  strokeWidth={1.5}
                                />
                              );
                            }}
                            strokeDasharray={undefined}
                          />
                          {/* Projected overlay — we draw a second line for projected points */}
                          {data.some((d) => d.projected) && (
                            <Line
                              type="monotone"
                              data={data.filter((d, i) => d.projected || (i === data.filter(x => !x.projected).length - 1))}
                              dataKey="saldo"
                              name="Proyección"
                              stroke={acc.color}
                              strokeWidth={2}
                              strokeDasharray="6 4"
                              dot={false}
                              connectNulls
                            />
                          )}
                        </LineChart>
                      </ResponsiveContainer>

                      {/* Projection summary */}
                      {data.some((d) => d.projected) && (
                        <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
                          {data.filter((d) => d.projected).map((d, i) => (
                            <div key={i} className="flex items-center gap-1.5">
                              <span className="font-medium">{d.label}:</span>
                              <span className="tabular-nums">{formatARS(d.saldo)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
