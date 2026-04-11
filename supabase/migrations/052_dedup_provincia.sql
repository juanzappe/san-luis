-- Eliminar registros duplicados de Banco Provincia formato TXT genérico.
-- Los extractos TXT mensuales se solapan en fechas límite (ej: archivos 0801 y 0902
-- ambos contienen movimientos del 1 de agosto), generando ~4900 duplicados.
-- Se eliminan filas duplicadas por (fecha, concepto, importe, saldo), conservando una.

DELETE FROM movimiento_bancario
WHERE banco = 'provincia'
  AND id NOT IN (
    SELECT MIN(id)
    FROM movimiento_bancario
    WHERE banco = 'provincia'
    GROUP BY fecha, concepto, importe, saldo
  );
