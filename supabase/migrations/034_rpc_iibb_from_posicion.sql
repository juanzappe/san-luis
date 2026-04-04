-- Replace get_iibb_mensual() to read from iibb_posicion (SIFERE data)
-- instead of movimiento_bancario pattern matching.
-- IIBB = saldo_a_favor + compensaciones_recibidas + compensaciones_enviadas

CREATE OR REPLACE FUNCTION get_iibb_mensual()
RETURNS TABLE(periodo text, iibb numeric)
AS $$
  SELECT
    periodo,
    COALESCE(saldo_a_favor, 0) + COALESCE(compensaciones_recibidas, 0) + COALESCE(compensaciones_enviadas, 0)
  FROM iibb_posicion
  ORDER BY periodo
$$ LANGUAGE sql STABLE
SET statement_timeout = '30s';
