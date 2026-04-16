-- Allow the anon role to INSERT, UPDATE, DELETE on indicador_macro
-- so the /api/macro/sync endpoint (which uses the anon key) can upsert data.
-- This table only holds public macroeconomic data (IPC, dólar, tasas) — no security risk.

CREATE POLICY "allow_anon_insert" ON indicador_macro
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "allow_anon_update" ON indicador_macro
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "allow_anon_delete" ON indicador_macro
  FOR DELETE TO anon USING (true);
