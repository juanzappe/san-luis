-- 064: Create tables for Tesorería module
-- inmueble: real estate assets owned by the business
-- configuracion_manual: key-value store for manual configuration (e.g. cash on hand)

-- ─────────────────────────────────────────────
-- Table: inmueble
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inmueble (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    descripcion     text NOT NULL,
    direccion       text,
    valor_estimado  numeric(15,2) NOT NULL DEFAULT 0,
    fecha_valuacion date,
    observaciones   text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE inmueble IS 'Real estate assets owned by the business, manually managed from Tesorería';

-- ─────────────────────────────────────────────
-- Table: configuracion_manual
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS configuracion_manual (
    key        text PRIMARY KEY,
    valor      text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE configuracion_manual IS 'Key-value store for manually entered configuration values';

-- Seed default value for cash on hand
INSERT INTO configuracion_manual (key, valor)
VALUES ('efectivo_caja', '0')
ON CONFLICT DO NOTHING;
