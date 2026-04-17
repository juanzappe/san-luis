-- Permite al rol anon hacer UPDATE sobre proveedor para que la página
-- /comercial/proveedores/editar pueda modificar categoria_egreso,
-- subcategoria y tipo_costo desde el cliente.
--
-- Mismo patrón que migración 065 para indicador_macro.

CREATE POLICY "allow_anon_update" ON proveedor
  FOR UPDATE TO anon USING (true) WITH CHECK (true);
