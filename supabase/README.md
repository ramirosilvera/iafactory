# Supabase — schema como código

El proyecto Supabase `iafactory` aloja el schema `factory`: la base del
tablero remoto de la IA Factory. Este directorio versiona su esquema.

> Historial: el proyecto alojó antes otra app (schema `armario`) que ya no
> existe; sus migraciones 0001–0037 se eliminaron del repo. El schema
> `armario` puede seguir en la base hasta que se borre con una migración
> explícita (ver "Pendiente").

## Migraciones (`migrations/`, en orden)

- **`0038_factory_schema.sql`** / **`0039_factory_ordenes_y_limites.sql`** —
  schema `factory`: tablero remoto de la IA Factory (latido, foto de estado,
  eventos y órdenes). Acceso por lista de emails **confirmados**
  (`factory.acceso`, roles `admin` = la persona, `pc` = el publicador de la
  PC), porque el registro de usuarios del proyecto es abierto. Quien no está en la lista no
  lee ni escribe nada. `0038` es la última que fija `pgrst.db_schemas`:
  cualquier schema nuevo se suma ahí. `0038` trae el estado FINAL de las
  policies de órdenes (reaplicarla sola no debilita nada); `0039` solo agrega
  límites de tamaño. La cuenta `pc` NO se pre-carga: el admin la da de alta con
  `factory.alta_pc(email)` (la ata al id del usuario; exige email confirmado).
  **Requisito:** en Supabase Auth debe estar activo *Confirm email*; el
  publicador y `setup.cmd` lo verifican y, si no, no habilitan órdenes.
  Prueba de las reglas de seguridad (contra un Postgres con las migraciones
  aplicadas y los objetos mínimos de Supabase; todo en una transacción que se
  deshace): `psql "$URL" -v ON_ERROR_STOP=1 -f supabase/tests/factory_rls.sql`.
  Publicador que corre en la PC: carpeta `remote/` de la fábrica
  (`~/.dsh/factory/remote/`), con `setup.cmd` para configurarlo una sola vez.

## GitHub: variable vs. secret (fuente de un bug real que ya pasó acá)

`site/.github/workflows/deploy.yml` lee `PUBLIC_SUPABASE_URL` y
`PUBLIC_SUPABASE_ANON_KEY` con `${{ vars.X }}`, que **solo** lee la pestaña
**Variables** de Settings → Secrets and variables → Actions -- es una pestaña
distinta de **Secrets**, aunque viven en la misma página y es fácil
confundirlas. Si se cargan como Secret, `vars.X` queda vacío, el build
compila "bien" (sin error) pero el sitio queda sin poder hablar con
Supabase -- exactamente lo que pasó la primera vez. El workflow ahora corta
con un `::error::` explícito ANTES de compilar si esto vuelve a pasar, en vez
de fallar en silencio.

## Cómo se aplican

Automático por CI: `.github/workflows/apply-supabase-migrations.yml` corre en
cada push que toca `supabase/migrations/**` y aplica las `>= 0038` con
`psql "$SUPABASE_DB_URL"` (secret con la Session pooler URI, IPv4: los runners
de GitHub no tienen IPv6). Sin el secret se saltea con un aviso.

Manual (si hiciera falta):

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0038_factory_schema.sql
```

## Auth

*Confirm email* activo y registro de usuarios cerrado (lo aplica y verifica
`proteger-auth.cmd` en la PC). Las Redirect URLs de Auth deben incluir
`https://ramirosilvera.github.io/iafactory/`.

## Pendiente

- Borrar el schema `armario` (y el bucket `armario-fotos`) de la base real y
  dejar `pgrst.db_schemas = 'public, factory'`: irreversible, requiere
  confirmación explícita del dueño.
