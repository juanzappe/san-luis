"use client";

import { periodoLabel } from "@/lib/economic-queries";

interface MonthSelectorProps {
  /** Periodo strings sorted chronologically ascending, e.g. ["2024-01", "2024-02", ...] */
  periodos: string[];
  /** Currently selected periodo string */
  value: string;
  /** Called when user picks a different month */
  onChange: (periodo: string) => void;
}

export function MonthSelector({ periodos, value, onChange }: MonthSelectorProps) {
  // Show most recent first
  const reversed = [...periodos].reverse();

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-input bg-background px-3 py-1.5 text-sm font-medium cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
    >
      {reversed.map((p) => (
        <option key={p} value={p}>
          {periodoLabel(p)}
        </option>
      ))}
    </select>
  );
}
