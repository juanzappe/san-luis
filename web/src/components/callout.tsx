"use client";

import { useState, type ReactNode } from "react";
import { Info, ChevronDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Callout colapsable con borde izquierdo destacado.
 * Usado en la mayoría de las páginas de /economico para explicar qué
 * significa cada KPI y las convenciones de cálculo.
 */
export function Callout({
  title = "Cómo leer esta página",
  defaultCollapsed = false,
  children,
}: {
  title?: string;
  defaultCollapsed?: boolean;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <Card className="border-l-4 border-l-primary">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div className="flex items-center gap-2">
          <Info className="h-4 w-4 shrink-0 text-primary" />
          <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        </div>
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          aria-label={collapsed ? "Expandir explicación" : "Colapsar explicación"}
          aria-expanded={!collapsed}
        >
          <ChevronDown
            className={`h-4 w-4 shrink-0 transition-transform duration-200 ${collapsed ? "-rotate-90" : ""}`}
          />
        </button>
      </CardHeader>
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
          collapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
        }`}
      >
        <div className="overflow-hidden">
          <CardContent className="pt-0 text-sm space-y-2">{children}</CardContent>
        </div>
      </div>
    </Card>
  );
}
