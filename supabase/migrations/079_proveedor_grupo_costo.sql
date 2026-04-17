-- 079_proveedor_grupo_costo.sql
--
-- Simplifica la clasificación de proveedores a dos niveles:
--   1) grupo_costo: operativo | comercial
--   2) categoria_egreso: ≤7 operativos + ≤5 comerciales (incl. "Otros" por grupo)
--
-- Operativos (7): Alimentos, Bebidas, Limpieza/Papelería,
--                 Construcción y mantenimiento, Nafta,
--                 Servicios Profesionales, Otros
-- Comerciales (5): Honorarios, Seguros, Telefonía, Servicios públicos, Otros
--
-- La columna `subcategoria` (migración 076) queda deprecada pero se mantiene
-- para no romper consumidores viejos — se pondrá NULL en el proceso.

ALTER TABLE proveedor ADD COLUMN IF NOT EXISTS grupo_costo TEXT;

-- 1. Grupo comercial (explícito por categoría previa)
UPDATE proveedor SET grupo_costo = 'comercial'
WHERE categoria_egreso IN ('Honorarios', 'Seguros', 'Telefonía');

-- 2. Resto → operativo por default (incluye NULL y "Sin categorizar")
UPDATE proveedor SET grupo_costo = 'operativo'
WHERE grupo_costo IS NULL;

-- 3. Consolidar categoria_egreso dentro de cada grupo

-- Operativo: Insumos subcategorizados
UPDATE proveedor SET categoria_egreso = 'Alimentos'
WHERE categoria_egreso = 'Insumos' AND subcategoria = 'alimentos';

UPDATE proveedor SET categoria_egreso = 'Bebidas'
WHERE categoria_egreso = 'Insumos' AND subcategoria = 'bebidas';

UPDATE proveedor SET categoria_egreso = 'Limpieza/Papelería'
WHERE (categoria_egreso = 'Insumos' AND subcategoria IN ('papeleria', 'limpieza'))
   OR categoria_egreso = 'Limpieza';

-- Operativo: casing fix
UPDATE proveedor SET categoria_egreso = 'Servicios Profesionales'
WHERE categoria_egreso = 'Servicios profesionales';

-- Operativo: todo lo demás del grupo operativo fuera del allowlist → Otros
UPDATE proveedor SET categoria_egreso = 'Otros'
WHERE grupo_costo = 'operativo'
  AND (categoria_egreso IS NULL OR categoria_egreso NOT IN (
    'Alimentos', 'Bebidas', 'Limpieza/Papelería',
    'Construcción y mantenimiento', 'Nafta', 'Servicios Profesionales'
  ));

-- 4. Limpiar subcategoria — ya no se usa, info quedó dentro de categoria_egreso
UPDATE proveedor SET subcategoria = NULL;

-- 5. Constraints suaves (check) — fuerzan los valores válidos a nivel DB.
--    Se usa NOT VALID + VALIDATE para no fallar si quedó algún residuo.
ALTER TABLE proveedor DROP CONSTRAINT IF EXISTS proveedor_grupo_costo_chk;
ALTER TABLE proveedor
  ADD CONSTRAINT proveedor_grupo_costo_chk
  CHECK (grupo_costo IS NULL OR grupo_costo IN ('operativo', 'comercial'));

COMMENT ON COLUMN proveedor.grupo_costo IS
  'Nivel alto de clasificación de egreso: operativo (Costos Operativos del P&L) o comercial (Gastos Comerciales).';
