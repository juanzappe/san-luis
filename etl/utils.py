"""Utilidades compartidas para el pipeline ETL de San Luis."""

import os
import re
import logging
from datetime import datetime, date
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

# ---------------------------------------------------------------------------
# Conexión Supabase
# ---------------------------------------------------------------------------

def get_supabase() -> Client:
    """Crea y retorna un cliente Supabase con SERVICE_ROLE key."""
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_KEY"]
    return create_client(url, key)


def get_data_raw_path() -> Path:
    """Retorna la ruta a data_raw/."""
    return Path(os.environ.get("DATA_RAW_PATH", "../data_raw"))


# ---------------------------------------------------------------------------
# Parseo de formatos argentinos
# ---------------------------------------------------------------------------

def parse_monto_argentino(texto: str) -> float | None:
    """Parsea un monto en formato argentino (1.234.567,89) a float.

    Regla: quitar puntos PRIMERO, luego reemplazar coma por punto.
    """
    if texto is None or (isinstance(texto, str) and texto.strip() == ""):
        return None
    if isinstance(texto, (int, float)):
        return float(texto)
    t = str(texto).strip()
    # Quitar prefijo $ y espacios
    t = t.replace("$", "").strip()
    # Quitar puntos de miles PRIMERO
    t = t.replace(".", "")
    # Coma decimal → punto
    t = t.replace(",", ".")
    try:
        return float(t)
    except ValueError:
        return None


def parse_fecha_argentina(texto: str) -> str | None:
    """Parsea DD/MM/YYYY → YYYY-MM-DD string."""
    if texto is None:
        return None
    t = str(texto).strip()
    if not t:
        return None
    for fmt in ("%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(t, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    # Intentar ISO ya parseada
    if re.match(r"\d{4}-\d{2}-\d{2}", t):
        return t[:10]
    return None


def parse_fecha_datetime(texto) -> str | None:
    """Parsea datetime de Excel o string variados a YYYY-MM-DD."""
    if texto is None:
        return None
    if isinstance(texto, (datetime, date)):
        return texto.strftime("%Y-%m-%d")
    return parse_fecha_argentina(str(texto))


def safe_int(val) -> int | None:
    """Convierte a int de forma segura."""
    if val is None:
        return None
    try:
        return int(float(val))
    except (ValueError, TypeError):
        return None


def safe_float(val) -> float | None:
    """Convierte a float de forma segura."""
    if val is None:
        return None
    if isinstance(val, (int, float)):
        return float(val)
    return parse_monto_argentino(str(val))


def safe_str(val) -> str | None:
    """Convierte a string limpio o None."""
    if val is None:
        return None
    s = str(val).strip()
    return s if s else None


# ---------------------------------------------------------------------------
# Batch operations
# ---------------------------------------------------------------------------

def batch_upsert(sb: Client, tabla: str, datos: list[dict],
                 on_conflict: str, batch_size: int = 500) -> int:
    """Upsert en batches. Retorna total de registros procesados."""
    total = 0
    for i in range(0, len(datos), batch_size):
        batch = datos[i:i + batch_size]
        sb.table(tabla).upsert(batch, on_conflict=on_conflict).execute()
        total += len(batch)
    return total


def batch_insert(sb: Client, tabla: str, datos: list[dict],
                 batch_size: int = 500) -> int:
    """Insert en batches (ignora duplicados con on_conflict si hay unique).
    Retorna total de registros procesados."""
    total = 0
    for i in range(0, len(datos), batch_size):
        batch = datos[i:i + batch_size]
        sb.table(tabla).insert(batch).execute()
        total += len(batch)
    return total


# ---------------------------------------------------------------------------
# CSV helpers
# ---------------------------------------------------------------------------

def clean_arca_csv(path: str | Path) -> pd.DataFrame:
    """Lee un CSV de ARCA (UTF-8 BOM, separador ;, montos argentinos)."""
    df = pd.read_csv(
        path,
        sep=";",
        encoding="utf-8-sig",
        dtype=str,
        keep_default_na=False,
    )
    # Limpiar nombres de columnas (strip BOM residual y espacios)
    df.columns = [c.strip().strip("\ufeff") for c in df.columns]
    return df


def clean_wrapped_csv(path: str | Path) -> pd.DataFrame:
    """Lee un CSV con wrapping ="..." (impuestos nacionales)."""
    df = pd.read_csv(
        path,
        encoding="utf-8-sig",
        dtype=str,
        keep_default_na=False,
        skiprows=1,  # Skip CUIT header line
    )
    # Quitar wrapping ="..." de todos los valores
    for col in df.columns:
        df[col] = df[col].apply(lambda x: re.sub(r'^="(.*)"$', r"\1", str(x).strip()))
    df.columns = [re.sub(r'^="(.*)"$', r"\1", c.strip()) for c in df.columns]
    return df


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

def setup_logging() -> logging.Logger:
    """Configura logging estándar para el ETL."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    return logging.getLogger("etl")
