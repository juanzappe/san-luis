-- RPC functions for server-side IVA aggregation.
-- Replaces client-side row-by-row fetching which hits the Supabase 1000-row limit
-- on tables with ~93k rows (factura_emitida).

-- Used by fetchResumenFiscal() in tax-queries.ts
CREATE OR REPLACE FUNCTION get_iva_mensual()
RETURNS TABLE(periodo text, debito numeric, credito numeric, ingresos numeric)
AS $$
  SELECT
    TO_CHAR(fecha_emision, 'YYYY-MM'),
    SUM(total_iva),
    0::numeric,
    SUM(imp_total)
  FROM factura_emitida
  GROUP BY 1

  UNION ALL

  SELECT
    TO_CHAR(fecha_emision, 'YYYY-MM'),
    0::numeric,
    SUM(total_iva),
    0::numeric
  FROM factura_recibida
  GROUP BY 1
$$ LANGUAGE sql STABLE;

-- Used by fetchPosicionIva() in tax-queries.ts
CREATE OR REPLACE FUNCTION get_posicion_iva_mensual()
RETURNS TABLE(
  periodo text,
  tipo text,
  iva_21 numeric,
  iva_10_5 numeric,
  iva_27 numeric,
  iva_5 numeric,
  iva_2_5 numeric,
  total_iva numeric,
  otros_tributos numeric
) AS $$
  SELECT
    TO_CHAR(fecha_emision, 'YYYY-MM'),
    'debito',
    SUM(iva_21), SUM(iva_10_5), SUM(iva_27),
    SUM(iva_5), SUM(iva_2_5), SUM(total_iva),
    0::numeric
  FROM factura_emitida
  GROUP BY 1

  UNION ALL

  SELECT
    TO_CHAR(fecha_emision, 'YYYY-MM'),
    'credito',
    SUM(iva_21), SUM(iva_10_5), SUM(iva_27),
    SUM(iva_5), SUM(iva_2_5), SUM(total_iva),
    SUM(COALESCE(otros_tributos, 0))
  FROM factura_recibida
  GROUP BY 1
$$ LANGUAGE sql STABLE;
