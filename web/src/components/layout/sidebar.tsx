"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  BarChart3,
  Wallet,
  Users,
  Megaphone,
  Calculator,
  Receipt,
  Building2,
  LayoutDashboard,
  Briefcase,
  Database,
  Upload,
  TrendingUp,
  ChevronDown,
  Home,
} from "lucide-react";
import { useState } from "react";

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  children?: { label: string; href: string }[];
}

const navigation: NavItem[] = [
  { label: "Inicio", href: "/", icon: Home },
  {
    label: "Económicos",
    href: "/economico",
    icon: BarChart3,
    children: [
      { label: "Estado de Resultados", href: "/economico/estado-resultados" },
      { label: "Ingresos", href: "/economico/ingresos" },
      { label: "Egresos", href: "/economico/egresos" },
      { label: "Ventas", href: "/economico/ventas" },
      { label: "Balance", href: "/economico/balance" },
      { label: "Indicadores", href: "/economico/indicadores" },
    ],
  },
  {
    label: "Financieros",
    href: "/financiero",
    icon: Wallet,
    children: [
      { label: "Flujo de Fondos", href: "/financiero/flujo-fondos" },
      { label: "Tenencias", href: "/financiero/tenencias" },
      { label: "Inversiones", href: "/financiero/inversiones" },
      { label: "Cuentas por Cobrar", href: "/financiero/cuentas-cobrar" },
      { label: "Cuentas por Pagar", href: "/financiero/cuentas-pagar" },
    ],
  },
  {
    label: "Personal",
    href: "/personal",
    icon: Users,
    children: [
      { label: "Nómina", href: "/personal/nomina" },
      { label: "Empleados", href: "/personal/empleados" },
      { label: "Cargas Sociales", href: "/personal/cargas-sociales" },
      { label: "Organigrama", href: "/personal/organigrama" },
    ],
  },
  {
    label: "Comercial",
    href: "/comercial",
    icon: Megaphone,
    children: [
      { label: "Clientes", href: "/comercial/clientes" },
      { label: "Proveedores", href: "/comercial/proveedores" },
      { label: "Segmentación", href: "/comercial/segmentacion" },
      { label: "Marketing", href: "/comercial/marketing" },
    ],
  },
  { label: "Costos", href: "/costos", icon: Calculator },
  {
    label: "Impuestos",
    href: "/impuestos",
    icon: Receipt,
    children: [
      { label: "Resumen Fiscal", href: "/impuestos/resumen" },
      { label: "Posición IVA", href: "/impuestos/iva" },
      { label: "Pagos", href: "/impuestos/pagos" },
      { label: "Calendario", href: "/impuestos/calendario" },
    ],
  },
  {
    label: "Unidades de Negocio",
    href: "/unidades",
    icon: Building2,
    children: [
      { label: "Servicios", href: "/unidades/servicios" },
      { label: "Mostrador", href: "/unidades/mostrador" },
      { label: "Terraza", href: "/unidades/terraza" },
      { label: "Decoración", href: "/unidades/decoracion" },
    ],
  },
  { label: "Datos del Negocio", href: "/datos-negocio", icon: Briefcase },
  { label: "Datasets", href: "/datasets", icon: Database },
  { label: "Importar", href: "/importar", icon: Upload },
  { label: "Indicadores Macro", href: "/macro", icon: TrendingUp },
];

function NavGroup({ item }: { item: NavItem }) {
  const pathname = usePathname();
  const isActive =
    pathname === item.href || pathname.startsWith(item.href + "/");
  const [open, setOpen] = useState(isActive);
  const Icon = item.icon;

  if (!item.children) {
    return (
      <Link
        href={item.href}
        className={cn(
          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
          isActive
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        )}
      >
        <Icon className="h-4 w-4" />
        {item.label}
      </Link>
    );
  }

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
          isActive
            ? "bg-accent text-accent-foreground font-medium"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        )}
      >
        <Icon className="h-4 w-4" />
        <span className="flex-1 text-left">{item.label}</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 transition-transform",
            open && "rotate-180"
          )}
        />
      </button>
      {open && (
        <div className="ml-4 mt-1 space-y-1 border-l pl-4">
          {item.children.map((child) => {
            const childActive = pathname === child.href;
            return (
              <Link
                key={child.href}
                href={child.href}
                className={cn(
                  "block rounded-lg px-3 py-1.5 text-sm transition-colors",
                  childActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                {child.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r bg-card lg:flex">
      <div className="flex h-16 items-center gap-2 border-b px-6">
        <LayoutDashboard className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-sm font-bold leading-none">San Luis</h1>
          <p className="text-xs text-muted-foreground">Gestión Empresarial</p>
        </div>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-4">
        {navigation.map((item) => (
          <NavGroup key={item.href} item={item} />
        ))}
      </nav>
      <div className="border-t p-4">
        <p className="text-xs text-muted-foreground">
          Nadal y Zaccaro S.A.
        </p>
      </div>
    </aside>
  );
}
