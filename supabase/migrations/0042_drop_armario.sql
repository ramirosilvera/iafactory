-- Borra por completo el schema `armario` (app anterior, ya inexistente), su policy de Storage y el bucket de fotos.
-- Decisión explícita e irreversible del dueño ("borra armario", 2026-11-07). Estado previo verificado: 0 prendas, 0 outfits, 1 foto.
-- Idempotente: reaplicarla no falla.

drop policy if exists "armario-fotos: dueño" on storage.objects;

drop schema if exists armario cascade;

-- Supabase puede bloquear el borrado directo en storage.*; si pasa, no se frena la migración (se borra el bucket desde el panel).
do $$
begin
  delete from storage.objects where bucket_id = 'armario-fotos';
  delete from storage.buckets where id = 'armario-fotos';
exception when others then
  raise notice 'No se pudo borrar el bucket armario-fotos por SQL (%): borrarlo desde Storage en el panel.', sqlerrm;
end $$;

alter role authenticator set pgrst.db_schemas = 'public, factory';
notify pgrst, 'reload config';
