-- 003_segmentacion.sql
-- Agrega columnas de segmentación a cliente y proveedor,
-- y crea tabla catálogo de sectores de clientes.

-- Nuevas columnas en cliente
ALTER TABLE cliente ADD COLUMN IF NOT EXISTS tipo_entidad TEXT;
ALTER TABLE cliente ADD COLUMN IF NOT EXISTS clasificacion TEXT;

-- Nuevas columnas en proveedor
ALTER TABLE proveedor ADD COLUMN IF NOT EXISTS tipo_costo TEXT;
ALTER TABLE proveedor ADD COLUMN IF NOT EXISTS categoria_egreso TEXT;

-- Tabla catálogo de sectores de clientes
CREATE TABLE IF NOT EXISTS sector_cliente (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre     TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
