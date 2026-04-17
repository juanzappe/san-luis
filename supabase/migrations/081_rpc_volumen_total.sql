-- 081_rpc_volumen_total.sql
--
-- RPCs para obtener el volumen histórico total por proveedor y por cliente.
-- Necesarios porque el cliente JS tiene un límite de filas (~1000) al hacer
-- `select` plano, lo que hacía que las páginas de edición mostraran $0 para
-- la mayoría de entidades.

CREATE OR REPLACE FUNCTION get_proveedor_volumen_total()
RETURNS TABLE (proveedor_id BIGINT, volumen NUMERIC)
LANGUAGE sql
STABLE
AS $$
  SELECT proveedor_id, SUM(imp_total)::NUMERIC AS volumen
  FROM factura_recibida
  WHERE proveedor_id IS NOT NULL
  GROUP BY proveedor_id;
$$;

CREATE OR REPLACE FUNCTION get_cliente_volumen_total()
RETURNS TABLE (cliente_id BIGINT, volumen NUMERIC)
LANGUAGE sql
STABLE
AS $$
  SELECT cliente_id, SUM(imp_total)::NUMERIC AS volumen
  FROM factura_emitida
  WHERE cliente_id IS NOT NULL
  GROUP BY cliente_id;
$$;

GRANT EXECUTE ON FUNCTION get_proveedor_volumen_total() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_cliente_volumen_total()   TO anon, authenticated;
