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
  BookOpen,
  BarChart3,
  ShoppingCart,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

// ─── Sidebar context (shared with layout for padding) ───────────────────────

interface SidebarCtx {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
}

const SidebarContext = createContext<SidebarCtx>({
  collapsed: false,
  setCollapsed: () => {},
});

export function useSidebar() {
  return useContext(SidebarContext);
}

const LS_KEY = "sidebar-collapsed";

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsedState] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(LS_KEY);
    if (stored === "true") setCollapsedState(true);
    setMounted(true);
  }, []);

  const setCollapsed = useCallback((v: boolean) => {
    setCollapsedState(v);
    localStorage.setItem(LS_KEY, String(v));
  }, []);

  // Prevent hydration mismatch — render expanded until mounted
  const value = { collapsed: mounted ? collapsed : false, setCollapsed };

  return (
    <SidebarContext.Provider value={value}>
      {children}
    </SidebarContext.Provider>
  );
}

// ─── Width constants ────────────────────────────────────────────────────────

const WIDTH_EXPANDED = 256; // 16rem = w-64
const WIDTH_COLLAPSED = 60;

// ─── Navigation data ────────────────────────────────────────────────────────

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
      { label: "Tesorería", href: "/financiero/tesoreria" },
      { label: "Cuentas por Pagar", href: "/financiero/cuentas-pagar" },
      { label: "Cuentas por Cobrar", href: "/financiero/cuentas-cobrar" },
    ],
  },
  {
    label: "Comercial",
    href: "/comercial",
    icon: ShoppingCart,
    children: [
      { label: "Clientes", href: "/comercial/clientes" },
      { label: "Proveedores", href: "/comercial/proveedores" },
    ],
  },
  { label: "Datos del Negocio", href: "/datos-negocio", icon: Database },
  {
    label: "Comprobantes",
    href: "/comprobantes",
    icon: FileText,
    children: [
      { label: "Recibidos", href: "/comprobantes/recibidos" },
    ],
  },
  {
    label: "EECC",
    href: "/eecc",
    icon: BookOpen,
    children: [
      { label: "Balance", href: "/eecc/balance" },
      { label: "Indicadores", href: "/eecc/indicadores" },
    ],
  },
  { label: "Indicadores Macro", href: "/indicadores-macro", icon: Globe },
  { label: "Datasets", href: "/datasets", icon: BarChart3 },
  { label: "Importar Datos", href: "/importar", icon: Upload },
];

// ─── NavSubGroup (3rd-level items) ──────────────────────────────────────────

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

// ─── NavGroup (expanded mode) ───────────────────────────────────────────────

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
        <Icon className="h-4 w-4 shrink-0" />
        <span className="truncate">{item.label}</span>
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
        <Icon className="h-4 w-4 shrink-0" />
        <span className="flex-1 text-left truncate">{item.label}</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 transition-transform",
            open && "rotate-180"
          )}
        />
      </button>
      <div
        className={cn(
          "ml-4 space-y-1 border-l pl-4 overflow-hidden transition-all duration-200",
          open ? "mt-1 max-h-[500px] opacity-100" : "max-h-0 opacity-0"
        )}
      >
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
    </div>
  );
}

// ─── NavIconButton (collapsed mode) ─────────────────────────────────────────

function NavIconButton({ item, onExpand }: { item: NavItem; onExpand: () => void }) {
  const pathname = usePathname();
  const isActive =
    pathname === item.href || pathname.startsWith(item.href + "/");
  const Icon = item.icon;

  if (!item.children) {
    return (
      <Link
        href={item.href}
        className={cn(
          "group relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
          isActive
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        )}
        title={item.label}
      >
        <Icon className="h-5 w-5" />
        {/* Tooltip */}
        <span className="pointer-events-none absolute left-full ml-2 whitespace-nowrap rounded-md bg-popover px-2.5 py-1.5 text-xs font-medium text-popover-foreground shadow-md border opacity-0 group-hover:opacity-100 transition-opacity z-50">
          {item.label}
        </span>
      </Link>
    );
  }

  return (
    <button
      onClick={onExpand}
      className={cn(
        "group relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
        isActive
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      )}
      title={item.label}
    >
      <Icon className="h-5 w-5" />
      {/* Tooltip */}
      <span className="pointer-events-none absolute left-full ml-2 whitespace-nowrap rounded-md bg-popover px-2.5 py-1.5 text-xs font-medium text-popover-foreground shadow-md border opacity-0 group-hover:opacity-100 transition-opacity z-50">
        {item.label}
      </span>
    </button>
  );
}

// ─── Sidebar ────────────────────────────────────────────────────────────────

export function Sidebar() {
  const { collapsed, setCollapsed } = useSidebar();

  const expand = useCallback(() => setCollapsed(false), [setCollapsed]);

  return (
    <aside
      className="fixed inset-y-0 left-0 z-30 hidden flex-col border-r bg-card lg:flex transition-[width] duration-200 ease-in-out"
      style={{ width: collapsed ? WIDTH_COLLAPSED : WIDTH_EXPANDED }}
    >
      {/* Header */}
      <div className={cn(
        "flex h-16 items-center border-b transition-all duration-200",
        collapsed ? "justify-center px-2" : "gap-2 px-6"
      )}>
        <LayoutDashboard className="h-6 w-6 shrink-0 text-primary" />
        {!collapsed && (
          <div className="overflow-hidden">
            <h1 className="text-sm font-bold leading-none whitespace-nowrap">San Luis</h1>
            <p className="text-xs text-muted-foreground whitespace-nowrap">Gestión Empresarial</p>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className={cn(
        "flex-1 overflow-y-auto overflow-x-hidden transition-all duration-200",
        collapsed ? "p-1.5 space-y-1" : "p-4 space-y-1"
      )}>
        {collapsed ? (
          // Collapsed: icon-only
          <div className="flex flex-col items-center gap-1">
            {navigation.map((item) => (
              <NavIconButton key={item.href} item={item} onExpand={expand} />
            ))}
          </div>
        ) : (
          // Expanded: full nav
          navigation.map((item) => (
            <NavGroup key={item.href} item={item} />
          ))
        )}
      </nav>

      {/* Footer with collapse button */}
      <div className={cn(
        "border-t transition-all duration-200",
        collapsed ? "p-2" : "p-4"
      )}>
        {!collapsed && (
          <p className="text-xs text-muted-foreground mb-3">
            Nadal y Zaccaro S.A.
          </p>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={cn(
            "flex items-center gap-2 rounded-lg text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors",
            collapsed ? "h-10 w-10 justify-center" : "w-full px-3 py-2"
          )}
          title={collapsed ? "Expandir sidebar" : "Colapsar sidebar"}
        >
          {collapsed ? (
            <ChevronsRight className="h-4 w-4 shrink-0" />
          ) : (
            <>
              <ChevronsLeft className="h-4 w-4 shrink-0" />
              <span>Colapsar</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
