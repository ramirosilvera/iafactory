-- (Sin efecto) Esta migración sembraba un admin con otro email y borraba al real. Quedó superada por 0041 y, como el CI
-- reaplica las migraciones en orden, ejecutarla dejaba al dueño sin rol admin durante unos segundos (y para siempre si
-- 0041 fallaba). Ahora no hace nada; el admin lo fija 0038/0041.
select 1;
