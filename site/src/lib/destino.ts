/** Adónde volver después de entrar: solo rutas internas simples (letras, números, "/", "-", "_"), nunca una URL externa. */
export function destinoSeguro(volver: string | null | undefined, base: string): string {
  const v = String(volver ?? "");
  if (!/^[a-z0-9][a-z0-9/_-]{0,60}$/i.test(v) || v.includes("//")) return base;
  return base + v;
}
