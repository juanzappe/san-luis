-- 058_tesoreria_rpcs.sql
-- RPC for the Tesorería page: monthly bank balance evolution.

SET search_path = public;

DROP FUNCTION IF EXISTS get_evolucion_saldos(integer);

CREATE FUNCTION get_evolucion_saldos(p_meses integer DEFAULT 12)
RETURNS TABLE(
  periodo text,
  banco   text,
  saldo   numeric
)
LANGUAGE sql STABLE
SET statement_timeout TO '15s'
AS $$
  SELECT sub.periodo, sub.banco, sub.saldo
  FROM (
    SELECT DISTINCT ON (banco, TO_CHAR(fecha, 'YYYY-MM'))
      TO_CHAR(fecha, 'YYYY-MM') AS periodo,
      banco::text AS banco,
      saldo
    FROM movimiento_bancario
    WHERE saldo IS NOT NULL
      AND fecha >= (CURRENT_DATE - (p_meses || ' months')::interval)::date
    ORDER BY banco, TO_CHAR(fecha, 'YYYY-MM'), fecha DESC, id DESC
  ) sub
  ORDER BY sub.periodo, sub.banco;
$$;
