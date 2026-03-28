"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

interface ConnectionStatus {
  connected: boolean;
  error: string | null;
  tables: { name: string; count: number }[];
}

export default function EconomicoPage() {
  const [status, setStatus] = useState<ConnectionStatus>({
    connected: false,
    error: null,
    tables: [],
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function testConnection() {
      try {
        // Intentar leer las tablas principales del módulo económico
        const tablesToCheck = [
          "venta",
          "egreso",
          "factura_emitida",
          "factura_recibida",
          "unidad_negocio",
          "categoria_egreso",
        ];

        const results: { name: string; count: number }[] = [];

        for (const table of tablesToCheck) {
          const { count, error } = await supabase
            .from(table)
            .select("*", { count: "exact", head: true });

          if (error) throw error;
          results.push({ name: table, count: count ?? 0 });
        }

        setStatus({ connected: true, error: null, tables: results });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Error desconocido";
        setStatus({ connected: false, error: message, tables: [] });
      } finally {
        setLoading(false);
      }
    }

    testConnection();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Económicos</h1>
        <p className="text-muted-foreground">
          Estado de Resultados, Ventas, Egresos, Balance, Indicadores
        </p>
      </div>

      {/* Test de conexión a Supabase */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Test de Conexión a Supabase
            {loading ? (
              <Badge variant="outline">Conectando...</Badge>
            ) : status.connected ? (
              <Badge className="bg-green-600">Conectado</Badge>
            ) : (
              <Badge variant="destructive">Error</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading && (
            <p className="text-sm text-muted-foreground">
              Verificando conexión con la base de datos...
            </p>
          )}

          {!loading && status.error && (
            <div className="space-y-2">
              <p className="text-sm text-destructive">{status.error}</p>
              <p className="text-sm text-muted-foreground">
                Verificá que las variables de entorno en{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">
                  .env.local
                </code>{" "}
                estén correctamente configuradas:
              </p>
              <pre className="rounded-lg bg-muted p-4 text-xs">
                {`NEXT_PUBLIC_SUPABASE_URL=https://tu-proyecto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu-anon-key`}
              </pre>
            </div>
          )}

          {!loading && status.connected && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Conexión exitosa. Tablas del módulo económico:
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tabla</TableHead>
                    <TableHead className="text-right">Registros</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {status.tables.map((t) => (
                    <TableRow key={t.name}>
                      <TableCell className="font-mono text-sm">
                        {t.name}
                      </TableCell>
                      <TableCell className="text-right">{t.count}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Links a submódulos */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {[
          {
            title: "Estado de Resultados",
            href: "/economico/estado-resultados",
            desc: "Calculado automáticamente desde datos operativos",
          },
          {
            title: "Ventas",
            href: "/economico/ventas",
            desc: "Por unidad de negocio, categoría y período",
          },
          {
            title: "Egresos",
            href: "/economico/egresos",
            desc: "Consolidados por categoría y fuente",
          },
          {
            title: "Balance",
            href: "/economico/balance",
            desc: "Balance general del contador",
          },
          {
            title: "Indicadores",
            href: "/economico/indicadores",
            desc: "Rentabilidad, liquidez, endeudamiento",
          },
        ].map((item) => (
          <Card key={item.href} className="hover:bg-accent/50 transition-colors">
            <a href={item.href}>
              <CardHeader>
                <CardTitle className="text-base">{item.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{item.desc}</p>
              </CardContent>
            </a>
          </Card>
        ))}
      </div>
    </div>
  );
}
