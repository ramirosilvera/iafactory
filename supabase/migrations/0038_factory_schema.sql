-- Schema `factory`: tablero remoto de la IA Factory (estado, eventos y órdenes).
--
-- Idea: Supabase es el punto de encuentro. La PC de Ramiro publica su estado hacia acá (conexión SALIENTE, no se
-- abre ningún puerto) y la app web lo muestra: en vivo cuando la PC está prendida, y la última foto cuando está apagada.
-- Las órdenes se dejan en cola y la PC las toma cuando está disponible.
--
-- SEGURIDAD: el registro de usuarios del proyecto Supabase es abierto, así que NINGUNA policy de este schema usa solo
-- "authenticated". El acceso sale de la tabla factory.acceso (email + rol) y exige además que el email del usuario esté
-- CONFIRMADO en auth.users (si no, alguien podría registrarse con el email de otro). Roles:
--   admin = la persona (web: lee todo, crea órdenes, cancela las pendientes)
--   pc    = el publicador de la PC (escribe estado/latido/eventos y resuelve órdenes)
-- Idempotente: seguro correrlo de nuevo.

create schema if not exists factory;
grant usage on schema factory to authenticated;

create table if not exists factory.acceso (
  email text primary key check (email = lower(email)),
  rol text not null check (rol in ('admin','pc')),
  user_id uuid  -- R1: la cuenta 'pc' queda atada a UN usuario concreto (alta_pc); sin user_id no tiene ningún permiso
);
alter table factory.acceso add column if not exists user_id uuid;
alter table factory.acceso enable row level security;
-- Sin grants ni policies para nadie: solo se lee a través de factory.tiene_rol() (security definer).

-- La cuenta de la PC (rol 'pc') NO se pre-carga (R1): la da de alta el admin con factory.alta_pc() cuando la cuenta
-- ya existe y tiene el email confirmado; así nadie puede "ganarle de mano" registrando ese email antes.
insert into factory.acceso (email, rol) values ('raa1990.rs@gmail.com', 'admin')
on conflict (email) do nothing;

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
      and (a.rol <> 'pc' or a.user_id = u.id)   -- R1: el rol pc exige estar atado a este usuario exacto
  );
$$;
revoke all on function factory.tiene_rol(text) from public;
grant execute on function factory.tiene_rol(text) to authenticated;

create or replace function factory.es_miembro() returns boolean
language sql stable security definer set search_path = ''
as $$ select factory.tiene_rol('admin') or factory.tiene_rol('pc'); $$;
revoke all on function factory.es_miembro() from public;
grant execute on function factory.es_miembro() to authenticated;

-- Alta de la cuenta de la PC: solo el admin, y solo para un usuario que YA existe con el email confirmado.
-- Ata el rol al id de ese usuario; no puede tocar la fila de un admin.
create or replace function factory.alta_pc(p_email text) returns void
language plpgsql security definer set search_path = ''
as $$
declare uid uuid;
begin
  if not factory.tiene_rol('admin') then
    raise exception 'solo el admin puede dar de alta la cuenta de la PC';
  end if;
  select u.id into uid from auth.users u
   where lower(u.email) = lower(p_email) and u.email_confirmed_at is not null
   order by u.created_at nulls last limit 1;
  if uid is null then
    raise exception 'no existe una cuenta con ese email confirmado';
  end if;
  if exists (select 1 from factory.acceso where email = lower(p_email) and rol <> 'pc') then
    raise exception 'ese email ya tiene otro rol';
  end if;
  insert into factory.acceso (email, rol, user_id) values (lower(p_email), 'pc', uid)
  on conflict (email) do update set user_id = excluded.user_id where factory.acceso.rol = 'pc';
end $$;
revoke all on function factory.alta_pc(text) from public;
grant execute on function factory.alta_pc(text) to authenticated;

-- Latido: la PC escribe "estoy viva" cada ~30 s. Más de ~90 s sin latido = la web pasa a modo "PC apagada".
create table if not exists factory.heartbeat (
  dispositivo text primary key default 'pc',
  visto_at timestamptz not null default now(),
  version text
);

-- Foto actual: una fila por clave ('resumen', 'cuotas', 'ejecutor', 'proyecto:<id>'...). Solo metadatos y resultados.
create table if not exists factory.estado (
  clave text primary key,
  valor jsonb not null,
  actualizado_at timestamptz not null default now()
);

-- Registro de eventos (en vivo cuando la PC está prendida; historial cuando no). Se purga a los 30 días.
create table if not exists factory.eventos (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  nivel text not null default 'info' check (nivel in ('info','aviso','error')),
  tipo text not null,
  proyecto text,
  titulo text not null,
  detalle jsonb
);
create index if not exists eventos_ts_idx on factory.eventos (ts desc);

-- Órdenes: la web las crea en 'pendiente'; la PC las toma de a una (update condicional) y las resuelve.
create table if not exists factory.ordenes (
  id uuid primary key default gen_random_uuid(),
  creada_at timestamptz not null default now(),
  creada_por text,
  accion text not null check (accion in ('pausar_ejecutor','reanudar_ejecutor','encolar','aprobar_item','descartar_item','auditar')),
  params jsonb not null default '{}'::jsonb,
  vigencia_hasta timestamptz not null,
  estado text not null default 'pendiente' check (estado in ('pendiente','tomada','hecha','rechazada','vencida','cancelada')),
  tomada_at timestamptz,
  resuelta_at timestamptz,
  resultado text
);
create index if not exists ordenes_estado_idx on factory.ordenes (estado, creada_at);

alter table factory.heartbeat enable row level security;
alter table factory.estado    enable row level security;
alter table factory.eventos   enable row level security;
alter table factory.ordenes   enable row level security;

grant select, insert, update on factory.heartbeat to authenticated;
grant select, insert, update on factory.estado    to authenticated;
grant select, insert, delete on factory.eventos   to authenticated;
grant usage on all sequences in schema factory    to authenticated;
grant select, insert, update on factory.ordenes   to authenticated;

-- Lectura: admin y pc.
drop policy if exists "heartbeat: leer" on factory.heartbeat;
create policy "heartbeat: leer" on factory.heartbeat for select using (factory.es_miembro());
drop policy if exists "estado: leer" on factory.estado;
create policy "estado: leer" on factory.estado for select using (factory.es_miembro());
drop policy if exists "eventos: leer" on factory.eventos;
create policy "eventos: leer" on factory.eventos for select using (factory.es_miembro());
drop policy if exists "ordenes: leer" on factory.ordenes;
create policy "ordenes: leer" on factory.ordenes for select using (factory.es_miembro());

-- Escritura de estado: solo la PC.
drop policy if exists "heartbeat: pc escribe" on factory.heartbeat;
create policy "heartbeat: pc escribe" on factory.heartbeat for insert with check (factory.tiene_rol('pc'));
drop policy if exists "heartbeat: pc actualiza" on factory.heartbeat;
create policy "heartbeat: pc actualiza" on factory.heartbeat for update using (factory.tiene_rol('pc')) with check (factory.tiene_rol('pc'));
drop policy if exists "estado: pc escribe" on factory.estado;
create policy "estado: pc escribe" on factory.estado for insert with check (factory.tiene_rol('pc'));
drop policy if exists "estado: pc actualiza" on factory.estado;
create policy "estado: pc actualiza" on factory.estado for update using (factory.tiene_rol('pc')) with check (factory.tiene_rol('pc'));
drop policy if exists "eventos: pc escribe" on factory.eventos;
create policy "eventos: pc escribe" on factory.eventos for insert with check (factory.tiene_rol('pc'));
drop policy if exists "eventos: pc purga" on factory.eventos;
create policy "eventos: pc purga" on factory.eventos for delete using (factory.tiene_rol('pc') and ts < now() - interval '30 days');

-- Órdenes: el admin crea (siempre 'pendiente', con vigencia futura, máx. 50 vigentes a la vez) y solo puede cancelar las
-- pendientes; la PC las toma y resuelve (nunca crea, nunca reabre). Estas son las policies BASE: 0043 las endurece
-- (el CI reaplica siempre 0038..0043 en orden y la última manda; no reaplicar 0038 sola, revertiría ese endurecimiento).
create or replace function factory.cantidad_pendientes() returns integer
language sql stable security definer set search_path = ''
-- R11: solo cuentan las vigentes (las vencidas que quedaron pendientes por PC apagada no trancan la cola)
as $$ select count(*)::int from factory.ordenes where estado = 'pendiente' and vigencia_hasta > now(); $$;
revoke all on function factory.cantidad_pendientes() from public;
grant execute on function factory.cantidad_pendientes() to authenticated;

drop policy if exists "ordenes: admin crea" on factory.ordenes;
create policy "ordenes: admin crea" on factory.ordenes for insert
  with check (factory.tiene_rol('admin') and estado = 'pendiente'
              and vigencia_hasta > now() and vigencia_hasta <= now() + interval '7 days'
              and factory.cantidad_pendientes() < 50);
drop policy if exists "ordenes: admin cancela" on factory.ordenes;
create policy "ordenes: admin cancela" on factory.ordenes for update
  using (factory.tiene_rol('admin') and estado = 'pendiente')
  with check (factory.tiene_rol('admin') and estado = 'cancelada');
drop policy if exists "ordenes: pc resuelve" on factory.ordenes;
create policy "ordenes: pc resuelve" on factory.ordenes for update
  using (factory.tiene_rol('pc') and estado in ('pendiente','tomada'))
  with check (factory.tiene_rol('pc') and estado in ('tomada','hecha','rechazada','vencida'));

-- R9: al crear una orden, el servidor fija quién la creó y deja en blanco todo lo de resolución (nadie puede
-- inventar autoría ni crearla "ya tomada").
create or replace function factory.orden_al_crear() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.creada_por := (select lower(u.email) from auth.users u where u.id = (select auth.uid()));
  new.creada_at := now();
  new.tomada_at := null;
  new.resuelta_at := null;
  new.resultado := null;
  return new;
end $$;
drop trigger if exists orden_al_crear on factory.ordenes;
create trigger orden_al_crear before insert on factory.ordenes for each row execute function factory.orden_al_crear();

-- R8: una orden no cambia de acción, parámetros, autor ni vigencia después de creada (ni siquiera la PC al tomarla).
create or replace function factory.orden_inmutable() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.id is distinct from old.id or new.accion is distinct from old.accion or new.params is distinct from old.params
     or new.creada_at is distinct from old.creada_at or new.creada_por is distinct from old.creada_por
     or new.vigencia_hasta is distinct from old.vigencia_hasta then
    raise exception 'una orden no puede modificarse, solo cambia de estado';
  end if;
  return new;
end $$;
drop trigger if exists orden_inmutable on factory.ordenes;
create trigger orden_inmutable before update on factory.ordenes for each row execute function factory.orden_inmutable();

-- Realtime: la web y la PC reciben cambios al instante.
do $$
declare t text;
begin
  foreach t in array array['heartbeat','estado','eventos','ordenes'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'factory' and tablename = t) then
      execute format('alter publication supabase_realtime add table factory.%I', t);
    end if;
  end loop;
end $$;

-- Exponer el schema en la API. Como 0007 y 0008 también fijan este valor y las migraciones se reaplican en orden,
-- esta (la última) manda: si se agrega otro schema a la API, sumarlo ACÁ.
alter role authenticator set pgrst.db_schemas = 'public, armario, factory';
notify pgrst, 'reload config';
