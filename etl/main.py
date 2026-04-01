"""Orquestador principal del pipeline ETL de San Luis.

Uso:
    python main.py                  # Incremental: solo datos nuevos
    python main.py --full           # Full reload: borra e importa todo
    python main.py mostrador        # Incremental de un loader
    python main.py mostrador --full # Full reload de un loader
"""

import sys
import time

from utils import setup_logging, get_db_connection

# Importar todos los loaders
from loaders import (
    productos,
    arca_ingresos,
    arca_egresos,
    sueldos,
    banco_provincia,
    mercado_pago,
    movimientos_caja,
    mostrador,
    inversiones,
    impuestos_nacionales,
    impuestos_municipales,
    eecc,
    servicios,
    segmentacion,
    ipc,
)

# Orden de ejecución respetando dependencias FK
LOADERS = [
    ("productos", productos),
    ("arca_ingresos", arca_ingresos),
    ("arca_egresos", arca_egresos),
    ("sueldos", sueldos),
    ("banco_provincia", banco_provincia),
    ("mercado_pago", mercado_pago),
    ("movimientos_caja", movimientos_caja),
    ("mostrador", mostrador),
    ("inversiones", inversiones),
    ("impuestos_nacionales", impuestos_nacionales),
    ("impuestos_municipales", impuestos_municipales),
    ("eecc", eecc),
    ("servicios", servicios),
    ("segmentacion", segmentacion),
    ("ipc", ipc),
]


def main():
    logger = setup_logging()
    conn = get_db_connection()

    # Parse arguments: loader names + --full flag
    args = sys.argv[1:]
    full_reload = "--full" in args
    loader_names = [a for a in args if not a.startswith("--")]

    mode = "FULL RELOAD" if full_reload else "INCREMENTAL"

    # Filtrar loaders si se pasan como argumento
    if loader_names:
        selected = set(loader_names)
        loaders_to_run = [(n, m) for n, m in LOADERS if n in selected]
        unknown = selected - {n for n, _ in LOADERS}
        if unknown:
            logger.error(f"Loaders desconocidos: {unknown}")
            logger.info(f"Disponibles: {[n for n, _ in LOADERS]}")
            sys.exit(1)
    else:
        loaders_to_run = LOADERS

    logger.info(f"=== Pipeline ETL San Luis — {len(loaders_to_run)} loaders ({mode}) ===")
    results = []

    for name, module in loaders_to_run:
        logger.info(f"--- Iniciando: {name} ({mode}) ---")
        t0 = time.time()
        try:
            count = module.run(conn, logger, full=full_reload)
            elapsed = time.time() - t0
            logger.info(f"✓ {name}: {count} registros en {elapsed:.1f}s")
            results.append((name, count, elapsed, None))
        except Exception as e:
            elapsed = time.time() - t0
            logger.error(f"✗ {name}: {e} ({elapsed:.1f}s)", exc_info=True)
            results.append((name, 0, elapsed, str(e)))

    # Resumen
    logger.info("=== RESUMEN ===")
    total_ok = 0
    total_err = 0
    for name, count, elapsed, error in results:
        if error:
            logger.info(f"  ✗ {name}: ERROR — {error}")
            total_err += 1
        else:
            logger.info(f"  ✓ {name}: {count} registros ({elapsed:.1f}s)")
            total_ok += 1

    logger.info(f"Total: {total_ok} exitosos, {total_err} con error")
    conn.close()


if __name__ == "__main__":
    main()
