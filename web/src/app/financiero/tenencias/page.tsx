"use client";

import { useEffect, useState } from "react";
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
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type SaldoCuenta,
  fetchSaldosCuentas,
  formatARS,
} from "@/lib/financial-queries";

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

export default function TenenciasPage() {
  const [cuentas, setCuentas] = useState<SaldoCuenta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    fetchSaldosCuentas()
      .then(setCuentas)
      .catch((e) => setError(e.message ?? "Error"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const total = cuentas.reduce((s, c) => s + (c.hasData ? c.saldoArs : 0), 0);
  const totalUsd = cuentas.reduce((s, c) => s + (c.saldoUsd ?? 0), 0);

  // Order: inviu, santander, provincia, mercado_pago, caja
  const ORDER = ["inviu", "santander", "provincia", "mercado_pago", "caja"];
  const sorted = [...cuentas].sort(
    (a, b) => ORDER.indexOf(a.cuenta) - ORDER.indexOf(b.cuenta),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Tenencias</h1>
        <p className="text-muted-foreground">Saldo actual por cuenta financiera</p>
      </div>

      {/* Cuenta cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {sorted.map((c) => (
          <CuentaCard key={c.cuenta} c={c} />
        ))}
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
