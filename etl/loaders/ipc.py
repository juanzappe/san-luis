"""Loader: IPC → indicador_macro.

Seed de datos IPC (INDEC, base dic-2016=100) para ajuste por inflación.
Fuente: valores publicados por INDEC, serie IPC Nacional nivel general.
"""

from utils import delete_where, batch_insert


# IPC Nacional nivel general (INDEC, base dic-2016 = 100)
# Fuente: https://www.indec.gob.ar/indec/web/Nivel4-Tema-3-5-31
IPC_DATA = {
    "2024-01": 3531.0,
    "2024-02": 3996.5,
    "2024-03": 4436.2,
    "2024-04": 4822.9,
    "2024-05": 5038.9,
    "2024-06": 5265.1,
    "2024-07": 5478.2,
    "2024-08": 5710.9,
    "2024-09": 5914.1,
    "2024-10": 6079.3,
    "2024-11": 6237.7,
    "2024-12": 6390.8,
    "2025-01": 6554.7,
    "2025-02": 6717.7,
    "2025-03": 6898.1,
    "2025-04": 7092.3,
    "2025-05": 7260.5,
    "2025-06": 7434.1,
    "2025-07": 7580.8,
    "2025-08": 7741.1,
    "2025-09": 7899.4,
    "2025-10": 8053.7,
    "2025-11": 8197.2,
    "2025-12": 8344.8,
    "2026-01": 8506.1,
    "2026-02": 8671.5,
}


def run(conn, logger, full: bool = False) -> int:
    records = []
    sorted_keys = sorted(IPC_DATA.keys())

    for i, periodo in enumerate(sorted_keys):
        valor = IPC_DATA[periodo]
        fecha = f"{periodo}-01"

        # Variación mensual
        var_mensual = None
        if i > 0:
            prev = IPC_DATA[sorted_keys[i - 1]]
            var_mensual = round((valor / prev - 1) * 100, 2)

        # Variación interanual
        var_interanual = None
        year, month = periodo.split("-")
        prev_year_key = f"{int(year) - 1}-{month}"
        if prev_year_key in IPC_DATA:
            prev_year_val = IPC_DATA[prev_year_key]
            var_interanual = round((valor / prev_year_val - 1) * 100, 2)

        records.append({
            "tipo": "ipc",
            "fecha": fecha,
            "valor": valor,
            "variacion_mensual": var_mensual,
            "variacion_interanual": var_interanual,
            "fuente_api": "INDEC - IPC Nacional nivel general (base dic-2016=100)",
        })

    delete_where(conn, "indicador_macro", "tipo", "ipc")
    count = batch_insert(conn, "indicador_macro", records)
    logger.info(f"  {count} registros IPC cargados (ene-2024 a feb-2026)")
    return count
