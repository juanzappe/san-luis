-- Permite al rol anon hacer UPDATE sobre cliente para que la página
-- /comercial/clientes/editar pueda modificar tipo_entidad y clasificacion
-- desde el cliente. Mismo patrón que migración 078 para proveedor.

CREATE POLICY "allow_anon_update" ON cliente
  FOR UPDATE TO anon USING (true) WITH CHECK (true);
