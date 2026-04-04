-- Create iibb_posicion table with SIFERE data for IIBB fiscal position.
-- Each row represents one month's IIBB position: deuda, saldo a favor,
-- compensaciones recibidas (retenciones bancarias) and enviadas (pagos).

CREATE TABLE iibb_posicion (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  periodo TEXT NOT NULL,
  deuda NUMERIC DEFAULT 0,
  saldo_a_favor NUMERIC DEFAULT 0,
  compensaciones_recibidas NUMERIC DEFAULT 0,
  compensaciones_enviadas NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(periodo)
);

INSERT INTO iibb_posicion (periodo, deuda, saldo_a_favor, compensaciones_recibidas, compensaciones_enviadas) VALUES
('2024-01', 0, 0, 1129199.80, 3320986.92),
('2024-02', 0, 0, 1956698.50, 3580848.56),
('2024-03', 0, 0, 3483201.60, 2248683.95),
('2024-04', 0, 0, 3190140.70, 4014691.31),
('2024-05', 0, 0, 3583259.30, 5205702.23),
('2024-06', 0, 0, 3288578.80, 4404591.99),
('2024-07', 0, 0, 5307523.50, 4480124.57),
('2024-08', 0, 0, 5382893.90, 6278326.61),
('2024-09', 0, 0, 7301137.60, 8018175.23),
('2024-10', 0, 0, 6379989.30, 6818090.55),
('2024-11', 0, 0, 9023992.70, 7196031.94),
('2024-12', 0, 0, 7196031.94, 7215484.20),
('2025-01', 0, 0, 2946473.30, 9171012.82),
('2025-02', 0, 0, 4496549.50, 7566426.43),
('2025-03', 0, 0, 6661212.30, 7718652.81),
('2025-04', 0, 0, 5685541.00, 7369932.20),
('2025-05', 0, 0, 7122232.50, 6998678.11),
('2025-06', 0, 0, 4423573.20, 6206367.25),
('2025-07', 0, 0, 9669217.50, 7379620.50),
('2025-08', 0, 0, 5859604.70, 7672329.05),
('2025-09', 0, 0, 4752933.10, 5964565.34),
('2025-10', 0, 4465080.95, 9849696.20, 4788909.69),
('2025-11', 0, 6424573.74, 8025865.80, 0),
('2025-12', 0, 9593428.62, 5975649.60, 0),
('2026-01', 0, 14836182.74, 2583429.70, 0),
('2026-02', 0, 8431707.92, 0, 0);
