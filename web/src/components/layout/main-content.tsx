"use client";

import { useSidebar } from "./sidebar";

export function MainContent({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebar();
  const sidebarWidth = collapsed ? 60 : 256;

  return (
    <>
      {/* Inject a tiny <style> so the padding only applies at lg+ breakpoint */}
      <style>{`
        @media (min-width: 1024px) {
          .main-content { padding-left: ${sidebarWidth}px; }
        }
      `}</style>
      <main className="main-content min-h-screen transition-[padding-left] duration-200 ease-in-out">
        <div className="container mx-auto p-6 lg:p-8">{children}</div>
      </main>
    </>
  );
}
