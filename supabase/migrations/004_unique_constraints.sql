-- Migration 004: Add UNIQUE constraints needed by ETL upserts
-- cliente.cuit and proveedor.cuit are used as ON CONFLICT targets
-- Must be non-partial (no WHERE clause) for ON CONFLICT (col) to match

-- Drop partial indexes if they exist from a previous run
DROP INDEX IF EXISTS idx_cliente_cuit;
DROP INDEX IF EXISTS idx_proveedor_cuit;

-- Use ALTER TABLE ADD CONSTRAINT for clean ON CONFLICT matching
ALTER TABLE cliente ADD CONSTRAINT uq_cliente_cuit UNIQUE (cuit);
ALTER TABLE proveedor ADD CONSTRAINT uq_proveedor_cuit UNIQUE (cuit);
