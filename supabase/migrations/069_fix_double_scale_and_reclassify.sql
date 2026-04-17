-- Migration 069: Fix double-applied scale + reclasificar a 6 categorías.
--
-- Contexto:
--   La migración 067 (scale + classification) corrió dos veces. Como el UPDATE
--   de scale no era idempotente, cada ejecución dividía cantidad por 1000 y
--   multiplicaba importe por 1000 — ahora están 1000x off en la dirección
--   opuesta.
--
-- Esta migración:
--   1. Undo del scale duplicado: cantidad *= 1000, importe /= 1000.
--   2. Drop de columna es_convenio_marco si quedó de una versión intermedia.
--   3. Reclasifica en las 6 categorías actuales (convenio_marco exclusivo).
--
-- Es SEGURO correr esta migración exactamente UNA vez con el estado actual
-- (scale doble-aplicado). Correr dos veces volvería a romper el scale.
-- Verificación rápida: después de esta migración, factura PV6 nro 4329
-- ("Servicios de viandas por el mes de enero") debe tener cantidad=1420 e
-- importe=1136000.

BEGIN;

-- 1) Undo scale doble: cantidad × 1000, importe ÷ 1000
UPDATE factura_emitida_detalle
SET cantidad = cantidad * 1000,
    importe  = importe / 1000
WHERE cantidad IS NOT NULL OR importe IS NOT NULL;

-- 2) Limpiar columna flag intermedia si quedó
ALTER TABLE factura_emitida_detalle DROP COLUMN IF EXISTS es_convenio_marco;

-- 3) Reclasificar en 6 categorías exclusivas
UPDATE factura_emitida_detalle
SET tipo_servicio = CASE

  WHEN descripcion ~* 'rengl[óo]n'                       THEN 'convenio_marco'

  WHEN descripcion ILIKE '%vianda%'                      THEN 'viandas'

  WHEN descripcion ILIKE '%servicio de caf%'             THEN 'servicio_cafe'
  WHEN descripcion ILIKE '%termo%'                       THEN 'servicio_cafe'

  WHEN descripcion ILIKE '%catering%'                    THEN 'catering'
  WHEN descripcion ILIKE '%refrigerio%'                  THEN 'catering'
  WHEN descripcion ILIKE '%venue%'                       THEN 'catering'
  WHEN descripcion ILIKE '%cena%'                        THEN 'catering'
  WHEN descripcion ILIKE '%evento%'                      THEN 'catering'
  WHEN descripcion ILIKE '%desayuno%'                    THEN 'catering'
  WHEN descripcion ILIKE '%merienda%'                    THEN 'catering'
  WHEN descripcion ILIKE '%almuerzo%'                    THEN 'catering'

  WHEN descripcion ILIKE '%medialuna%'                   THEN 'mostrador'
  WHEN descripcion ILIKE '%triple%'                      THEN 'mostrador'
  WHEN descripcion ILIKE '%sandwich%'                    THEN 'mostrador'
  WHEN descripcion ILIKE '%sándwich%'                    THEN 'mostrador'
  WHEN descripcion ILIKE '%empanada%'                    THEN 'mostrador'
  WHEN descripcion ILIKE '%tostado%'                     THEN 'mostrador'
  WHEN descripcion ILIKE '%chip%'                        THEN 'mostrador'
  WHEN descripcion ILIKE '%masa%'                        THEN 'mostrador'
  WHEN descripcion ILIKE '%factura%'                     THEN 'mostrador'
  WHEN descripcion ILIKE '%gaseosa%'                     THEN 'mostrador'
  WHEN descripcion ILIKE '%agua%'                        THEN 'mostrador'
  WHEN descripcion ILIKE '%jugo%'                        THEN 'mostrador'
  WHEN descripcion ILIKE '%caf%'                         THEN 'mostrador'

  ELSE 'otros'
END;

COMMIT;
