-- ============================================================================
-- sql/22_categorias_eliminables.sql — Subcategorías huérfanas (2026-11-26)
--
-- Permite borrar una categoría sin borrar sus subcategorías. Las subcategorías
-- quedan con category_slug = NULL ("sin categoría") hasta que el ADMIN las
-- asigne a otra categoría.
--
-- Idempotente.
-- ============================================================================

alter table public.map_subcategories
  drop constraint if exists map_subcategories_category_slug_fkey;

alter table public.map_subcategories
  alter column category_slug drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'map_subcategories_category_slug_fkey'
      and conrelid = 'public.map_subcategories'::regclass
  ) then
    alter table public.map_subcategories
      add constraint map_subcategories_category_slug_fkey
      foreign key (category_slug) references public.map_categories(slug)
      on update cascade on delete set null;
  end if;
end;
$$;

select column_name, is_nullable
from information_schema.columns
where table_schema='public' and table_name='map_subcategories'
  and column_name='category_slug';
