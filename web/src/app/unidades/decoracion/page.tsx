"use client";

import { Palette } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function DecoracionPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Decoración</h1>
        <p className="text-muted-foreground">Dashboard de la unidad Decoración</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Palette className="h-5 w-5 text-muted-foreground" />
            Unidad en construcción
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            La unidad de Decoración no tiene datos diferenciados en el sistema POS ni en facturación.
            Para habilitar este dashboard, es necesario identificar las ventas de decoración
            mediante una categoría de producto o familia específica en el punto de venta.
          </p>
          <div className="mt-4 rounded-lg border border-dashed p-6 text-center text-muted-foreground text-sm">
            Pendiente de configuración en el sistema POS
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
