-- Add tipo_servicio column to factura_emitida_detalle
ALTER TABLE factura_emitida_detalle ADD COLUMN IF NOT EXISTS tipo_servicio TEXT;

-- Classify existing descriptions
UPDATE factura_emitida_detalle
SET tipo_servicio = CASE
    -- Racionamiento vianda
    WHEN descripcion ILIKE '%vianda%'                          THEN 'racionamiento_vianda'
    WHEN descripcion ILIKE '%racionamiento%' AND
         descripcion NOT ILIKE '%desayuno%' AND
         descripcion NOT ILIKE '%merienda%'                    THEN 'racionamiento_vianda'

    -- Racionamiento desayuno/merienda
    WHEN descripcion ILIKE '%desayuno%'                        THEN 'racionamiento_desayuno'
    WHEN descripcion ILIKE '%merienda%'                        THEN 'racionamiento_desayuno'

    -- Catering evento
    WHEN descripcion ILIKE '%catering%'                        THEN 'catering_evento'
    WHEN descripcion ILIKE '%venue%'                           THEN 'catering_evento'
    WHEN descripcion ILIKE '%refrigerio%'                      THEN 'catering_evento'
    WHEN descripcion ILIKE '%servicio de%'                     THEN 'catering_evento'

    -- Café
    WHEN descripcion ILIKE '%café%'                            THEN 'cafe'
    WHEN descripcion ILIKE '%cafe%'                            THEN 'cafe'
    WHEN descripcion ILIKE '%termo%'                           THEN 'cafe'

    -- Panificados
    WHEN descripcion ILIKE '%medialuna%'                       THEN 'panificados'
    WHEN descripcion ILIKE '%triple%'                          THEN 'panificados'
    WHEN descripcion ILIKE '%empanada%'                        THEN 'panificados'
    WHEN descripcion ILIKE '%sandwich%'                        THEN 'panificados'
    WHEN descripcion ILIKE '%facturas%'                        THEN 'panificados'

    -- Otro (comisiones, alquiler, órdenes de compra, genéricos)
    ELSE 'otro'
END
WHERE tipo_servicio IS NULL;
