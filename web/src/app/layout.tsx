import type { Metadata } from "next";
import localFont from "next/font/local";
import { Sidebar } from "@/components/layout/sidebar";
import { MobileNav } from "@/components/layout/mobile-nav";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-sans",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "San Luis — Gestión Empresarial",
  description:
    "App de gestión integral para Confitería San Luis / Nadal y Zaccaro S.A.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={geistSans.variable}>
      <body className="antialiased">
        <Sidebar />
        <MobileNav />
        <main className="min-h-screen lg:pl-64">
          <div className="container mx-auto p-6 lg:p-8">{children}</div>
        </main>
      </body>
    </html>
  );
}
