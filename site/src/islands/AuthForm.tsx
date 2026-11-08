import { useState } from "react";
import { SUPABASE_CONFIGURADO, supabase } from "../lib/supabase";
import { destinoSeguro } from "../lib/destino";
import ConfigWarning from "./ConfigWarning";

export default function AuthForm() {
  const [modo, setModo] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [estado, setEstado] = useState<"idle" | "cargando" | "error" | "ok" | "confirmar_email">("idle");
  const [error, setError] = useState("");

  if (!SUPABASE_CONFIGURADO) return <ConfigWarning />;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setEstado("cargando");
    setError("");
    try {
      const { data, error: err } =
        modo === "login"
          ? await supabase.auth.signInWithPassword({ email, password })
          : await supabase.auth.signUp({ email, password });
      if (err) {
        setEstado("error");
        setError(err.message);
        return;
      }
      if (modo === "signup" && !data.session) {
        // El proyecto tiene "confirmar email" activado -- la cuenta se creó
        // pero todavía no hay sesión. Avisar en vez de redirigir a un
        // tablero vacío que parece "no funcionó".
        setEstado("confirmar_email");
        return;
      }
      setEstado("ok");
      window.location.href = destinoSeguro(new URLSearchParams(window.location.search).get("volver"), (import.meta.env.BASE_URL as string) || "/");
    } catch (e) {
      setEstado("error");
      setError(e instanceof Error ? e.message : "Error de conexión con IA Factory.");
    }
  }

  if (estado === "confirmar_email") {
    return (
      <div className="card empty-state">
        <p>
          Te mandamos un email a <strong>{email}</strong> para confirmar la cuenta. Confirmalo y volvé a entrar.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="card" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button
          type="button"
          className={modo === "login" ? "btn btn-primary" : "btn btn-secondary"}
          onClick={() => setModo("login")}
        >
          Entrar
        </button>
        <button
          type="button"
          className={modo === "signup" ? "btn btn-primary" : "btn btn-secondary"}
          onClick={() => setModo("signup")}
        >
          Crear cuenta
        </button>
      </div>
      <label className="field-label">
        <span>Email</span>
        <input
          className="field"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label className="field-label">
        <span>Contraseña</span>
        <input
          className="field"
          type="password"
          autoComplete={modo === "login" ? "current-password" : "new-password"}
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      <button type="submit" className="btn btn-primary" disabled={estado === "cargando"}>
        {estado === "cargando" ? "Un momento..." : modo === "login" ? "Entrar" : "Crear cuenta"}
      </button>
    </form>
  );
}
