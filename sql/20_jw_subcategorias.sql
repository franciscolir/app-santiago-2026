-- sql/20_jw_subcategorias.sql — JW siempre icono (2026-11-26)
-- Refuerza en BD la herencia: toda subcategoría de la categoría JW usa
-- render_mode='icon', incluso si se crea por API sin pasar por la UI.
create or replace function public.forzar_jw_subcategoria()
returns trigger
language plpgsql
as $function$
begin
  if new.category_slug = 'jw' then
    new.render_mode := 'icon';
  end if;
  return new;
end;
$function$;

drop trigger if exists map_subcategories_jw on public.map_subcategories;
create trigger map_subcategories_jw
  before insert or update on public.map_subcategories
  for each row execute function public.forzar_jw_subcategoria();

update public.map_subcategories set render_mode = 'icon' where category_slug = 'jw';
