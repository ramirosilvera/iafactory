# IA Factory — tablero remoto

Tablero web (solo para el dueño) para ver el estado de la IA Factory desde el
celular y mandarle órdenes seguras a la PC.

- **Sitio:** https://ramirosilvera.github.io/iafactory/ (Astro estático + islas React, PWA instalable, sin indexar).
- **Backend:** proyecto Supabase `iafactory`, schema `factory` (latido, estado, eventos, órdenes, lista de acceso).
- **Publicador:** programa Node (sin dependencias) que corre en la PC, en `~/.dsh/factory/remote/`. Solo hace conexiones salientes HTTPS hacia Supabase: no abre puertos.

## Cómo funciona

```
PC (publicador) ──heartbeat/estado/eventos──▶ Supabase ◀── tablero web (login)
PC (publicador) ◀───────── órdenes ────────── Supabase ◀── tablero web (admin)
```

Seguridad: RLS por lista de emails **confirmados** (`factory.acceso`: `admin` = el dueño, `pc` = la cuenta del publicador). El registro de usuarios está cerrado y *Confirm email* activo. Las órdenes tienen una lista cerrada de acciones (pausar/reanudar ejecutor, encolar, auditar, aprobar/descartar ítem), vencen a los 7 días y son inmutables una vez creadas. Detalle y pruebas en [`supabase/README.md`](supabase/README.md).

## Estructura

| Carpeta | Contenido |
|---|---|
| `site/` | Web: `src/pages` (`/` tablero, `/login/`), `src/islands` (React), `src/lib` (lógica + tests), `public/` (manifest, íconos, service worker) |
| `supabase/migrations/` | Migraciones del schema `factory` (0038 en adelante) |
| `supabase/tests/` | `factory_rls.sql`: prueba de las barreras de seguridad |
| `.github/workflows/` | `deploy.yml` (GitHub Pages), `apply-supabase-migrations.yml` (aplica migraciones) |

## Desarrollo

```bash
cd site
npm ci
npm test                      # vitest
npx tsc --noEmit -p .         # tipos
PUBLIC_SUPABASE_URL=... PUBLIC_SUPABASE_ANON_KEY=... npm run build
```

## Configuración en GitHub (una sola vez)

1. **Settings → Pages → Source: GitHub Actions.**
2. **Settings → Secrets and variables → Actions → pestaña *Variables*** (no Secrets): `PUBLIC_SUPABASE_URL` y `PUBLIC_SUPABASE_ANON_KEY`. El deploy corta con un error explícito si faltan.
3. **Pestaña *Secrets***: `SUPABASE_DB_URL` (Session pooler URI, IPv4) para que el CI aplique las migraciones.

## Poner en marcha el publicador en la PC

En la carpeta `~/.dsh/factory/remote/`: `setup.cmd` (configura una vez), `lanzar.vbs` (arranca en segundo plano), `detener.cmd`, `autoarranque.cmd` (inicio con Windows), `ordenes-off.cmd` / `ordenes-on.cmd` (kill-switch de órdenes), `proteger-auth.cmd` (verifica *Confirm email* y registro cerrado).
