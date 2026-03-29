-- Migration 004: Add UNIQUE constraints needed by ETL upserts
-- cliente.cuit and proveedor.cuit are used as ON CONFLICT targets

CREATE UNIQUE INDEX idx_cliente_cuit ON cliente(cuit) WHERE cuit IS NOT NULL;
CREATE UNIQUE INDEX idx_proveedor_cuit ON proveedor(cuit) WHERE cuit IS NOT NULL;
