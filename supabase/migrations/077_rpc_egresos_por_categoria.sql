-- 077_rpc_egresos_por_categoria.sql
--
-- RPC que devuelve egresos mensuales por categoria_egreso y subcategoria,
-- usando factura_recibida (criterio devengado por fecha de emisión).
--
-- La función `get_egresos_mensual` sigue existiendo para los totales agregados;
-- esta RPC complementa con el desglose necesario para las subpáginas de
-- Gastos Comerciales y Costos Operativos.

CREATE OR REPLACE FUNCTION get_egresos_por_categoria_mensual()
RETURNS TABLE (
  periodo TEXT,
  categoria_egreso TEXT,
  subcategoria TEXT,
  total NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    TO_CHAR(fr.fecha_emision, 'YYYY-MM') AS periodo,
    COALESCE(p.categoria_egreso, 'Sin categorizar') AS categoria_egreso,
    p.subcategoria,
    SUM(fr.imp_total)::NUMERIC AS total
  FROM factura_recibida fr
  JOIN proveedor p ON p.id = fr.proveedor_id
  WHERE fr.fecha_emision IS NOT NULL
  GROUP BY TO_CHAR(fr.fecha_emision, 'YYYY-MM'), p.categoria_egreso, p.subcategoria;
$$;

GRANT EXECUTE ON FUNCTION get_egresos_por_categoria_mensual() TO anon, authenticated;
