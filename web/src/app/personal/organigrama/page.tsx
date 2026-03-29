"use client";

import { useEffect, useState } from "react";
import { Users, Loader2, AlertCircle } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type OrgEmpleado, fetchEmpleadosByPuesto } from "@/lib/personal-queries";

export default function OrganigramaPage() {
  const [groups, setGroups] = useState<Map<string, OrgEmpleado[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchEmpleadosByPuesto()
      .then(setGroups)
      .catch((e) => setError(e.message ?? "Error"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-3 text-muted-foreground">Cargando datos…</span>
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
  if (groups.size === 0) {
    return (
      <Card><CardContent className="py-8 text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-3 font-medium">Sin empleados activos</p>
        <p className="text-sm text-muted-foreground">Importá datos de empleados para ver el organigrama.</p>
      </CardContent></Card>
    );
  }

  const entries = Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length);
  const totalEmpleados = entries.reduce((s, [, emps]) => s + emps.length, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Organigrama</h1>
          <p className="text-muted-foreground">Empleados activos agrupados por puesto</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Users className="h-4 w-4" />
          {totalEmpleados} empleados activos
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {entries.map(([puesto, emps]) => (
          <Card key={puesto}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{puesto}</CardTitle>
                <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {emps.length}
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {emps.map((e) => (
                  <li key={e.id} className="flex items-center gap-2 text-sm">
                    <span className="h-2 w-2 rounded-full bg-green-500" />
                    {e.nombre}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
