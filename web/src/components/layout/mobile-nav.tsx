"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, LayoutDashboard } from "lucide-react";
import { cn } from "@/lib/utils";

const links = [
  { label: "Inicio", href: "/" },
  { label: "Económicos", href: "/economico" },
  { label: "Financieros", href: "/financiero" },
  { label: "Comercial", href: "/comercial" },
  { label: "Datos del Negocio", href: "/datos-negocio" },
  { label: "EECC", href: "/eecc" },
  { label: "Indicadores Macro", href: "/indicadores-macro" },
  { label: "Datasets", href: "/datasets" },
  { label: "Importar", href: "/importar" },
];

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center gap-4 border-b bg-card px-4 lg:hidden">
      <button onClick={() => setOpen(!open)} className="p-2">
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>
      <div className="flex items-center gap-2">
        <LayoutDashboard className="h-5 w-5 text-primary" />
        <span className="font-bold text-sm">San Luis</span>
      </div>
      {open && (
        <div className="absolute left-0 top-16 w-full border-b bg-card p-4 shadow-lg">
          <nav className="space-y-1">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "block rounded-lg px-3 py-2 text-sm transition-colors",
                  pathname === link.href || pathname.startsWith(link.href + "/")
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent"
                )}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}
