import Dashboard from "@/components/dashboard";

export default function HomePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Resumen Ejecutivo
        </h1>
        <p className="text-muted-foreground">
          Confitería San Luis — Nadal y Zaccaro S.A.
        </p>
      </div>

      <Dashboard />
    </div>
  );
}
