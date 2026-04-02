-- ---------------------------------------------------------------------------
-- RPC: get_datasets_status — returns record count & date range for all tables
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_datasets_status()
RETURNS TABLE(tabla text, registros bigint, primer_dato date, ultimo_dato date) AS $$
  SELECT 'venta', COUNT(*), MIN(fecha::date), MAX(fecha::date) FROM venta
  UNION ALL SELECT 'venta_detalle', COUNT(*), NULL, NULL FROM venta_detalle
  UNION ALL SELECT 'factura_emitida', COUNT(*), MIN(fecha_emision), MAX(fecha_emision) FROM factura_emitida
  UNION ALL SELECT 'factura_recibida', COUNT(*), MIN(fecha_emision), MAX(fecha_emision) FROM factura_recibida
  UNION ALL SELECT 'movimiento_bancario', COUNT(*), MIN(fecha), MAX(fecha) FROM movimiento_bancario
  UNION ALL SELECT 'movimiento_mp', COUNT(*), MIN(fecha::date), MAX(fecha::date) FROM movimiento_mp
  UNION ALL SELECT 'movimiento_caja', COUNT(*), MIN(fecha::date), MAX(fecha::date) FROM movimiento_caja
  UNION ALL SELECT 'liquidacion_sueldo', COUNT(*), MIN(fecha_transferencia), MAX(fecha_transferencia) FROM liquidacion_sueldo
  UNION ALL SELECT 'pago_impuesto', COUNT(*), MIN(fecha_pago), MAX(fecha_pago) FROM pago_impuesto
  UNION ALL SELECT 'balance_rubro', COUNT(*), MIN(fecha_cierre), MAX(fecha_cierre) FROM balance_rubro
  UNION ALL SELECT 'estado_resultados_contable', COUNT(*), MIN(fecha_cierre), MAX(fecha_cierre) FROM estado_resultados_contable
  UNION ALL SELECT 'indicador_macro', COUNT(*), MIN(fecha), MAX(fecha) FROM indicador_macro
  UNION ALL SELECT 'inversion', COUNT(*), MIN(fecha_valuacion), MAX(fecha_valuacion) FROM inversion
  UNION ALL SELECT 'inversion_movimiento', COUNT(*), MIN(fecha_concertacion), MAX(fecha_concertacion) FROM inversion_movimiento
  UNION ALL SELECT 'cliente', COUNT(*), NULL, NULL FROM cliente
  UNION ALL SELECT 'proveedor', COUNT(*), NULL, NULL FROM proveedor
  UNION ALL SELECT 'empleado', COUNT(*), NULL, NULL FROM empleado
  UNION ALL SELECT 'producto', COUNT(*), NULL, NULL FROM producto
  UNION ALL SELECT 'categoria_egreso', COUNT(*), NULL, NULL FROM categoria_egreso
$$ LANGUAGE sql STABLE
SET statement_timeout = '30s';

-- ---------------------------------------------------------------------------
-- RPC: get_dataset_monthly — returns records per month for a given table
-- Uses whitelisted table names to prevent SQL injection
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_dataset_monthly(p_tabla text)
RETURNS TABLE(periodo text, registros bigint) AS $$
DECLARE
  date_col text;
  query text;
BEGIN
  SELECT CASE p_tabla
    WHEN 'venta' THEN 'fecha'
    WHEN 'factura_emitida' THEN 'fecha_emision'
    WHEN 'factura_recibida' THEN 'fecha_emision'
    WHEN 'movimiento_bancario' THEN 'fecha'
    WHEN 'movimiento_mp' THEN 'fecha'
    WHEN 'movimiento_caja' THEN 'fecha'
    WHEN 'liquidacion_sueldo' THEN 'fecha_transferencia'
    WHEN 'pago_impuesto' THEN 'fecha_pago'
    WHEN 'balance_rubro' THEN 'fecha_cierre'
    WHEN 'estado_resultados_contable' THEN 'fecha_cierre'
    WHEN 'indicador_macro' THEN 'fecha'
    WHEN 'inversion' THEN 'fecha_valuacion'
    WHEN 'inversion_movimiento' THEN 'fecha_concertacion'
    ELSE NULL
  END INTO date_col;

  IF date_col IS NULL THEN RETURN; END IF;

  query := format(
    'SELECT TO_CHAR(%I::date, ''YYYY-MM'') AS periodo, COUNT(*) AS registros
     FROM %I WHERE %I IS NOT NULL GROUP BY 1 ORDER BY 1',
    date_col, p_tabla, date_col
  );
  RETURN QUERY EXECUTE query;
END;
$$ LANGUAGE plpgsql STABLE
SET statement_timeout = '30s';
