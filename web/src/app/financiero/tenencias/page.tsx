"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Landmark,
  Banknote,
  Wallet,
  CreditCard,
  TrendingUp,
  Building2,
  Loader2,
  AlertCircle,
  RefreshCw,
  Pencil,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  type SaldoCuenta,
  type SaldoManual,
  fetchSaldosCuentas,
  fetchSaldoManual,
  insertSaldoManual,
  formatARS,
} from "@/lib/financial-queries";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatUSD(n: number): string {
  return n.toLocaleString("es-AR", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function formatFecha(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** Parse Argentine or standard number input: "1.234.567,50" or "1234567.50" */
function parseSaldoInput(raw: string): number {
  // If it contains both dot and comma, dots are thousands separators
  const hasDotAndComma = raw.includes(".") && raw.includes(",");
  let cleaned = raw;
  if (hasDotAndComma) {
    cleaned = raw.replace(/\./g, "").replace(",", ".");
  } else {
    cleaned = raw.replace(",", ".");
  }
  return parseFloat(cleaned);
}

// ---------------------------------------------------------------------------
// Display constants
// ---------------------------------------------------------------------------

const CUENTA_ICON: Record<string, React.ElementType> = {
  inviu:        Wallet,
  santander:    Landmark,
  provincia:    Building2,
  mercado_pago: CreditCard,
  caja:         Banknote,
};

const CUENTA_COLOR: Record<string, string> = {
  inviu:        "border-l-blue-500",
  santander:    "border-l-red-500",
  provincia:    "border-l-sky-500",
  mercado_pago: "border-l-cyan-500",
  caja:         "border-l-amber-500",
};

// ---------------------------------------------------------------------------
// Generic cuenta card (Inviu, Santander, Provincia, Mercado Pago)
// ---------------------------------------------------------------------------

function CuentaCard({ c }: { c: SaldoCuenta }) {
  const Icon = CUENTA_ICON[c.cuenta] ?? Landmark;
  const colorClass = CUENTA_COLOR[c.cuenta] ?? "border-l-gray-400";

  return (
    <Card className={`border-l-4 ${colorClass}`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base font-semibold">{c.nombre}</CardTitle>
        <Icon className="h-5 w-5 text-muted-foreground" />
      </CardHeader>
      <CardContent className="space-y-1">
        {c.hasData ? (
          <>
            <p className="text-3xl font-bold">{formatARS(c.saldoArs)}</p>
            {c.saldoUsd != null && c.saldoUsd > 0 && (
              <p className="text-sm text-muted-foreground">{formatUSD(c.saldoUsd)} USD</p>
            )}
            <p className="text-xs text-muted-foreground">
              Último dato: {formatFecha(c.fechaDato)}
            </p>
          </>
        ) : (
          <div className="flex items-center gap-2 py-2">
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Sin datos</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Caja card — manual balance entry
// ---------------------------------------------------------------------------

function CajaCard({
  saldo,
  onSaved,
}: {
  saldo: SaldoManual | null;
  onSaved: (nuevo: SaldoManual) => void;
}) {
  const [open, setOpen] = useState(false);
  const [saldoInput, setSaldoInput] = useState("");
  const [fechaInput, setFechaInput] = useState(() => new Date().toISOString().slice(0, 10));
  const [notaInput, setNotaInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function openModal() {
    // Pre-fill with last known value
    setSaldoInput(saldo ? String(saldo.saldo) : "");
    setFechaInput(saldo?.fecha ?? new Date().toISOString().slice(0, 10));
    setNotaInput(saldo?.nota ?? "");
    setSaveError(null);
    setOpen(true);
  }

  async function handleSave() {
    const monto = parseSaldoInput(saldoInput);
    if (isNaN(monto) || monto < 0) {
      setSaveError("Ingresá un monto válido (ej: 150000 o 150.000,00)");
      return;
    }
    if (!fechaInput) {
      setSaveError("Seleccioná una fecha");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await insertSaldoManual("caja", monto, fechaInput, notaInput);
      onSaved({ id: Date.now(), cuenta: "caja", saldo: monto, fecha: fechaInput, nota: notaInput.trim() || null });
      setOpen(false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Card className="border-l-4 border-l-amber-500">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-base font-semibold">Caja (Efectivo)</CardTitle>
          <div className="flex items-center gap-2">
            <button
              onClick={openModal}
              title="Actualizar saldo de caja"
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Pencil className="h-4 w-4" />
            </button>
            <Banknote className="h-5 w-5 text-muted-foreground" />
          </div>
        </CardHeader>
        <CardContent className="space-y-1">
          {saldo ? (
            <>
              <p className="text-3xl font-bold">{formatARS(saldo.saldo)}</p>
              <p className="text-xs text-muted-foreground">
                Registrado el {formatFecha(saldo.fecha)}
              </p>
              {saldo.nota && (
                <p className="text-xs text-muted-foreground italic">{saldo.nota}</p>
              )}
            </>
          ) : (
            <div className="flex items-center gap-2 py-2">
              <AlertCircle className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Sin dato —{" "}
                <button
                  onClick={openModal}
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  ingresá el saldo
                </button>
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Saldo de Caja</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Saldo ($)</label>
              <Input
                type="text"
                inputMode="decimal"
                placeholder="ej: 150000"
                value={saldoInput}
                onChange={(e) => setSaldoInput(e.target.value)}
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Fecha del recuento</label>
              <Input
                type="date"
                value={fechaInput}
                onChange={(e) => setFechaInput(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Nota <span className="text-muted-foreground font-normal">(opcional)</span>
              </label>
              <Input
                type="text"
                placeholder="ej: arqueo mensual"
                value={notaInput}
                onChange={(e) => setNotaInput(e.target.value)}
              />
            </div>

            {saveError && (
              <p className="text-sm text-red-600">{saveError}</p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const ORDER = ["inviu", "santander", "provincia", "mercado_pago", "caja"];

export default function TenenciasPage() {
  const [cuentas, setCuentas] = useState<SaldoCuenta[]>([]);
  const [saldoCaja, setSaldoCaja] = useState<SaldoManual | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    Promise.all([fetchSaldosCuentas(), fetchSaldoManual("caja")])
      .then(([cuentasData, cajaData]) => {
        setCuentas(cuentasData);
        setSaldoCaja(cajaData);
      })
      .catch((e) => setError(e.message ?? "Error"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Replace caja's saldoArs/fechaDato with the manual value for the total
  const cuentasConCaja = useMemo<SaldoCuenta[]>(() => {
    return cuentas.map((c) => {
      if (c.cuenta !== "caja") return c;
      if (!saldoCaja) return { ...c, saldoArs: 0, fechaDato: null, hasData: false };
      return { ...c, saldoArs: saldoCaja.saldo, fechaDato: saldoCaja.fecha, hasData: true };
    });
  }, [cuentas, saldoCaja]);

  const sorted = useMemo(
    () => [...cuentasConCaja].sort((a, b) => ORDER.indexOf(a.cuenta) - ORDER.indexOf(b.cuenta)),
    [cuentasConCaja],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-3 text-muted-foreground">Cargando saldos…</span>
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-8">
          <AlertCircle className="h-5 w-5 text-red-500" />
          <div>
            <p className="font-medium">Error al cargar saldos</p>
            <p className="text-sm text-muted-foreground">{error}</p>
            <button
              onClick={load}
              className="mt-3 inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <RefreshCw className="h-4 w-4" />
              Reintentar
            </button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const total = sorted.reduce((s, c) => s + (c.hasData ? c.saldoArs : 0), 0);
  const totalUsd = sorted.reduce((s, c) => s + (c.saldoUsd ?? 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Tenencias</h1>
        <p className="text-muted-foreground">Saldo actual por cuenta financiera</p>
      </div>

      {/* Cuenta cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {sorted.map((c) =>
          c.cuenta === "caja" ? (
            <CajaCard
              key="caja"
              saldo={saldoCaja}
              onSaved={(nuevo) => setSaldoCaja(nuevo)}
            />
          ) : (
            <CuentaCard key={c.cuenta} c={c} />
          ),
        )}
      </div>

      {/* Total consolidado */}
      <Card className="border-2">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-base font-semibold">Total Consolidado</CardTitle>
          <TrendingUp className="h-5 w-5 text-muted-foreground" />
        </CardHeader>
        <CardContent className="space-y-1">
          <p className="text-3xl font-bold">{formatARS(total)}</p>
          {totalUsd > 0 && (
            <p className="text-sm text-muted-foreground">
              Incluye {formatUSD(totalUsd)} USD en cartera de inversiones
            </p>
          )}
          <div className="mt-3 space-y-1">
            {sorted.filter((c) => c.hasData).map((c) => (
              <div key={c.cuenta} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{c.nombre}</span>
                <span className="font-medium">
                  {formatARS(c.saldoArs)}
                  {total > 0 && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {((c.saldoArs / total) * 100).toFixed(1)}%
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
