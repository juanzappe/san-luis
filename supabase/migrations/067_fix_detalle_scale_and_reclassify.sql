-- Migration 067: 6-category classification for factura_emitida_detalle.
--
-- Scale fix histórico (cantidad / 1000, importe * 1000) se aplicó en una
-- versión anterior de esta migración. Se removió de acá porque NO era
-- idempotente y corrió dos veces → rompió el scale. La corrección definitiva
-- vive en migración 069.
--
-- Esta migración ahora SOLO reclasifica. Es idempotente (cada corrida pone
-- tipo_servicio al mismo valor para cada fila).
--
-- Categorías (orden de prioridad — primera que matchea gana, exclusivas):
--   1. convenio_marco — descripción contiene "renglón" (prioridad absoluta)
--   2. viandas
--   3. servicio_cafe  — servicio de café, termo (café como servicio, no mostrador)
--   4. catering       — catering, refrigerio, venue, cena, evento, desayuno, merienda, almuerzo
--   5. mostrador      — productos de local (medialunas, triples, masas, etc.)
--   6. otros          — fallback (comisión, orden de compra, texto genérico)

BEGIN;

ALTER TABLE factura_emitida_detalle DROP COLUMN IF EXISTS es_convenio_marco;

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
