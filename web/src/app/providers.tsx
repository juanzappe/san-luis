"use client";

import { InflationProvider } from "@/lib/inflation";
import { SidebarProvider } from "@/components/layout/sidebar";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <InflationProvider>{children}</InflationProvider>
    </SidebarProvider>
  );
}
