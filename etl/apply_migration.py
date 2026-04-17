"""Aplica una migration SQL usando la conexión configurada en .env.

Uso: python apply_migration.py ../supabase/migrations/084_materialized_views_aggregators.sql
"""

import sys
from pathlib import Path
from utils import get_db_connection, setup_logging

logger = setup_logging()


def main():
    if len(sys.argv) != 2:
        print("Uso: python apply_migration.py <path-to-sql-file>")
        sys.exit(1)

    path = Path(sys.argv[1])
    if not path.exists():
        print(f"No existe: {path}")
        sys.exit(1)

    sql = path.read_text(encoding="utf-8")
    logger.info(f"Aplicando {path.name} ({len(sql)} bytes)...")

    conn = get_db_connection()
    conn.autocommit = False  # respetar BEGIN/COMMIT del archivo
    try:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()
        logger.info(f"Migration aplicada OK")
    except Exception as e:
        conn.rollback()
        logger.error(f"Error aplicando migration: {e}")
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
