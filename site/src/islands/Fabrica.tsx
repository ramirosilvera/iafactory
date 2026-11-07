import { useCallback, useEffect, useState } from "react";
import {
  ESTADO_ORDEN_LABEL,
  antiguedadTexto,
  estadoVisible,
  leerCuotas,
  leerEjecutor,
  leerResumen,
  modoConexion,
  porcentajeCuota,
  type Latido,
  type Orden,
} from "../lib/fabrica";
import { SUPABASE_CONFIGURADO, supabase } from "../lib/supabase";
import ConfigWarning from "./ConfigWarning";

interface Evento {
  id: number;
  ts: string;
  nivel: "info" | "aviso" | "error";
  tipo: string;
  proyecto: string | null;
  titulo: string;
}
interface FilaEstado {
  clave: string;
  valor: unknown;
  actualizado_at: string;
}

const fab = () => supabase.schema("factory");

export default function Fabrica() {
  const [sesion, setSesion] = useState<"cargando" | "no" | "si">("cargando");
  const [latido, setLatido] = useState<Latido | null>(null);
  const [estado, setEstado] = useState<Record<string, FilaEstado>>({});
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [ordenes, setOrdenes] = useState<Orden[]>([]);
  const [error, setError] = useState("");
  const [ahora, setAhora] = useState(() => Date.now());

  const cargar = useCallback(async () => {
    const [h, e, ev, o] = await Promise.all([
      fab().from("heartbeat").select("*").eq("dispositivo", "pc").maybeSingle(),
      fab().from("estado").select("*"),
      fab().from("eventos").select("id,ts,nivel,tipo,proyecto,titulo").order("ts", { ascending: false }).limit(30),
      fab().from("ordenes").select("*").order("creada_at", { ascending: false }).limit(15),
    ]);
    const fallo = h.error || e.error || ev.error || o.error;
    if (fallo) {
      setError(fallo.message);
      return;
    }
    setError("");
    setLatido((h.data as Latido | null) ?? null);
    setEstado(Object.fromEntries(((e.data as FilaEstado[]) ?? []).map((f) => [f.clave, f])));
    setEventos((ev.data as Evento[]) ?? []);
    setOrdenes((o.data as Orden[]) ?? []);
  }, []);

  useEffect(() => {
    if (!SUPABASE_CONFIGURADO) return;
    let cerrado = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cerrado) return;
      setSesion(data.session ? "si" : "no");
      if (data.session) void cargar();
    });
    return () => {
      cerrado = true;
    };
  }, [cargar]);

  // tiempo real: cualquier cambio en las 4 tablas recarga; el reloj interno recalcula "en vivo / apagada" cada 15 s
  useEffect(() => {
    if (sesion !== "si") return;
    const canal = supabase
      .channel("factory-tablero")
      .on("postgres_changes", { event: "*", schema: "factory" }, () => void cargar())
      .subscribe();
    const tick = setInterval(() => setAhora(Date.now()), 15_000);
    const visible = () => {
      if (document.visibilityState === "visible") {
        setAhora(Date.now());
        void cargar();
      }
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(tick);
      document.removeEventListener("visibilitychange", visible);
      void supabase.removeChannel(canal);
    };
  }, [sesion, cargar]);

  if (!SUPABASE_CONFIGURADO) return <ConfigWarning />;
  if (sesion === "cargando") return <p>Cargando…</p>;
  if (sesion === "no") {
    return (
      <div className="card empty-state">
        <p>Necesitás entrar para ver el tablero.</p>
        <a className="btn btn-primary" href={`${import.meta.env.BASE_URL}login/`}>
          Entrar
        </a>
      </div>
    );
  }

  const modo = modoConexion(latido, ahora);
  const proyectos = leerResumen(estado["resumen"]?.valor);
  const cuotas = leerCuotas(estado["cuotas"]?.valor);
  const ejecutor = leerEjecutor(estado["ejecutor"]?.valor);
  const fotoDe = estado["resumen"]?.actualizado_at ?? latido?.visto_at ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {error && (
        <div className="card" role="alert">
          <strong>No pude leer el tablero.</strong> {error}
          <p style={{ margin: "0.5rem 0 0" }}>Si es la primera vez: falta aplicar la migración 0038 y cargar tu email en factory.acceso.</p>
        </div>
      )}

      <div className="card" role="status">
        {modo === "vivo" && (
          <p style={{ margin: 0 }}>
            <strong>● En vivo.</strong> La PC está conectada (último latido {antiguedadTexto(latido?.visto_at, ahora)}).
          </p>
        )}
        {modo === "apagada" && (
          <p style={{ margin: 0 }}>
            <strong>○ PC sin conexión.</strong> Lo que ves es la última foto ({antiguedadTexto(fotoDe, ahora)}). Las órdenes quedan en cola
            hasta que la PC vuelva.
          </p>
        )}
        {modo === "sin_datos" && (
          <p style={{ margin: 0 }}>
            <strong>Sin datos todavía.</strong> La PC aún no publicó nada.
          </p>
        )}
      </div>

      <section className="card">
        <h2>Proyectos</h2>
        {proyectos.length === 0 ? (
          <p>Sin información.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
            {proyectos.map((p) => (
              <li key={p.id}>
                <strong>{p.nombre}</strong> — nota {p.nota ?? "s/d"}, {p.pendientes} pendiente{p.pendientes === 1 ? "" : "s"}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Ejecutor</h2>
        <p style={{ margin: 0 }}>
          {ejecutor.activo ? "Activo" : "Inactivo"}
          {ejecutor.pausadoProyectos.length ? ` · pausado en: ${ejecutor.pausadoProyectos.join(", ")}` : ""}
        </p>
        {ejecutor.ultima && (
          <p style={{ margin: "0.25rem 0 0" }}>
            Última corrida: {ejecutor.ultima.proyecto} → {ejecutor.ultima.resultado} ({antiguedadTexto(ejecutor.ultima.cuando, ahora)})
          </p>
        )}
      </section>

      <section className="card">
        <h2>Cuotas de modelos</h2>
        {cuotas.length === 0 ? (
          <p>Sin información.</p>
        ) : (
          cuotas.map((c) => {
            const pct = porcentajeCuota(c);
            return (
              <div className="barra-fila" key={c.ruta}>
                <span className="barra-label">{c.ruta}</span>
                <div className="barra-pista">
                  <div className="barra-relleno" style={{ width: `${pct ?? 0}%` }} />
                </div>
                <span className="barra-valor">{pct === null ? "s/d" : `${pct}%`}</span>
              </div>
            );
          })
        )}
      </section>

      <section className="card">
        <h2>Órdenes</h2>
        {ordenes.length === 0 ? (
          <p>No hay órdenes.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
            {ordenes.map((o) => (
              <li key={o.id}>
                {o.accion} — {ESTADO_ORDEN_LABEL[estadoVisible(o, ahora)]}
                {o.resultado ? ` (${o.resultado})` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Eventos recientes</h2>
        {eventos.length === 0 ? (
          <p>Sin eventos.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
            {eventos.map((e) => (
              <li key={e.id}>
                {e.nivel === "error" ? "⛔ " : e.nivel === "aviso" ? "⚠️ " : ""}
                {e.proyecto ? `[${e.proyecto}] ` : ""}
                {e.titulo} <small>({antiguedadTexto(e.ts, ahora)})</small>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
