-- Migration 005: Create factura_emitida_detalle table for SERVICIOS line items
-- Source: DETALLE.txt from CABECERA+DETALLE ZIPs in data_raw/SERVICIOS/

CREATE TABLE IF NOT EXISTS factura_emitida_detalle (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    factura_id       BIGINT REFERENCES factura_emitida(id) ON DELETE CASCADE,
    renglon          INTEGER,
    descripcion      TEXT,
    cantidad         NUMERIC(15,4),
    precio_unitario  NUMERIC(15,4),
    bonificacion     NUMERIC(15,4),
    importe          NUMERIC(15,2),
    alicuota_iva     NUMERIC(5,2),
    codigo_operacion TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_fed_factura ON factura_emitida_detalle(factura_id);
