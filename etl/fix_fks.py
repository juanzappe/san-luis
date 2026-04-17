"""Script puntual: linkea cliente_id, proveedor_id y unidad_negocio_id
en los datos ya existentes en la DB.

Correr una sola vez: python fix_fks.py
"""

from utils import get_db_connection, setup_logging

logger = setup_logging()


def main():
    conn = get_db_connection()

    with conn.cursor() as cur:
        # 1. factura_emitida → cliente_id
        cur.execute("""
            UPDATE factura_emitida fe
            SET cliente_id = c.id
            FROM cliente c
            WHERE c.cuit = fe.nro_doc_receptor
              AND fe.cliente_id IS NULL
        """)
        logger.info(f"factura_emitida → cliente_id: {cur.rowcount} filas linkeadas")

        # 2. factura_emitida → unidad_negocio_id por punto_venta
        pv_to_unidad = {"Mostrador": 8, "Restobar": 998, "Servicios": 6}
        total_un = 0
        for nombre, pv in pv_to_unidad.items():
            cur.execute("""
                UPDATE factura_emitida fe
                SET unidad_negocio_id = un.id
                FROM unidad_negocio un
                WHERE un.nombre = %s
                  AND fe.punto_venta = %s
                  AND fe.unidad_negocio_id IS NULL
            """, (nombre, pv))
            total_un += cur.rowcount
        logger.info(f"factura_emitida → unidad_negocio_id: {total_un} filas linkeadas")

        # 3. factura_recibida → proveedor_id
        cur.execute("""
            UPDATE factura_recibida fr
            SET proveedor_id = p.id
            FROM proveedor p
            WHERE p.cuit = fr.nro_doc_emisor
              AND fr.proveedor_id IS NULL
        """)
        logger.info(f"factura_recibida → proveedor_id: {cur.rowcount} filas linkeadas")

        # 4. Verificación final
        cur.execute("""
            SELECT
              COUNT(*) as total,
              SUM(CASE WHEN cliente_id IS NULL THEN 1 ELSE 0 END) as sin_cliente,
              SUM(CASE WHEN unidad_negocio_id IS NULL THEN 1 ELSE 0 END) as sin_unidad
            FROM factura_emitida
        """)
        row = cur.fetchone()
        logger.info(
            f"VERIFICACIÓN factura_emitida — total: {row[0]}, "
            f"sin cliente_id: {row[1]}, sin unidad_negocio_id: {row[2]}"
        )

        cur.execute("""
            SELECT COUNT(*) as total,
              SUM(CASE WHEN proveedor_id IS NULL THEN 1 ELSE 0 END) as sin_proveedor
            FROM factura_recibida
        """)
        row = cur.fetchone()
        logger.info(
            f"VERIFICACIÓN factura_recibida — total: {row[0]}, "
            f"sin proveedor_id: {row[1]}"
        )

    conn.close()
    logger.info("Fix completado.")


if __name__ == "__main__":
    main()
