# San Luis — App de Gestión Empresarial

App de gestión integral para **Confitería San Luis / Nadal y Zaccaro S.A.**

## Quick Start

### 1. Base de datos
```bash
# Crear proyecto en https://supabase.com
# Correr las migrations
psql $SUPABASE_DB_URL < supabase/migrations/001_schema.sql
```

### 2. Frontend
```bash
cd web
npm install
cp .env.example .env.local  # Configurar SUPABASE_URL y SUPABASE_ANON_KEY
npm run dev
```

### 3. Importador Python
```bash
cd importador
pip install -r requirements.txt
cp config.example.py config.py  # Configurar SUPABASE_URL y SUPABASE_KEY
python importar.py --help
```

## Documentación

- [Especificación funcional](docs/especificacion_funcional.md)
- [Modelo de datos v2](docs/modelo_datos_v2.md)
- [Infraestructura](docs/infraestructura.md)

## Datos de ejemplo

La carpeta `datos-ejemplo/` contiene archivos reales anonimizados para testear los parsers.
