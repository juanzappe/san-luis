"use client";

import { SWRConfig } from "swr";
import { InflationProvider } from "@/lib/inflation";
import { SidebarProvider } from "@/components/layout/sidebar";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        revalidateOnFocus: false,
        revalidateIfStale: false,
        revalidateOnReconnect: true,
        dedupingInterval: 60_000,
        shouldRetryOnError: true,
        errorRetryCount: 2,
      }}
    >
      <SidebarProvider>
        <InflationProvider>{children}</InflationProvider>
      </SidebarProvider>
    </SWRConfig>
  );
}
