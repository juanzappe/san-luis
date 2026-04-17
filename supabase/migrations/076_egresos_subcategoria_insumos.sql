-- 076_egresos_subcategoria_insumos.sql
--
-- Reorganización conceptual de egresos:
-- 1. Zambernardi (único honorario) pasa de "Servicios profesionales" a "Honorarios".
-- 2. Nueva columna `proveedor.subcategoria` para desglosar Insumos en
--    alimentos / bebidas / limpieza / papeleria / otros.
-- 3. Pre-llenado con heurística por palabras clave en razon_social.
--    Casos ambiguos quedan en 'otros' para revisión manual.

-- 1. Zambernardi -> Honorarios
UPDATE proveedor
SET categoria_egreso = 'Honorarios'
WHERE razon_social ILIKE '%ZAMBERNARDI%';

-- 2. Columna subcategoria
ALTER TABLE proveedor ADD COLUMN IF NOT EXISTS subcategoria TEXT;

-- 3. Heurística para Insumos
UPDATE proveedor SET subcategoria = CASE
  WHEN razon_social ~* '(CAFE|QUILMES|CERVEZA| VINO|BOLSA DE CAFE|SOCIEDAD DE BEBIDAS|VENDING)'
    THEN 'bebidas'
  WHEN razon_social ~* '(ENVASES|EMBALAJE|PACKAGING|CAJAS|CITY PACK|ACRILICO|BAZAR|PELUNCHA)'
    THEN 'papeleria'
  WHEN razon_social ~* '(PANIFIC|PANADERIL|AVICOLA|FRIGORIFICO|ALIMENTOS|ALIMENTARIA|GASTRONOMIA|CATERING|TAMBO|LACTEO|SERENISIMA|MANTEQUERIA|GRANED|MIGA|NUTRISUPLE|GLUTEN|GRANJA ECOL|AGRO FATIMA|CAMPO 90|DISVAC|INSUMOS PANADERIL|NINI|MAGMA DEL SUR|SABORES|PIMPOLLO|CARDENAS|DOLORES|PDMG|FAZIO|NAVACERRADA|DISTRIBUIDORA BERISSO|RAMA S\.R\.L\.)'
    THEN 'alimentos'
  ELSE 'otros'
END
WHERE categoria_egreso = 'Insumos';

COMMENT ON COLUMN proveedor.subcategoria IS
  'Subcategoría dentro de categoria_egreso. Para Insumos: alimentos/bebidas/limpieza/papeleria/otros. Pre-llenada con heurística por keywords; editable manualmente.';
