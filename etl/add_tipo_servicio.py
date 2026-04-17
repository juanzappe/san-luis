"""Script puntual: agrega columna tipo_servicio a factura_emitida_detalle
y la clasifica según la descripcion de cada renglón.

Correr una sola vez: python add_tipo_servicio.py
"""

from utils import get_db_connection, setup_logging

logger = setup_logging()


def main():
    conn = get_db_connection()

    with conn.cursor() as cur:
        # 1. Agregar columna
        cur.execute("""
            ALTER TABLE factura_emitida_detalle
            ADD COLUMN IF NOT EXISTS tipo_servicio TEXT
        """)
        logger.info("Columna tipo_servicio agregada (o ya existia)")

        # 2. Clasificar
        cur.execute("""
            UPDATE factura_emitida_detalle
            SET tipo_servicio = CASE
                WHEN descripcion ILIKE '%vianda%'                           THEN 'racionamiento_vianda'
                WHEN descripcion ILIKE '%racionamiento%'
                 AND descripcion NOT ILIKE '%desayuno%'
                 AND descripcion NOT ILIKE '%merienda%'                     THEN 'racionamiento_vianda'
                WHEN descripcion ILIKE '%desayuno%'                         THEN 'racionamiento_desayuno'
                WHEN descripcion ILIKE '%merienda%'                         THEN 'racionamiento_desayuno'
                WHEN descripcion ILIKE '%catering%'                         THEN 'catering_evento'
                WHEN descripcion ILIKE '%venue%'                            THEN 'catering_evento'
                WHEN descripcion ILIKE '%refrigerio%'                       THEN 'catering_evento'
                WHEN descripcion ILIKE '%servicio de%'                      THEN 'catering_evento'
                WHEN descripcion ILIKE '%café%'                             THEN 'cafe'
                WHEN descripcion ILIKE '%cafe%'                             THEN 'cafe'
                WHEN descripcion ILIKE '%termo%'                            THEN 'cafe'
                WHEN descripcion ILIKE '%medialuna%'                        THEN 'panificados'
                WHEN descripcion ILIKE '%triple%'                           THEN 'panificados'
                WHEN descripcion ILIKE '%empanada%'                         THEN 'panificados'
                WHEN descripcion ILIKE '%sandwich%'                         THEN 'panificados'
                WHEN descripcion ILIKE '%facturas%'                         THEN 'panificados'
                ELSE 'otro'
            END
            WHERE tipo_servicio IS NULL
        """)
        logger.info(f"  {cur.rowcount} renglones clasificados")

        # 3. Verificacion
        cur.execute("""
            SELECT tipo_servicio, COUNT(*) as n
            FROM factura_emitida_detalle
            GROUP BY tipo_servicio
            ORDER BY n DESC
        """)
        rows = cur.fetchall()
        logger.info("Distribucion por tipo_servicio:")
        for row in rows:
            logger.info(f"  {row[0] or 'NULL':30} {row[1]}")

    conn.close()
    logger.info("Completado.")


if __name__ == "__main__":
    main()
