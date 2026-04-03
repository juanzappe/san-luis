-- RPC: get_saldos_cuentas()
-- Devuelve el saldo actual de cada cuenta financiera usando el último dato
-- disponible en cada tabla fuente. Un row por cuenta.
--
-- Fuentes:
--   inviu        → inversion (vigente, fecha_valuacion más reciente)
--   santander    → movimiento_bancario WHERE banco='santander' (último saldo)
--   provincia    → movimiento_bancario WHERE banco='provincia' (último saldo)
--   mercado_pago → movimiento_mp (SUM importe acumulado)
--   caja         → movimiento_caja (SUM importe acumulado)
--
-- Para bancos: usa `saldo` de la última fila; si es NULL, cae en SUM(importe).
-- fecha_dato NULL indica que no hay datos cargados para esa cuenta.

CREATE OR REPLACE FUNCTION get_saldos_cuentas()
RETURNS TABLE(
  cuenta     text,
  saldo_ars  numeric,
  saldo_usd  numeric,
  fecha_dato date
)
LANGUAGE sql STABLE
SET statement_timeout = '15s'
AS $$

  -- Inviu: suma de posiciones vigentes en la fecha de valuación más reciente
  SELECT
    'inviu'::text,
    COALESCE(SUM(valuacion_monto), 0),
    COALESCE(SUM(valuacion_usd),   0),
    MAX(fecha_valuacion)
  FROM inversion
  WHERE estado = 'vigente'
    AND fecha_valuacion = (
      SELECT MAX(fecha_valuacion) FROM inversion WHERE estado = 'vigente'
    )

  UNION ALL

  -- Santander: saldo explícito de la última fila; fallback a SUM(importe)
  SELECT
    'santander'::text,
    COALESCE(
      (SELECT saldo   FROM movimiento_bancario WHERE banco = 'santander' AND saldo IS NOT NULL ORDER BY fecha DESC, id DESC LIMIT 1),
      (SELECT SUM(importe) FROM movimiento_bancario WHERE banco = 'santander'),
      0
    ),
    NULL::numeric,
    (SELECT fecha FROM movimiento_bancario WHERE banco = 'santander' ORDER BY fecha DESC LIMIT 1)

  UNION ALL

  -- Banco Provincia: saldo explícito de la última fila; fallback a SUM(importe)
  SELECT
    'provincia'::text,
    COALESCE(
      (SELECT saldo   FROM movimiento_bancario WHERE banco = 'provincia' AND saldo IS NOT NULL ORDER BY fecha DESC, id DESC LIMIT 1),
      (SELECT SUM(importe) FROM movimiento_bancario WHERE banco = 'provincia'),
      0
    ),
    NULL::numeric,
    (SELECT fecha FROM movimiento_bancario WHERE banco = 'provincia' ORDER BY fecha DESC LIMIT 1)

  UNION ALL

  -- Mercado Pago: saldo acumulado (SUM importe con signo)
  SELECT
    'mercado_pago'::text,
    COALESCE(SUM(importe), 0),
    NULL::numeric,
    MAX(fecha)::date
  FROM movimiento_mp

  UNION ALL

  -- Caja: suma acumulada de movimientos POS
  SELECT
    'caja'::text,
    COALESCE(SUM(importe), 0),
    NULL::numeric,
    MAX(fecha)::date
  FROM movimiento_caja

$$;
