-- Tabla: factura_cobro_estado
-- Persiste el estado de cobro manual (override) para facturas emitidas.
--
-- Regla de negocio (aplicada en el frontend):
--   - Si no hay registro aquí y fecha_emision > 30 días → se considera pagada automáticamente
--   - Si hay registro → usar el valor de `pagada` como override definitivo
--
-- Referencia: factura_emitida.id (filtrando punto_venta = 6, Servicios)

CREATE TABLE IF NOT EXISTS factura_cobro_estado (
  factura_id    INTEGER PRIMARY KEY REFERENCES factura_emitida(id) ON DELETE CASCADE,
  pagada        BOOLEAN  NOT NULL DEFAULT FALSE,
  fecha_marcado DATE,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índice para búsquedas por estado
CREATE INDEX IF NOT EXISTS idx_factura_cobro_estado_pagada
  ON factura_cobro_estado (pagada);

-- Trigger: actualizar updated_at en cada UPDATE
CREATE OR REPLACE FUNCTION trg_factura_cobro_estado_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_factura_cobro_estado_updated_at ON factura_cobro_estado;
CREATE TRIGGER set_factura_cobro_estado_updated_at
  BEFORE UPDATE ON factura_cobro_estado
  FOR EACH ROW EXECUTE FUNCTION trg_factura_cobro_estado_updated_at();
