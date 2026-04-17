"use client";

import { useEffect, useState } from "react";
import { EgresoDetailPage } from "@/components/egreso-detail-page";
import { Callout } from "@/components/callout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  type EgresoRow,
  type EstadoResultadosContableRow,
  TASA_GANANCIAS,
  computeTasasEfectivasFromEECC,
  fetchEstadoResultadosContable,
  formatARS,
} from "@/lib/economic-queries";

/**
 * Card que muestra las tasas efectivas históricas del Impuesto a las Ganancias
 * derivadas de los EECC auditados — para ver de dónde sale el 36,7% usado.
 */
function TasasEfectivasCard() {
  const [eecc, setEecc] = useState<EstadoResultadosContableRow[] | null>(null);

  useEffect(() => {
    fetchEstadoResultadosContable().then(setEecc).catch(() => setEecc([]));
  }, []);

  if (!eecc) return null;
  const { porEjercicio, promedio, fuente } = computeTasasEfectivasFromEECC(eecc);
  const years = Object.keys(porEjercicio).sort();
  if (years.length === 0 && fuente === "fallback") return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Tasa efectiva histórica — derivada de EECC</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ejercicio</TableHead>
              <TableHead className="text-right">Impuesto</TableHead>
              <TableHead className="text-right">Res. antes Imp.</TableHead>
              <TableHead className="text-right">Tasa efectiva</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {years.map((y) => {
              // Buscar en eecc las líneas correspondientes para mostrar montos
              const impuestoLine = eecc.find(
                (r) => r.ejercicio === y && r.linea.toLowerCase().includes("impuesto a las ganancias"),
              );
              const resLine = eecc.find(
                (r) => r.ejercicio === y && r.linea.toLowerCase().includes("resultado antes del impuesto"),
              );
              const tasa = porEjercicio[y];
              return (
                <TableRow key={y}>
                  <TableCell className="font-medium">{y}</TableCell>
                  <TableCell className="text-right">{impuestoLine ? formatARS(Math.abs(impuestoLine.monto)) : "—"}</TableCell>
                  <TableCell className="text-right">{resLine ? formatARS(resLine.monto) : "—"}</TableCell>
                  <TableCell className="text-right font-medium">{(tasa * 100).toFixed(1)}%</TableCell>
                </TableRow>
              );
            })}
            <TableRow className="border-t-2 border-foreground/20">
              <TableCell className="font-bold">Promedio últimos 2 años</TableCell>
              <TableCell />
              <TableCell />
              <TableCell className="text-right font-bold">{(promedio * 100).toFixed(1)}%</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">Tasa usada por esta estimación</TableCell>
              <TableCell />
              <TableCell />
              <TableCell className="text-right text-muted-foreground">{(TASA_GANANCIAS * 100).toFixed(1)}%</TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <p className="mt-3 text-xs text-muted-foreground">
          La tasa usada en esta página ({(TASA_GANANCIAS * 100).toFixed(1)}%) es el promedio 2023-2024 de los EECC auditados.
          Cuando se carguen más ejercicios, este promedio se puede actualizar (hoy requiere ajustar
          <code className="mx-1">TASA_GANANCIAS</code> en <code>src/lib/economic-queries.ts</code>).
        </p>
      </CardContent>
    </Card>
  );
}

export default function ImpuestoGananciasPage() {
  return (
    <EgresoDetailPage
      title="Imp. a las Ganancias"
      subtitle="Devengado — estimado al 36,7% sobre resultado antes de ganancias ajustado por RECPAM"
      callout={
        <Callout>
          <p>
            Estimación del impuesto a las ganancias <strong>devengado</strong> en el mes — NO lo que se paga
            (los anticipos y el saldo final van por otro lado).
          </p>
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
            <li>
              Se calcula como <strong className="text-foreground">{(TASA_GANANCIAS * 100).toFixed(1)}%</strong>
              {" "}(tasa efectiva promedio derivada de los EECC auditados 2023-2024)
              sobre <em>resultado antes de Ganancias − RECPAM</em>. La derivación se muestra abajo.
            </li>
            <li>
              <strong className="text-foreground">Mensual</strong>: si el resultado del mes es negativo, ganancias = 0
              (no hay reintegro). Por eso los totales anuales <strong>no</strong> son la suma de los meses.
            </li>
            <li>
              <strong className="text-foreground">Trimestral / Anual</strong>: se recalcula sobre la base acumulada
              (suma de <em>resultado antes de Ganancias − RECPAM</em> del período) para evitar inflar la tasa efectiva.
            </li>
            <li>
              No contempla diferencias temporarias ni ajuste por inflación impositiva AFIP.
            </li>
          </ul>
        </Callout>
      }
      extractValue={(r: EgresoRow) => r.ganancias}
      aggregateValue={(rows: EgresoRow[]) => {
        const totalBase = rows.reduce((sum, r) => sum + r.gananciasBase, 0);
        return totalBase > 0 ? totalBase * TASA_GANANCIAS : 0;
      }}
    >
      <TasasEfectivasCard />
    </EgresoDetailPage>
  );
}
