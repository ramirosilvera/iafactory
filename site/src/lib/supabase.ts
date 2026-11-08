import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.PUBLIC_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY as string | undefined;

export const SUPABASE_CONFIGURADO = Boolean(url && anonKey);

if (!SUPABASE_CONFIGURADO) {
  // eslint-disable-next-line no-console
  console.warn(
    "IA Factory: faltan PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY -- ver README.md.",
  );
}

// Las tablas del tablero viven en el schema `factory` (no `public`); tiene
// que estar expuesto en Project Settings -> API -> Exposed schemas (ver
// supabase/README.md), si no toda query devuelve error.
//
// createClient() con URL vacía TIRA una excepción sincrónica ("supabaseUrl
// is required") -- si eso pasa dentro de un island client:only, mata la
// hidratación de ESE componente en silencio y no se ve nada (nada de
// mensaje de error, solo la página en blanco). Por eso, si falta la config,
// se usa una URL dummy válida (nunca se llega a usar porque cada island
// chequea SUPABASE_CONFIGURADO antes de llamar a `supabase.*`) en vez de
// dejar que el constructor explote.
export const supabase = createClient(
  SUPABASE_CONFIGURADO ? (url as string) : "https://supabase-no-configurado.invalid",
  SUPABASE_CONFIGURADO ? (anonKey as string) : "no-configurado",
  { db: { schema: "factory" } },
);
