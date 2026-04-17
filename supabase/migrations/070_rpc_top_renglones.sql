-- Migration 070: RPC get_servicios_top_renglones.
--
-- Extrae el número de renglón de las descripciones ("Renglón 3", "3 Renglón 15",
-- "renglón 15: racionamiento; ...") con regex y agrupa por número. Evita que
-- el mismo renglón con descripciones ligeramente distintas aparezca varias veces.
--
-- Asigna el imp_neto_gravado del header en proporción a detalle.importe
-- (mismo patrón que las otras RPCs de la sección).

DROP FUNCTION IF EXISTS get_servicios_top_renglones(int);

CREATE OR REPLACE FUNCTION get_servicios_top_renglones(p_limit int DEFAULT 25)
RETURNS TABLE(
    numero     int,
    monto_neto numeric,
    cantidad   numeric,
    lineas     bigint,
    clientes   bigint,
    ejemplo    text
) AS $$
    WITH importe_por_factura AS (
        SELECT fed.factura_id, SUM(fed.importe) AS sum_importe
        FROM factura_emitida_detalle fed
        GROUP BY 1
    ),
    detalle_renglon AS (
        SELECT
            -- Capturar el PRIMER número que aparece después de "renglón N".
            -- Previene capturar números de dates o prefijos como "1 Renglón 3".
            (REGEXP_MATCH(fed.descripcion, 'rengl[óo]n\s*(\d+)', 'i'))[1]::int AS numero,
            COALESCE(fed.cantidad, 0) AS cantidad,
            fe.nro_doc_receptor,
            fed.descripcion,
            CASE
                WHEN COALESCE(ipf.sum_importe, 0) > 0
                THEN COALESCE(fed.importe, 0) * COALESCE(fe.imp_neto_gravado_total, 0) / ipf.sum_importe
                ELSE 0
            END AS monto_neto,
            CASE WHEN fe.tipo_comprobante IN (3, 8, 203) THEN -1 ELSE 1 END AS signo
        FROM factura_emitida fe
        JOIN factura_emitida_detalle fed ON fed.factura_id = fe.id
        LEFT JOIN importe_por_factura ipf ON ipf.factura_id = fe.id
        WHERE fe.punto_venta = 6
          AND fed.descripcion ~* 'rengl[óo]n\s*\d+'
    )
    SELECT
        numero,
        SUM(signo * monto_neto) AS monto_neto,
        SUM(signo * cantidad)   AS cantidad,
        COUNT(*)                AS lineas,
        COUNT(DISTINCT nro_doc_receptor) AS clientes,
        -- Descripción más larga como "ejemplo" (suele ser la más descriptiva).
        (ARRAY_AGG(descripcion ORDER BY LENGTH(descripcion) DESC))[1] AS ejemplo
    FROM detalle_renglon
    WHERE numero IS NOT NULL
    GROUP BY numero
    ORDER BY monto_neto DESC
    LIMIT p_limit
$$ LANGUAGE sql STABLE SET statement_timeout = '30s';
