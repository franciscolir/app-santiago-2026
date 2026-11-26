-- ============================================================================
-- sql/21_salud_hospital_sapu.sql — Separar hospitales y SAPU/SAR (2026-11-26)
--
-- La capa externa de salud contenía tres subcategorías de origen:
--   Hospital público (36)
--   SAPU / SAR (158)
--   Hospital público / SAR (75)
--
-- Para la asignación manual se separan en dos subcategorías/capas:
--   Hospitales públicos  -> hospital + hospital/SAR
--   SAPU / SAR           -> SAPU/SAR
--
-- Idempotente.
-- ============================================================================

insert into public.map_subcategories
  (category_slug, slug, name, color, icon, render_mode, layer_key, sort, active)
values
  ('salud','hospitales','Hospitales públicos','#e03131','hospital','auto','salud_hospital',20,true),
  ('salud','sapu-sar','SAPU / SAR','#e03131','health_and_safety','auto','salud_sapu',30,true)
on conflict (category_slug, slug) do update
  set name=excluded.name, color=excluded.color, icon=excluded.icon,
      render_mode=excluded.render_mode, layer_key=excluded.layer_key,
      sort=excluded.sort, active=excluded.active;

-- Reasignar puntos manuales que estuvieran en la antigua subcategoría
-- "Urgencias" a Hospitales públicos, y luego retirar la subcategoría antigua.
update public.map_points p
   set subcategory_id = s.id
  from public.map_subcategories s
 where s.category_slug = 'salud'
   and s.slug = 'hospitales'
   and p.subcategory_id = (
     select id from public.map_subcategories
      where category_slug = 'salud' and slug = 'urgencias'
   );

delete from public.map_subcategories
 where category_slug = 'salud'
   and slug = 'urgencias'
   and layer_key = 'salud';

select category_slug, slug, name, layer_key, color, icon
  from public.map_subcategories
 where category_slug = 'salud'
 order by sort;
