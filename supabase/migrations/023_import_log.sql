-- ---------------------------------------------------------------------------
-- Import log table for tracking file uploads and ETL processing
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS import_log (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  archivo         TEXT NOT NULL,
  fuente          TEXT NOT NULL,
  tamano_bytes    BIGINT,
  registros_procesados INT,
  estado          TEXT NOT NULL DEFAULT 'pendiente',
  error_mensaje   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
