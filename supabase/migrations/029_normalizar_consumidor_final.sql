-- 029_normalizar_consumidor_final.sql
-- Unifica "Sin nombre", "CUIT GENERICO" y CUIT 20111111112 bajo la
-- denominación "Consumidor Final" en get_comercial_clientes().
--
-- El frontend agrega por CUIT (ver commercial-queries.ts), por lo que se
-- normaliza también el CUIT al valor canónico '20111111112'; de lo contrario,
-- cada CUIT distinto aparecería como entrada separada en el ranking aunque
-- tenga el mismo nombre.
--
-- Verificación previa recomendada (ejecutar en Supabase SQL Editor):
--   SELECT DISTINCT nro_doc_receptor, denominacion_receptor
--   FROM factura_emitida
--   WHERE denominacion_receptor ILIKE '%generico%'
--      OR denominacion_receptor ILIKE '%sin nombre%'
--      OR nro_doc_receptor = '20111111112';
-- Si aparecen otros CUITs genéricos, agregar condición adicional al CASE.

SET search_path = public;

CREATE OR REPLACE FUNCTION get_comercial_clientes()
RETURNS TABLE(
  periodo       text,
  cuit          text,
  denominacion  text,
  total_neto    numeric,
  cantidad      bigint,
  tipo_comprobante int,
  tipo_entidad  text,
  clasificacion text
) AS $$
  -- Condición de normalización compartida: cliente genérico / consumidor final
  -- Condición: CUIT conocido de consumidor final, "sin nombre" o "cuit generico"
  SELECT
    TO_CHAR(fe.fecha_emision, 'YYYY-MM'),

    -- CUIT normalizado: todos los genéricos → CUIT canónico de consumidor final
    CASE
      WHEN fe.nro_doc_receptor = '20111111112'
        OR fe.denominacion_receptor ILIKE '%sin nombre%'
        OR fe.denominacion_receptor ILIKE '%cuit generico%'
        OR fe.denominacion_receptor IS NULL
      THEN '20111111112'
      ELSE COALESCE(fe.nro_doc_receptor, 'SIN_CUIT')
    END,

    -- Denominación normalizada
    CASE
      WHEN fe.nro_doc_receptor = '20111111112'
        OR fe.denominacion_receptor ILIKE '%sin nombre%'
        OR fe.denominacion_receptor ILIKE '%cuit generico%'
        OR fe.denominacion_receptor IS NULL
      THEN 'Consumidor Final'
      ELSE fe.denominacion_receptor
    END,

    SUM(COALESCE(fe.imp_neto_gravado_total, 0)),
    COUNT(*),
    fe.tipo_comprobante::int,

    -- Tipo de entidad (segmento): genéricos → 'Privado'
    CASE
      WHEN fe.nro_doc_receptor = '20111111112'
        OR fe.denominacion_receptor ILIKE '%sin nombre%'
        OR fe.denominacion_receptor ILIKE '%cuit generico%'
        OR fe.denominacion_receptor IS NULL
      THEN 'Privado'
      ELSE COALESCE(c.tipo_entidad, 'Sin clasificar')
    END,

    COALESCE(c.clasificacion, 'Sin clasificar')

  FROM factura_emitida fe
  LEFT JOIN cliente c ON c.cuit = fe.nro_doc_receptor
  GROUP BY 1, 2, 3, 6, 7, 8
$$ LANGUAGE sql STABLE
SET statement_timeout = '30s';
