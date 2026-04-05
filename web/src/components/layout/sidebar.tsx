"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Wallet,
  Users,
  Building2,
  LayoutDashboard,
  Database,
  Upload,
  TrendingUp,
  ChevronDown,
  Home,
  FileText,
  Globe,
} from "lucide-react";
import { useState } from "react";

interface NavLeaf {
  label: string;
  href: string;
}

interface NavChild {
  label: string;
  href: string;
  children?: NavLeaf[];
}

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  children?: NavChild[];
}

const navigation: NavItem[] = [
  { label: "Inicio", href: "/", icon: Home },
  {
    label: "Económicos",
    href: "/economico",
    icon: TrendingUp,
    children: [
      { label: "Estado de Resultados", href: "/economico/estado-resultados" },
      {
        label: "Ingresos",
        href: "/economico/ingresos",
        children: [
          { label: "Servicios", href: "/economico/ingresos/servicios" },
          { label: "Mostrador", href: "/economico/ingresos/mostrador" },
          { label: "Restobar", href: "/economico/ingresos/restobar" },
        ],
      },
      {
        label: "Egresos",
        href: "/economico/egresos",
        children: [
          { label: "Costos Operativos", href: "/economico/egresos/costos-operativos" },
          { label: "Sueldos", href: "/economico/egresos/sueldos" },
          { label: "Gastos Comerciales", href: "/economico/egresos/gastos-comerciales" },
          { label: "Gastos Financieros", href: "/economico/egresos/gastos-financieros" },
          { label: "Imp. a las Ganancias", href: "/economico/egresos/impuesto-ganancias" },
        ],
      },
    ],
  },
  {
    label: "Financieros",
    href: "/financiero",
    icon: Wallet,
    children: [
      { label: "Flujo de Fondos", href: "/financiero/flujo-fondos" },
      { label: "Tenencias", href: "/financiero/tenencias" },
      { label: "Cuentas por Pagar", href: "/financiero/cuentas-pagar" },
      { label: "Cuentas por Cobrar", href: "/financiero/cuentas-cobrar" },
    ],
  },
  {
    label: "Comercial",
    href: "/comercial",
    icon: Users,
    children: [
      { label: "Clientes", href: "/comercial/clientes" },
      { label: "Proveedores", href: "/comercial/proveedores" },
    ],
  },
  { label: "Datos del Negocio", href: "/datos-negocio", icon: Building2 },
  {
    label: "EECC",
    href: "/eecc",
    icon: FileText,
    children: [
      { label: "Balance", href: "/eecc/balance" },
      { label: "Indicadores", href: "/eecc/indicadores" },
    ],
  },
  { label: "Indicadores Macro", href: "/indicadores-macro", icon: Globe },
  { label: "Datasets", href: "/datasets", icon: Database },
  { label: "Importar Datos", href: "/importar", icon: Upload },
];

function NavSubGroup({ item }: { item: NavChild }) {
  const pathname = usePathname();
  const isActive =
    pathname === item.href || pathname.startsWith(item.href + "/");
  const [open, setOpen] = useState(isActive);

  if (!item.children) {
    return (
      <Link
        href={item.href}
        className={cn(
          "block rounded-lg px-3 py-1.5 text-sm transition-colors",
          pathname === item.href
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        )}
      >
        {item.label}
      </Link>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm">
        <Link
          href={item.href}
          className={cn(
            "flex-1 text-left rounded transition-colors",
            pathname === item.href
              ? "text-primary font-medium"
              : isActive
                ? "text-accent-foreground font-medium"
                : "text-muted-foreground hover:text-accent-foreground"
          )}
        >
          {item.label}
        </Link>
        <button
          onClick={() => setOpen(!open)}
          className="p-0.5 rounded hover:bg-accent transition-colors"
        >
          <ChevronDown
            className={cn(
              "h-3 w-3 shrink-0 transition-transform",
              open && "rotate-180"
            )}
          />
        </button>
      </div>
      {open && (
        <div className="ml-3 mt-1 space-y-0.5 border-l pl-3">
          {item.children.map((child) => {
            const childActive = pathname === child.href;
            return (
              <Link
                key={child.href}
                href={child.href}
                className={cn(
                  "block rounded-lg px-3 py-1 text-xs transition-colors",
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
          {item.children.map((child) =>
            child.children ? (
              <NavSubGroup key={child.href} item={child} />
            ) : (
              <Link
                key={child.href}
                href={child.href}
                className={cn(
                  "block rounded-lg px-3 py-1.5 text-sm transition-colors",
                  pathname === child.href
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                {child.label}
              </Link>
            )
          )}
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
