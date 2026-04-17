"""Auto-import: detecta cambios en data_raw/ y ejecuta solo los loaders necesarios.

Uso:
    python auto_import.py              # Detecta cambios y corre loaders
    python auto_import.py --dry-run    # Solo muestra qué correría
    python auto_import.py --force      # Ignora timestamp, corre todos
"""

import argparse
import json
import logging
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from utils import get_data_raw_path

SCRIPT_DIR = Path(__file__).resolve().parent

FOLDER_LOADER_MAP = {
    "ARCA_INGRESOS": "arca_ingresos",
    "ARCA_EGRESOS": "arca_egresos",
    "MOVIMIENTOS BANCARIOS/BANCO PROVINCIA": "banco_provincia",
    "MOVIMIENTOS BANCARIOS/BANCO SANTANDER": "movimiento_santander",
    "MOVIMIENTOS BANCARIOS/MERCADO PAGO": "mercado_pago",
    "MOVIMIENTOS DE CAJA": "movimientos_caja",
    "SUELDOS": "sueldos",
    "INVERSIONES": "inversiones",
    "IMPUESTOS NACIONALES": "impuestos_nacionales",
    "IMPUESTOS MUNICIPALES": "impuestos_municipales",
    # "IMPUESTOS PROVINCIALES": "impuestos_provinciales",  # TODO: descomentar cuando se implemente el loader
    "SERVICIOS": "servicios",
    "MOSTRADOR": "mostrador",
    "EECC": "eecc",
    "PRODUCTOS": "productos",
    "SEGMENTACION": "segmentacion",
}

DATA_EXTENSIONS = {".xlsx", ".xls", ".csv", ".txt", ".zip", ".pdf"}

LAST_IMPORT_PATH = SCRIPT_DIR / "last_import.json"
LOG_DIR = SCRIPT_DIR / "logs"
LOG_FILE = LOG_DIR / "auto_import.log"


def setup_logging():
    """Configura logging a archivo y consola."""
    os.makedirs(LOG_DIR, exist_ok=True)

    logger = logging.getLogger("auto_import")
    logger.setLevel(logging.INFO)

    fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s",
                            datefmt="%Y-%m-%d %H:%M:%S")

    fh = logging.FileHandler(LOG_FILE, encoding="utf-8")
    fh.setFormatter(fmt)
    logger.addHandler(fh)

    ch = logging.StreamHandler()
    ch.setFormatter(fmt)
    logger.addHandler(ch)

    return logger


def read_last_run():
    """Lee el timestamp del último import exitoso. Retorna None si no existe."""
    if not LAST_IMPORT_PATH.exists():
        return None
    try:
        with open(LAST_IMPORT_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return datetime.fromisoformat(data["last_run"]).timestamp()
    except (json.JSONDecodeError, KeyError, ValueError):
        return None


def save_last_run(ts):
    """Guarda el timestamp de inicio del run como último import exitoso."""
    iso = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
    with open(LAST_IMPORT_PATH, "w", encoding="utf-8") as f:
        json.dump({"last_run": iso}, f, indent=2)


def folder_has_changes(folder_path, last_run_ts):
    """Verifica si algún archivo de datos en la carpeta tiene mtime posterior a last_run_ts."""
    if not folder_path.exists():
        return False
    for entry in folder_path.rglob("*"):
        if entry.is_file() and entry.suffix.lower() in DATA_EXTENSIONS:
            if os.path.getmtime(entry) > last_run_ts:
                return True
    return False


def detect_changed_loaders(logger, last_run_ts, force=False):
    """Detecta qué loaders necesitan ejecutarse según cambios en data_raw/."""
    data_raw = get_data_raw_path()
    changed = []

    for folder_name, loader_name in FOLDER_LOADER_MAP.items():
        folder_path = data_raw / folder_name

        if force:
            logger.info(f"  [FORCE] {folder_name} → {loader_name}")
            changed.append((folder_name, loader_name))
        elif last_run_ts is None:
            if folder_path.exists():
                logger.info(f"  [NUEVO] {folder_name} → {loader_name}")
                changed.append((folder_name, loader_name))
        else:
            if folder_has_changes(folder_path, last_run_ts):
                logger.info(f"  [MODIFICADO] {folder_name} → {loader_name}")
                changed.append((folder_name, loader_name))

    return changed


def run_loaders(logger, loader_names, dry_run=False):
    """Ejecuta main.py con los loaders indicados. Retorna exit code."""
    cmd = [sys.executable, "main.py"] + loader_names

    logger.info(f"Comando: {' '.join(cmd)}")

    if dry_run:
        logger.info("[DRY-RUN] No se ejecuta el comando.")
        return 0

    result = subprocess.run(cmd, cwd=str(SCRIPT_DIR))
    return result.returncode


def main():
    parser = argparse.ArgumentParser(description="Auto-import ETL San Luis")
    parser.add_argument("--dry-run", action="store_true",
                        help="Solo muestra qué correría sin ejecutar")
    parser.add_argument("--force", action="store_true",
                        help="Ignora el timestamp y corre todos los loaders")
    args = parser.parse_args()

    logger = setup_logging()
    run_start = time.time()

    logger.info("=" * 60)
    logger.info("AUTO-IMPORT iniciado")
    if args.dry_run:
        logger.info("Modo: DRY-RUN")
    if args.force:
        logger.info("Modo: FORCE")

    # Leer último timestamp
    last_run_ts = read_last_run()
    if last_run_ts and not args.force:
        last_dt = datetime.fromtimestamp(last_run_ts, tz=timezone.utc)
        logger.info(f"Último import: {last_dt.isoformat()}")
    elif not args.force:
        logger.info("No hay registro de imports anteriores — se importa todo.")

    # Detectar cambios
    logger.info("Escaneando carpetas en data_raw/...")
    changed = detect_changed_loaders(logger, last_run_ts, force=args.force)

    if not changed:
        logger.info("No hay cambios detectados.")
        logger.info("=" * 60)
        print("\nNo hay cambios detectados.")
        return

    loader_names = [loader for _, loader in changed]
    folder_names = [folder for folder, _ in changed]

    logger.info(f"Carpetas con cambios: {len(changed)}")
    logger.info(f"Loaders a ejecutar: {', '.join(loader_names)}")

    # Ejecutar
    t0 = time.time()
    exit_code = run_loaders(logger, loader_names, dry_run=args.dry_run)
    elapsed = time.time() - t0

    if exit_code == 0:
        logger.info(f"Resultado: ÉXITO en {elapsed:.1f}s")
        if not args.dry_run:
            save_last_run(run_start)
            logger.info("last_import.json actualizado.")
    else:
        logger.error(f"Resultado: ERROR (exit code {exit_code}) en {elapsed:.1f}s")

    # Resumen en consola
    total_elapsed = time.time() - run_start
    logger.info("=" * 60)
    print(f"\n{'=' * 50}")
    print(f"RESUMEN AUTO-IMPORT")
    print(f"{'=' * 50}")
    print(f"Carpetas modificadas ({len(folder_names)}):")
    for f in folder_names:
        print(f"  • {f}")
    print(f"Loaders ejecutados: {', '.join(loader_names)}")
    print(f"Resultado: {'ÉXITO' if exit_code == 0 else f'ERROR (code {exit_code})'}")
    print(f"Duración total: {total_elapsed:.1f}s")
    print(f"{'=' * 50}")


if __name__ == "__main__":
    main()
