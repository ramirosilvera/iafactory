-- Prueba de seguridad del schema `factory` (RLS). Se corre contra un Postgres con las migraciones 0038 y 0039 aplicadas (y 0038 se puede reaplicar sola)
-- (y los objetos mínimos de Supabase: schema auth, roles anon/authenticated). Todo ocurre dentro de una transacción
-- que se deshace al final: no deja datos. Falla (ON_ERROR_STOP) si alguna barrera no se cumple.
--   psql "$URL" -v ON_ERROR_STOP=1 -f supabase/tests/factory_rls.sql
begin;

create or replace function pg_temp.como(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
  execute 'set local role authenticated';
end $$;

create or replace function pg_temp.vuelvo() returns void language plpgsql as $$
begin execute 'reset role'; end $$;

-- debe fallar (RLS, check o permiso); si NO falla, la prueba aborta
create or replace function pg_temp.debe_fallar(q text, que text) returns void language plpgsql as $$
begin
  begin
    execute q;
  exception when others then
    return;
  end;
  raise exception 'FALLÓ LA BARRERA: %', que;
end $$;

create or replace function pg_temp.filas(q text) returns int language plpgsql as $$
declare n int;
begin execute 'select count(*) from (' || q || ') t' into n; return n; end $$;

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'raa1990.rs@gmail.com', now()),                -- admin confirmado
  ('00000000-0000-0000-0000-0000000000b1', 'raa1990.rs+factory-pc@gmail.com', now()),     -- pc confirmada
  ('00000000-0000-0000-0000-0000000000c1', 'intruso@example.com', now()),                 -- logueado pero sin acceso
  ('00000000-0000-0000-0000-0000000000d1', 'raa1990.rs@gmail.com', null),                 -- mismo email SIN confirmar
  ('00000000-0000-0000-0000-0000000000e1', 'raa1990.rs+factory-pc@gmail.com', null);

-- La cuenta pc la da de alta el admin (alta_pc); antes de eso, ni la confirmada tiene permisos (R1)
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
do $$ begin
  perform pg_temp.debe_fallar($q$insert into factory.heartbeat (dispositivo) values ('antes')$q$, 'pc sin alta escribe');
  perform pg_temp.debe_fallar($q$select factory.alta_pc('raa1990.rs+factory-pc@gmail.com')$q$, 'pc se da de alta sola');
end $$;
select pg_temp.vuelvo();
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
do $$ begin
  perform pg_temp.debe_fallar($q$select factory.alta_pc('intruso@example.com')$q$, 'intruso se da de alta como pc');
end $$;
select pg_temp.vuelvo();
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
do $$ begin
  perform pg_temp.debe_fallar($q$select factory.alta_pc('nadie@example.com')$q$, 'alta_pc de un email que no existe');
  perform pg_temp.debe_fallar($q$select factory.alta_pc('raa1990.rs@gmail.com')$q$, 'alta_pc pisa al admin');
  perform factory.alta_pc('raa1990.rs+factory-pc@gmail.com');
end $$;
select pg_temp.vuelvo();
do $$ begin
  if (select user_id from factory.acceso where email = 'raa1990.rs@gmail.com' and rol='admin') is not null then raise exception 'alta_pc tocó al admin'; end if;
end $$;

-- datos de partida (como dueño de la base)
insert into factory.heartbeat (dispositivo, visto_at) values ('pc', now());
insert into factory.estado (clave, valor) values ('resumen', '{"proyectos":[]}');
insert into factory.eventos (tipo, titulo) values ('t', 'x');

-- 1) Sin acceso: ni leen ni escriben
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
do $$ begin
  if pg_temp.filas('select * from factory.heartbeat') <> 0 then raise exception 'intruso lee heartbeat'; end if;
  if pg_temp.filas('select * from factory.estado') <> 0 then raise exception 'intruso lee estado'; end if;
  if pg_temp.filas('select * from factory.eventos') <> 0 then raise exception 'intruso lee eventos'; end if;
  perform pg_temp.debe_fallar($q$insert into factory.ordenes (accion, vigencia_hasta) values ('pausar_ejecutor', now() + interval '10 min')$q$, 'intruso crea orden');
  perform pg_temp.debe_fallar($q$insert into factory.heartbeat (dispositivo) values ('x')$q$, 'intruso escribe latido');
  perform pg_temp.debe_fallar($q$select * from factory.acceso$q$, 'intruso lee la lista de acceso');
end $$;
select pg_temp.vuelvo();

-- 2) Mismo email sin confirmar: sin acceso (nadie puede "ser" el admin registrándose con su email)
select pg_temp.como('00000000-0000-0000-0000-0000000000d1');
do $$ begin
  if pg_temp.filas('select * from factory.estado') <> 0 then raise exception 'email sin confirmar lee estado'; end if;
  perform pg_temp.debe_fallar($q$insert into factory.ordenes (accion, vigencia_hasta) values ('pausar_ejecutor', now() + interval '10 min')$q$, 'admin sin confirmar crea orden');
end $$;
select pg_temp.vuelvo();
select pg_temp.como('00000000-0000-0000-0000-0000000000e1');
do $$ begin
  perform pg_temp.debe_fallar($q$insert into factory.heartbeat (dispositivo) values ('pc2')$q$, 'pc sin confirmar (otro usuario, mismo email) escribe');
end $$;
select pg_temp.vuelvo();

-- 3) Admin: lee, crea órdenes válidas, cancela pendientes; no escribe estado
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
do $$ begin
  if pg_temp.filas('select * from factory.estado') <> 1 then raise exception 'admin no lee estado'; end if;
  insert into factory.ordenes (id, accion, params, vigencia_hasta, creada_por)
    values ('11111111-1111-1111-1111-111111111111', 'pausar_ejecutor', '{"id":"ia-factory"}', now() + interval '15 min', 'a');
  perform pg_temp.debe_fallar($q$insert into factory.ordenes (accion, vigencia_hasta, estado) values ('pausar_ejecutor', now() + interval '1 min', 'hecha')$q$, 'admin crea orden ya hecha');
  perform pg_temp.debe_fallar($q$insert into factory.ordenes (accion, vigencia_hasta) values ('pausar_ejecutor', now() - interval '1 min')$q$, 'orden con vigencia pasada');
  perform pg_temp.debe_fallar($q$insert into factory.ordenes (accion, vigencia_hasta) values ('pausar_ejecutor', now() + interval '30 days')$q$, 'vigencia de 30 días');
  perform pg_temp.debe_fallar($q$insert into factory.ordenes (accion, vigencia_hasta) values ('borrar_todo', now() + interval '5 min')$q$, 'acción fuera de la lista');
  perform pg_temp.debe_fallar($q$insert into factory.ordenes (accion, params, vigencia_hasta) values ('encolar', '[1,2]', now() + interval '5 min')$q$, 'params que no es objeto');
  perform pg_temp.debe_fallar($q$insert into factory.ordenes (accion, params, vigencia_hasta) values ('encolar', jsonb_build_object('x', repeat('a', 5000)), now() + interval '5 min')$q$, 'params enorme');
  perform pg_temp.debe_fallar($q$insert into factory.heartbeat (dispositivo) values ('x')$q$, 'admin escribe latido');
  perform pg_temp.debe_fallar($q$insert into factory.estado (clave, valor) values ('k', '{}')$q$, 'admin escribe estado');
  perform pg_temp.debe_fallar($q$insert into factory.eventos (tipo, titulo) values ('t', 'x')$q$, 'admin escribe eventos');
  perform pg_temp.debe_fallar($q$update factory.ordenes set estado = 'hecha' where id = '11111111-1111-1111-1111-111111111111'$q$, 'admin marca hecha una orden');
  -- R9: el servidor fija el autor y limpia lo de resolución
  if (select creada_por from factory.ordenes where id = '11111111-1111-1111-1111-111111111111') <> 'raa1990.rs@gmail.com' then raise exception 'creada_por falsificable'; end if;
  insert into factory.ordenes (id, accion, vigencia_hasta, creada_por, resultado, tomada_at)
    values ('22222222-2222-2222-2222-222222222222', 'auditar', now() + interval '1 hour', 'otro@x.com', 'hecho', now());
  if (select creada_por || coalesce(resultado,'') || coalesce(tomada_at::text,'') from factory.ordenes where id = '22222222-2222-2222-2222-222222222222') <> 'raa1990.rs@gmail.com' then raise exception 'se pudo sembrar autoría/resultado'; end if;
  update factory.ordenes set estado = 'cancelada' where id = '22222222-2222-2222-2222-222222222222';
end $$;
select pg_temp.vuelvo();

-- 4) PC: publica, toma de a una, resuelve; no crea órdenes ni reabre
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
do $$
declare n int;
begin
  insert into factory.heartbeat (dispositivo, visto_at) values ('pc', now())
    on conflict (dispositivo) do update set visto_at = excluded.visto_at;
  insert into factory.estado (clave, valor) values ('cuotas', '{"rutas":[]}')
    on conflict (clave) do update set valor = excluded.valor, actualizado_at = now();
  insert into factory.eventos (tipo, titulo) values ('done', 'ok');
  perform pg_temp.debe_fallar($q$insert into factory.ordenes (accion, vigencia_hasta) values ('pausar_ejecutor', now() + interval '10 min')$q$, 'pc crea órdenes');
  -- toma atómica: la primera gana, la segunda no encuentra pendiente
  update factory.ordenes set estado = 'tomada', tomada_at = now() where id = '11111111-1111-1111-1111-111111111111' and estado = 'pendiente';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'la PC no pudo tomar la orden'; end if;
  update factory.ordenes set estado = 'tomada' where id = '11111111-1111-1111-1111-111111111111' and estado = 'pendiente';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'se tomó dos veces la misma orden'; end if;
  -- R8: no puede cambiar qué acción era ni sus parámetros ni la vigencia
  perform pg_temp.debe_fallar($q$update factory.ordenes set accion = 'encolar' where id = '11111111-1111-1111-1111-111111111111'$q$, 'pc cambia la acción');
  perform pg_temp.debe_fallar($q$update factory.ordenes set vigencia_hasta = now() + interval '6 days' where id = '11111111-1111-1111-1111-111111111111'$q$, 'pc cambia la vigencia');
  update factory.ordenes set estado = 'hecha', resuelta_at = now(), resultado = 'ok' where id = '11111111-1111-1111-1111-111111111111';
  -- ya resuelta: no se puede reabrir ni tocar
  update factory.ordenes set estado = 'pendiente' where id = '11111111-1111-1111-1111-111111111111';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'la PC reabrió una orden hecha'; end if;
end $$;
select pg_temp.vuelvo();

-- 5) Tope de 50 pendientes VIGENTES (R11: las vencidas no cuentan)
do $$
begin
  perform pg_temp.como('00000000-0000-0000-0000-0000000000a1');
  for i in 1..60 loop
    begin
      insert into factory.ordenes (accion, vigencia_hasta) values ('auditar', now() + interval '1 hour');
    exception when others then exit;
    end;
  end loop;
  perform pg_temp.vuelvo();
  if (select count(*) from factory.ordenes where estado = 'pendiente') > 50 then raise exception 'se pasó del tope de pendientes'; end if;
  if (select count(*) from factory.ordenes where estado = 'pendiente') < 50 then raise exception 'el tope cortó antes de tiempo'; end if;
end $$;
-- R11: con 50 pendientes que ya vencieron, se vuelve a poder crear
do $$
begin
  alter table factory.ordenes disable trigger orden_inmutable;
  update factory.ordenes set vigencia_hasta = now() - interval '1 minute' where estado = 'pendiente';
  alter table factory.ordenes enable trigger orden_inmutable;
  perform pg_temp.como('00000000-0000-0000-0000-0000000000a1');
  insert into factory.ordenes (accion, vigencia_hasta) values ('auditar', now() + interval '1 hour');
  perform pg_temp.vuelvo();
end $$;

rollback;
\echo OK: todas las barreras de factory se cumplen
