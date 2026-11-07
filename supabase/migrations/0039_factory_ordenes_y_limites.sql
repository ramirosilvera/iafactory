-- Factory, paso 2: límites de tamaño (params, resultado, eventos, estado). Idempotente: seguro correrlo de nuevo.
-- (La acción 'auditar', el tope de 50 órdenes vigentes y las policies finales de órdenes viven en 0038, para que
-- reaplicar 0038 solo no deje un estado más débil. La cuenta de la PC se da de alta con factory.alta_pc(), ver 0038.)

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
