-- =============================================================================
-- Sprint contable · categorías para deudas (impuestos, sueldos, alquiler, etc)
-- =============================================================================
--
-- Permite separar deudas comerciales (proveedores) de deudas fiscales
-- (IVA, Autónomos, Cargas sociales, Ingresos Brutos, ARCA) y
-- estructurales (alquiler, sueldos, servicios). Habilita filtros
-- "Impuestos", "Proveedores", "Por vencer" y exportables contables
-- útiles para el contador.

do $$ begin
  create type debt_category as enum (
    'supplier',     -- Proveedor (carne, lácteos, panificados, etc)
    'tax',          -- Impuesto (IVA, Autónomos, IIBB, ARCA)
    'loan',         -- Préstamo bancario o privado
    'rent',         -- Alquiler de local
    'utility',      -- Servicios (luz, gas, agua, internet)
    'payroll',      -- Sueldos y cargas sociales
    'other'         -- Otros
  );
exception when duplicate_object then null; end $$;

alter table debts
  add column if not exists category debt_category not null default 'supplier',
  add column if not exists period text,        -- "Abril 2026", "Mayo 2026"
  add column if not exists organism text;      -- "ARCA", "AFIP", "ARBA", "Banco Galicia"

create index if not exists debts_category_idx on debts(business_id, category, status);
