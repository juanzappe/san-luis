-- Eliminar registros duplicados de Banco Provincia formato TXT genérico.
-- Los extractos TXT mensuales se solapan en fechas límite (ej: archivos 0801 y 0902
-- ambos contienen movimientos del 1 de agosto), generando ~4900 duplicados.
-- Se eliminan filas duplicadas por (fecha, concepto, importe, saldo), conservando una.
-- Procesado mes a mes para evitar timeout en Supabase.

DO $$
DECLARE
  r RECORD;
  deleted INT;
BEGIN
  FOR r IN
    SELECT DISTINCT date_trunc('month', fecha)::date AS mes
    FROM movimiento_bancario
    WHERE banco = 'provincia'
    ORDER BY mes
  LOOP
    DELETE FROM movimiento_bancario a
    USING movimiento_bancario b
    WHERE a.banco = 'provincia'
      AND b.banco = 'provincia'
      AND a.fecha >= r.mes
      AND a.fecha < r.mes + INTERVAL '1 month'
      AND b.fecha >= r.mes
      AND b.fecha < r.mes + INTERVAL '1 month'
      AND a.fecha IS NOT DISTINCT FROM b.fecha
      AND a.concepto IS NOT DISTINCT FROM b.concepto
      AND a.importe IS NOT DISTINCT FROM b.importe
      AND a.saldo IS NOT DISTINCT FROM b.saldo
      AND a.id > b.id;

    GET DIAGNOSTICS deleted = ROW_COUNT;
    IF deleted > 0 THEN
      RAISE NOTICE 'Mes %: % duplicados eliminados', r.mes, deleted;
    END IF;
  END LOOP;
END $$;
