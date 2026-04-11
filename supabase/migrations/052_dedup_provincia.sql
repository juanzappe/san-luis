-- Eliminar registros duplicados de Banco Provincia formato TXT genérico.
-- Los extractos TXT mensuales se solapan en fechas límite (ej: archivos 0801 y 0902
-- ambos contienen movimientos del 1 de agosto), generando ~4900 duplicados.
-- Se eliminan filas duplicadas por (fecha, concepto, importe, saldo), conservando una.

DELETE FROM movimiento_bancario a
USING movimiento_bancario b
WHERE a.banco = 'provincia'
  AND b.banco = 'provincia'
  AND a.fecha IS NOT DISTINCT FROM b.fecha
  AND a.concepto IS NOT DISTINCT FROM b.concepto
  AND a.importe IS NOT DISTINCT FROM b.importe
  AND a.saldo IS NOT DISTINCT FROM b.saldo
  AND a.id > b.id;
