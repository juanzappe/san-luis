-- 059_comprobantes_recibidos.sql
-- Módulo Comprobantes Recibidos: agrega el flag `tiene_copia_fisica` a
-- factura_recibida y expone las RPCs que consume el frontend.
--
-- Es el primer módulo de la app que ESCRIBE a la base (update_copia_fisica).

SET search_path = public;

-- ---------------------------------------------------------------------------
-- 1. Columna tiene_copia_fisica
-- ---------------------------------------------------------------------------

ALTER TABLE factura_recibida
  ADD COLUMN IF NOT EXISTS tiene_copia_fisica BOOLEAN NOT NULL DEFAULT FALSE;

-- ---------------------------------------------------------------------------
-- 2. RPC: listado paginado y filtrado
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS get_comprobantes_recibidos(
  integer, integer, text, integer, boolean, text, integer, integer
);

CREATE FUNCTION get_comprobantes_recibidos(
  p_anio                INTEGER DEFAULT NULL,
  p_mes                 INTEGER DEFAULT NULL,
  p_cuit                TEXT    DEFAULT NULL,
  p_tipo_comprobante    INTEGER DEFAULT NULL,
  p_tiene_copia_fisica  BOOLEAN DEFAULT NULL,
  p_search              TEXT    DEFAULT NULL,
  p_limit               INTEGER DEFAULT 50,
  p_offset              INTEGER DEFAULT 0
)
RETURNS TABLE (
  id                     BIGINT,
  fecha_emision          DATE,
  tipo_comprobante       INTEGER,
  punto_venta            INTEGER,
  numero_desde           INTEGER,
  nro_doc_emisor         TEXT,
  denominacion_emisor    TEXT,
  imp_neto_gravado_total NUMERIC,
  total_iva              NUMERIC,
  imp_total              NUMERIC,
  tiene_copia_fisica     BOOLEAN,
  estado                 TEXT,
  total_count            BIGINT
)
LANGUAGE plpgsql STABLE
SET statement_timeout TO '15s'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    fr.id,
    fr.fecha_emision,
    fr.tipo_comprobante,
    fr.punto_venta,
    fr.numero_desde,
    fr.nro_doc_emisor,
    fr.denominacion_emisor,
    fr.imp_neto_gravado_total,
    fr.total_iva,
    fr.imp_total,
    fr.tiene_copia_fisica,
    fr.estado::TEXT,
    COUNT(*) OVER() AS total_count
  FROM factura_recibida fr
  WHERE
        (p_anio               IS NULL OR EXTRACT(YEAR  FROM fr.fecha_emision) = p_anio)
    AND (p_mes                IS NULL OR EXTRACT(MONTH FROM fr.fecha_emision) = p_mes)
    AND (p_cuit               IS NULL OR fr.nro_doc_emisor = p_cuit)
    AND (p_tipo_comprobante   IS NULL OR fr.tipo_comprobante = p_tipo_comprobante)
    AND (p_tiene_copia_fisica IS NULL OR fr.tiene_copia_fisica = p_tiene_copia_fisica)
    AND (p_search             IS NULL OR fr.denominacion_emisor ILIKE '%' || p_search || '%')
  ORDER BY fr.fecha_emision DESC, fr.id DESC
  LIMIT  p_limit
  OFFSET p_offset;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. RPC: resumen / KPIs
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS get_comprobantes_resumen(integer, integer);

CREATE FUNCTION get_comprobantes_resumen(
  p_anio INTEGER DEFAULT NULL,
  p_mes  INTEGER DEFAULT NULL
)
RETURNS TABLE (
  total_comprobantes BIGINT,
  con_copia          BIGINT,
  sin_copia          BIGINT,
  porcentaje_copia   NUMERIC,
  monto_total        NUMERIC,
  proveedores_unicos BIGINT
)
LANGUAGE plpgsql STABLE
SET statement_timeout TO '15s'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT,
    COUNT(*) FILTER (WHERE fr.tiene_copia_fisica)::BIGINT,
    COUNT(*) FILTER (WHERE NOT fr.tiene_copia_fisica)::BIGINT,
    ROUND(
      COUNT(*) FILTER (WHERE fr.tiene_copia_fisica)::NUMERIC
      / NULLIF(COUNT(*), 0) * 100,
      1
    ),
    COALESCE(SUM(fr.imp_total), 0),
    COUNT(DISTINCT fr.nro_doc_emisor)::BIGINT
  FROM factura_recibida fr
  WHERE
        (p_anio IS NULL OR EXTRACT(YEAR  FROM fr.fecha_emision) = p_anio)
    AND (p_mes  IS NULL OR EXTRACT(MONTH FROM fr.fecha_emision) = p_mes);
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. RPC: toggle de copia física (escritura)
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS update_copia_fisica(bigint, boolean);

CREATE FUNCTION update_copia_fisica(
  p_id          BIGINT,
  p_tiene_copia BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE factura_recibida
     SET tiene_copia_fisica = p_tiene_copia,
         updated_at         = NOW()
   WHERE id = p_id;
END;
$$;
