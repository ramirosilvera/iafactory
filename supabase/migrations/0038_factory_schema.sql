-- Schema `factory`: tablero remoto de la IA Factory (estado, eventos y órdenes).
--
-- Idea: Supabase es el punto de encuentro. La PC de Ramiro publica su estado hacia acá (conexión SALIENTE, no se
-- abre ningún puerto) y la app web lo muestra: en vivo cuando la PC está prendida, y la última foto cuando está apagada.
-- Las órdenes se dejan en cola y la PC las toma cuando está disponible.
--
-- SEGURIDAD: el registro de usuarios de Mi ropa es abierto, así que NINGUNA policy de este schema usa solo
-- "authenticated". El acceso sale de la tabla factory.acceso (email + rol) y exige además que el email del usuario esté
-- CONFIRMADO en auth.users (si no, alguien podría registrarse con el email de otro). Roles:
--   admin = la persona (web: lee todo, crea órdenes, cancela las pendientes)
--   pc    = el publicador de la PC (escribe estado/latido/eventos y resuelve órdenes)
-- Idempotente: seguro correrlo de nuevo.

create schema if not exists factory;
grant usage on schema factory to authenticated;

create table if not exists factory.acceso (
  email text primary key check (email = lower(email)),
  rol text not null check (rol in ('admin','pc'))
);
alter table factory.acceso enable row level security;
-- Sin grants ni policies para nadie: solo se lee a través de factory.tiene_rol() (security definer).

-- La cuenta de la PC (rol 'pc') se agrega aparte, a mano, con su email real (no va en el repo).
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
  );
$$;
revoke all on function factory.tiene_rol(text) from public;
grant execute on function factory.tiene_rol(text) to authenticated;

create or replace function factory.es_miembro() returns boolean
language sql stable security definer set search_path = ''
as $$ select factory.tiene_rol('admin') or factory.tiene_rol('pc'); $$;
revoke all on function factory.es_miembro() from public;
grant execute on function factory.es_miembro() to authenticated;

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
  accion text not null check (accion in ('pausar_ejecutor','reanudar_ejecutor','encolar','aprobar_item','descartar_item')),
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

-- Órdenes: el admin crea (siempre 'pendiente', con vigencia futura) y solo puede cancelar las pendientes;
-- la PC las toma y resuelve (nunca crea).
drop policy if exists "ordenes: admin crea" on factory.ordenes;
create policy "ordenes: admin crea" on factory.ordenes for insert
  with check (factory.tiene_rol('admin') and estado = 'pendiente' and vigencia_hasta > now()
              and vigencia_hasta <= now() + interval '7 days');
drop policy if exists "ordenes: admin cancela" on factory.ordenes;
create policy "ordenes: admin cancela" on factory.ordenes for update
  using (factory.tiene_rol('admin') and estado = 'pendiente')
  with check (factory.tiene_rol('admin') and estado = 'cancelada');
drop policy if exists "ordenes: pc resuelve" on factory.ordenes;
create policy "ordenes: pc resuelve" on factory.ordenes for update
  using (factory.tiene_rol('pc')) with check (factory.tiene_rol('pc'));

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
