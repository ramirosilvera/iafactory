-- Endurecimiento de seguridad (revisión S1–S14). Estado FINAL de las reglas de acceso del schema factory: como el CI
-- reaplica 0038..0043 en orden, esta migración (la última) es la que manda. Idempotente.

-- S12: el rol admin queda atado al id del usuario (como el rol pc). Una fila admin sin user_id sigue valiendo (compatibilidad
-- hasta el primer rebind, que ocurre más abajo).
create or replace function factory.tiene_rol(r text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    join factory.acceso a on a.email = lower(u.email)
    where u.id = (select auth.uid())
      and u.email_confirmed_at is not null
      and a.rol = r
      and (a.user_id = u.id or (a.rol = 'admin' and a.user_id is null))
  );
$$;
revoke all on function factory.tiene_rol(text) from public;
grant execute on function factory.tiene_rol(text) to authenticated;

-- Rebind del admin a la cuenta confirmada que tiene hoy ese email. Si el dueño recrea su cuenta, correr de nuevo el
-- workflow de migraciones (o este update) la vuelve a atar.
update factory.acceso a set user_id = u.id
  from auth.users u
 where a.rol = 'admin' and lower(u.email) = a.email and u.email_confirmed_at is not null
   and a.user_id is distinct from u.id;

-- S1: la vigencia la decide el SERVIDOR al tomar una orden (antes la decidía el reloj de la PC).
drop policy if exists "ordenes: pc resuelve" on factory.ordenes;
create policy "ordenes: pc resuelve" on factory.ordenes for update
  using (factory.tiene_rol('pc') and estado in ('pendiente','tomada'))
  with check (factory.tiene_rol('pc') and estado in ('tomada','hecha','rechazada','vencida')
              and (estado <> 'tomada' or vigencia_hasta > now()));

-- S9: solo la PC registra toma/resultado; el admin al cancelar solo cambia el estado. (Sin sesión, p. ej. el dueño de la
-- base por migración, no se restringe.)
create or replace function factory.orden_inmutable() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.id is distinct from old.id or new.accion is distinct from old.accion or new.params is distinct from old.params
     or new.creada_at is distinct from old.creada_at or new.creada_por is distinct from old.creada_por
     or new.vigencia_hasta is distinct from old.vigencia_hasta then
    raise exception 'una orden no puede modificarse, solo cambia de estado';
  end if;
  if (select auth.uid()) is not null and not factory.tiene_rol('pc')
     and (new.tomada_at is distinct from old.tomada_at or new.resuelta_at is distinct from old.resuelta_at
          or new.resultado is distinct from old.resultado) then
    raise exception 'solo la PC registra el resultado de una orden';
  end if;
  return new;
end $$;

-- S10: el conteo solo lo ve un miembro (la policy de insert lo llama como admin).
create or replace function factory.cantidad_pendientes() returns integer
language sql stable security definer set search_path = ''
as $$
  select case when factory.es_miembro()
    then (select count(*)::int from factory.ordenes where estado = 'pendiente' and vigencia_hasta > now())
    else 0 end;
$$;
revoke all on function factory.cantidad_pendientes() from public;
grant execute on function factory.cantidad_pendientes() to authenticated;

-- S13: la PC puede borrar claves de estado de proyectos que ya no existen.
grant delete on factory.estado to authenticated;
drop policy if exists "estado: pc borra" on factory.estado;
create policy "estado: pc borra" on factory.estado for delete using (factory.tiene_rol('pc'));
