-- ============================================================================
-- Migración 002: Tabla producto (catálogo maestro del POS)
-- Fuente: LISTADO_PRODUCTOS.xlsx — 235 productos con precios y proveedores
-- ============================================================================

CREATE TABLE producto (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    codigo_pos      TEXT NOT NULL,
    descripcion     TEXT NOT NULL,
    familia         TEXT,
    costo           NUMERIC(15,2),
    precio_venta    NUMERIC(15,2),
    margen          NUMERIC(8,4),
    proveedor_nombre TEXT,
    proveedor_cuit  TEXT,
    activo          BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_producto_codigo ON producto(codigo_pos);

COMMENT ON TABLE producto IS 'Catálogo maestro de productos del POS con precios y proveedores. Fuente: LISTADO_PRODUCTOS.xlsx';
