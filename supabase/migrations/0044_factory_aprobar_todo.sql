-- Factory: acción «aprobar_todo» («Autorizar todo» desde el celular). Idempotente.
-- La PC la ejecuta con la misma cola de siempre (cada tarea pasa por el tope diario y el buzón); una orden por proyecto.
alter table factory.ordenes drop constraint if exists ordenes_accion_check;
alter table factory.ordenes add constraint ordenes_accion_check
  check (accion in ('pausar_ejecutor','reanudar_ejecutor','encolar','aprobar_item','aprobar_todo','descartar_item','auditar'));
