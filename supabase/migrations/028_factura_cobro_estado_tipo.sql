-- Migración: ampliar factura_cobro_estado para soportar facturas recibidas (CxP)
--
-- La tabla originalmente solo cubría facturas emitidas (CxC) con una FK a
-- factura_emitida.id y PK simple en factura_id.
-- Para reutilizarla en cuentas por pagar (factura_recibida) agregamos:
--   1. Columna `tipo` ('cobrar' = CxC, 'pagar' = CxP)
--   2. PK compuesta (factura_id, tipo) — permite que el mismo ID exista en ambos tipos
--   3. Se elimina la FK a factura_emitida porque la columna es ahora polimórfica

-- Paso 1: eliminar FK original
ALTER TABLE factura_cobro_estado
  DROP CONSTRAINT IF EXISTS factura_cobro_estado_factura_id_fkey;

-- Paso 2: agregar columna tipo (default 'cobrar' para las filas existentes)
ALTER TABLE factura_cobro_estado
  ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'cobrar';

-- Paso 3: reemplazar PK simple por PK compuesta
ALTER TABLE factura_cobro_estado DROP CONSTRAINT IF EXISTS factura_cobro_estado_pkey;
ALTER TABLE factura_cobro_estado ADD PRIMARY KEY (factura_id, tipo);

-- Paso 4: restricción de valores válidos
ALTER TABLE factura_cobro_estado
  ADD CONSTRAINT chk_factura_cobro_estado_tipo CHECK (tipo IN ('cobrar', 'pagar'));

-- Paso 5: índice para consultas por tipo
CREATE INDEX IF NOT EXISTS idx_factura_cobro_estado_tipo
  ON factura_cobro_estado (tipo, pagada);
