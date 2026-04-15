-- 060_comprobantes_busqueda_extendida.sql
-- Amplía get_comprobantes_recibidos con:
--   - Búsqueda parcial por CUIT (ILIKE en lugar de igualdad exacta)
--   - Filtro por monto total (con tolerancia ±0.99 para redondeos)
--
-- Reemplaza la versión creada en 059_comprobantes_recibidos.sql.

SET search_path = public;

DROP FUNCTION IF EXISTS get_comprobantes_recibidos(
  integer, integer, text, integer, boolean, text, integer, integer
);
DROP FUNCTION IF EXISTS get_comprobantes_recibidos(
  integer, integer, text, integer, boolean, text, numeric, integer, integer
);

CREATE FUNCTION get_comprobantes_recibidos(
  p_anio                INTEGER DEFAULT NULL,
  p_mes                 INTEGER DEFAULT NULL,
  p_cuit                TEXT    DEFAULT NULL,
  p_tipo_comprobante    INTEGER DEFAULT NULL,
  p_tiene_copia_fisica  BOOLEAN DEFAULT NULL,
  p_search              TEXT    DEFAULT NULL,
  p_monto               NUMERIC DEFAULT NULL,
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
    AND (p_cuit               IS NULL OR fr.nro_doc_emisor ILIKE '%' || p_cuit || '%')
    AND (p_tipo_comprobante   IS NULL OR fr.tipo_comprobante = p_tipo_comprobante)
    AND (p_tiene_copia_fisica IS NULL OR fr.tiene_copia_fisica = p_tiene_copia_fisica)
    AND (p_search             IS NULL OR fr.denominacion_emisor ILIKE '%' || p_search || '%')
    AND (p_monto              IS NULL OR fr.imp_total BETWEEN p_monto - 0.99 AND p_monto + 0.99)
  ORDER BY fr.fecha_emision DESC, fr.id DESC
  LIMIT  p_limit
  OFFSET p_offset;
END;
$$;
