-- Add dolar_blue to tipo_indicador_macro_enum
ALTER TYPE tipo_indicador_macro_enum ADD VALUE IF NOT EXISTS 'dolar_blue';

-- Add unique constraint on (tipo, fecha) for upsert support
-- Drop the existing index first, then recreate as unique
DROP INDEX IF EXISTS idx_indicador_macro_tipo_fecha;
ALTER TABLE indicador_macro ADD CONSTRAINT uq_indicador_macro_tipo_fecha UNIQUE (tipo, fecha);
