-- IIBB (Ingresos Brutos) monthly totals from movimiento_bancario.
-- Retenciones ARBA, reversas de retenciones, y percepciones IIBB.
-- Formula: iibb_neto = retenciones - reversas + percepciones

CREATE OR REPLACE FUNCTION get_iibb_mensual()
RETURNS TABLE(periodo text, retenciones numeric, reversas numeric, percepciones numeric, iibb_neto numeric)
AS $$
  SELECT
    TO_CHAR(fecha, 'YYYY-MM') AS periodo,

    COALESCE(SUM(ABS(debito)) FILTER (
      WHERE LOWER(concepto) LIKE 'retencion arba%'
        AND LOWER(concepto) NOT LIKE 'reversa%'
    ), 0) AS retenciones,

    COALESCE(SUM(ABS(credito)) FILTER (
      WHERE LOWER(concepto) LIKE 'reversa retencion arba%'
    ), 0) AS reversas,

    COALESCE(SUM(ABS(debito)) FILTER (
      WHERE (LOWER(concepto) LIKE '%iibb%percepcion%'
          OR LOWER(concepto) LIKE '%i.brutos%percepcion%')
        AND LOWER(concepto) NOT LIKE 'retencion%'
        AND LOWER(concepto) NOT LIKE 'reversa%'
    ), 0) AS percepciones,

    COALESCE(SUM(ABS(debito)) FILTER (
      WHERE LOWER(concepto) LIKE 'retencion arba%'
        AND LOWER(concepto) NOT LIKE 'reversa%'
    ), 0)
    - COALESCE(SUM(ABS(credito)) FILTER (
      WHERE LOWER(concepto) LIKE 'reversa retencion arba%'
    ), 0)
    + COALESCE(SUM(ABS(debito)) FILTER (
      WHERE (LOWER(concepto) LIKE '%iibb%percepcion%'
          OR LOWER(concepto) LIKE '%i.brutos%percepcion%')
        AND LOWER(concepto) NOT LIKE 'retencion%'
        AND LOWER(concepto) NOT LIKE 'reversa%'
    ), 0) AS iibb_neto

  FROM movimiento_bancario
  WHERE LOWER(concepto) LIKE 'retencion arba%'
     OR LOWER(concepto) LIKE 'reversa retencion arba%'
     OR LOWER(concepto) LIKE '%iibb%percepcion%'
     OR LOWER(concepto) LIKE '%i.brutos%percepcion%'
  GROUP BY 1
  ORDER BY 1
$$ LANGUAGE sql STABLE
SET statement_timeout = '30s';
