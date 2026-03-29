"use client";

import { InflationProvider } from "@/lib/inflation";

export function Providers({ children }: { children: React.ReactNode }) {
  return <InflationProvider>{children}</InflationProvider>;
}
