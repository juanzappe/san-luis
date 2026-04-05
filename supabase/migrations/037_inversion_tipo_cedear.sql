-- Agregar 'cedear' al enum tipo_inversion_enum para distinguir CEDEARs de acciones locales.
ALTER TYPE tipo_inversion_enum ADD VALUE IF NOT EXISTS 'cedear';
