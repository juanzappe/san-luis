-- Tabla: saldo_manual
-- Permite ingresar saldos manualmente para cuentas sin fuente de datos automática.
-- Cada INSERT es un nuevo registro histórico; se usa el más reciente por cuenta.
--
-- Uso actual: cuenta = 'caja' (Efectivo en caja)
-- Uso futuro: cuenta = 'inviu' si se prefiere carga manual en lugar del ETL

CREATE TABLE IF NOT EXISTS saldo_manual (
  id         SERIAL PRIMARY KEY,
  cuenta     TEXT      NOT NULL,
  saldo      NUMERIC   NOT NULL,
  fecha      DATE      NOT NULL,
  nota       TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índice para consultar el último saldo por cuenta eficientemente
CREATE INDEX IF NOT EXISTS idx_saldo_manual_cuenta_fecha
  ON saldo_manual (cuenta, fecha DESC);
