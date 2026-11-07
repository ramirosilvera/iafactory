-- Factory, paso 2: acción 'auditar', límites de tamaño, tope de órdenes en cola y cuenta de la PC.
-- Idempotente: seguro correrlo de nuevo.

-- Cuenta de la PC (rol 'pc'). Es un alias de Gmail (+factory-pc) que llega al mismo buzón: se registra una vez desde la
-- pantalla de entrada de la app, se confirma por mail y la contraseña queda SOLO en la PC (remote/remote.json).
-- Mientras el email no esté confirmado en auth.users, factory.tiene_rol() no le da ningún permiso.
insert into factory.acceso (email, rol) values ('raa1990.rs+factory-pc@gmail.com', 'pc')
on conflict (email) do nothing;

-- Acciones permitidas (la lista permitida del lado de la PC es la que manda; esta es la segunda barrera).
alter table factory.ordenes drop constraint if exists ordenes_accion_check;
alter table factory.ordenes add constraint ordenes_accion_check
  check (accion in ('pausar_ejecutor','reanudar_ejecutor','encolar','aprobar_item','descartar_item','auditar'));

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ordenes_params_chk') then
    alter table factory.ordenes add constraint ordenes_params_chk
      check (jsonb_typeof(params) = 'object' and pg_column_size(params) < 2048);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ordenes_resultado_chk') then
    alter table factory.ordenes add constraint ordenes_resultado_chk check (resultado is null or char_length(resultado) <= 300);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'eventos_titulo_chk') then
    alter table factory.eventos add constraint eventos_titulo_chk
      check (char_length(titulo) <= 200 and (detalle is null or pg_column_size(detalle) < 2048));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'estado_valor_chk') then
    alter table factory.estado add constraint estado_valor_chk check (pg_column_size(valor) < 65536);
  end if;
end $$;

-- Tope: como mucho 50 órdenes pendientes a la vez (si alguien entra con tu cuenta, no puede inundar la cola).
create or replace function factory.cantidad_pendientes() returns integer
language sql stable security definer set search_path = ''
as $$ select count(*)::int from factory.ordenes where estado = 'pendiente'; $$;
revoke all on function factory.cantidad_pendientes() from public;
grant execute on function factory.cantidad_pendientes() to authenticated;

drop policy if exists "ordenes: admin crea" on factory.ordenes;
create policy "ordenes: admin crea" on factory.ordenes for insert
  with check (factory.tiene_rol('admin') and estado = 'pendiente'
              and vigencia_hasta > now() and vigencia_hasta <= now() + interval '7 days'
              and factory.cantidad_pendientes() < 50);

-- La PC solo puede mover una orden hacia adelante (nunca reabrirla ni cambiar qué acción era).
drop policy if exists "ordenes: pc resuelve" on factory.ordenes;
create policy "ordenes: pc resuelve" on factory.ordenes for update
  using (factory.tiene_rol('pc') and estado in ('pendiente','tomada'))
  with check (factory.tiene_rol('pc') and estado in ('tomada','hecha','rechazada','vencida'));
