-- 083_fix_egresos_por_categoria_neto.sql
--
-- Corrige el RPC `get_egresos_por_categoria_mensual` (migración 077) para
-- que use la misma base que el resto de EERR/Egresos:
--   1. Neto sin IVA: imp_neto_gravado_total + imp_neto_no_gravado + imp_op_exentas
--   2. Notas de crédito (tipo_comprobante 3, 8, 203) restan en vez de sumar.
--
-- Sin este fix, la subpágina Costos Operativos mostraba totales ~27% más
-- altos que el Estado de Resultados (IVA incluido + notas de crédito sumadas
-- en lugar de restadas).

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
    SUM(CASE WHEN fr.tipo_comprobante IN (3, 8, 203)
             THEN -(COALESCE(fr.imp_neto_gravado_total, 0) + COALESCE(fr.imp_neto_no_gravado, 0) + COALESCE(fr.imp_op_exentas, 0))
             ELSE   COALESCE(fr.imp_neto_gravado_total, 0) + COALESCE(fr.imp_neto_no_gravado, 0) + COALESCE(fr.imp_op_exentas, 0) END)::NUMERIC AS total
  FROM factura_recibida fr
  JOIN proveedor p ON p.id = fr.proveedor_id
  WHERE fr.fecha_emision IS NOT NULL
  GROUP BY TO_CHAR(fr.fecha_emision, 'YYYY-MM'), p.categoria_egreso, p.subcategoria;
$$;
