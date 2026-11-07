import { useCallback, useEffect, useState } from "react";
import {
  ACCION_LABEL,
  ESTADO_ORDEN_LABEL,
  antiguedadTexto,
  estadoVisible,
  leerCola,
  leerCuotas,
  leerEjecutor,
  leerPc,
  leerResumen,
  modoConexion,
  nuevaOrden,
  textoConfirmacion,
  type AccionOrden,
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

interface PorConfirmar {
  accion: AccionOrden;
  id: string;
  nombre: string;
  sensibilidad: string | null;
  itemId?: string;
}

export default function Fabrica() {
  const [sesion, setSesion] = useState<"cargando" | "no" | "si">("cargando");
  const [latido, setLatido] = useState<Latido | null>(null);
  const [estado, setEstado] = useState<Record<string, FilaEstado>>({});
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [ordenes, setOrdenes] = useState<Orden[]>([]);
  const [error, setError] = useState("");
  const [ahora, setAhora] = useState(() => Date.now());
  const [email, setEmail] = useState<string | null>(null);
  const [porConfirmar, setPorConfirmar] = useState<PorConfirmar | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState("");

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
      setEmail(data.session?.user.email ?? null);
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

  async function confirmar() {
    if (!porConfirmar) return;
    const r = nuevaOrden(
      porConfirmar.accion,
      { id: porConfirmar.id, itemId: porConfirmar.itemId, confirmado: porConfirmar.accion === "reanudar_ejecutor" ? true : undefined },
      Date.now(),
      email,
    );
    if (!r.ok) {
      setAviso(r.error);
      setPorConfirmar(null);
      return;
    }
    setEnviando(true);
    const { error: e } = await fab().from("ordenes").insert(r.orden);
    setEnviando(false);
    setPorConfirmar(null);
    setAviso(e ? `No se pudo crear la orden: ${e.message}` : "Orden creada.");
    if (!e) void cargar();
  }

  async function cancelarOrden(id: string) {
    const { error: e } = await fab().from("ordenes").update({ estado: "cancelada" }).eq("id", id).eq("estado", "pendiente");
    setAviso(e ? `No se pudo cancelar: ${e.message}` : "Orden cancelada.");
    if (!e) void cargar();
  }

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
  const pc = leerPc(estado["pc"]?.valor);
  const pedir = (p: PorConfirmar) => {
    setAviso("");
    setPorConfirmar(p);
  };

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
          <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
            {cuotas.map((c) => {
              const enfriando = c.hasta && Date.parse(c.hasta) > ahora;
              return (
                <li key={c.ruta}>
                  <strong>{c.ruta}</strong>
                  {c.usado !== null ? ` — ${c.usado} uso${c.usado === 1 ? "" : "s"} hoy` : ""}
                  {enfriando ? ` — sin cupo hasta ${new Date(c.hasta as string).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}` : ""}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Acciones</h2>
        {!pc.ordenes && <p>Las órdenes remotas están desactivadas en la PC.</p>}
        {modo !== "vivo" && (
          <p style={{ marginTop: 0 }}>
            <small>La PC no está conectada: lo que pidas queda en cola y se ejecuta cuando vuelva. Si no vuelve a tiempo, la orden vence sola.</small>
          </p>
        )}
        {modo === "vivo" && !pc.tablero && (
          <p style={{ marginTop: 0 }}>
            <small>El tablero de la PC está cerrado: las órdenes esperan hasta que lo abras.</small>
          </p>
        )}
        {proyectos.length === 0 && <p>Todavía no hay proyectos publicados.</p>}
        {proyectos.map((p) => {
          const ej = ejecutor.proyectos.find((x) => x.id === p.id);
          const cola = leerCola(estado[`cola:${p.id}`]?.valor);
          const base = { id: p.id, nombre: p.nombre, sensibilidad: p.sensibilidad };
          return (
            <div key={p.id} style={{ borderTop: "1px solid var(--line, #0001)", paddingTop: "0.6rem", marginTop: "0.6rem" }}>
              <strong>{p.nombre}</strong>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", margin: "0.4rem 0" }}>
                {ej?.habilitado && !ej.pausado ? (
                  <button type="button" className="btn btn-secondary" onClick={() => pedir({ ...base, accion: "pausar_ejecutor" })}>
                    Pausar ejecutor
                  </button>
                ) : (
                  <button type="button" className="btn btn-secondary" onClick={() => pedir({ ...base, accion: "reanudar_ejecutor" })}>
                    Reanudar ejecutor
                  </button>
                )}
                <button type="button" className="btn btn-secondary" onClick={() => pedir({ ...base, accion: "auditar" })}>
                  Auditar ahora
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => pedir({ ...base, accion: "encolar" })}>
                  Armar plan
                </button>
              </div>
              {ej && (
                <small>
                  Ejecutor {ej.habilitado ? "habilitado" : "apagado"}
                  {ej.pausado ? ` · pausado: ${ej.pausado}` : ""} · {ej.hechasHoy} hecha{ej.hechasHoy === 1 ? "" : "s"} hoy
                  {ej.necesitaPersona ? ` · ${ej.necesitaPersona} necesitan a una persona` : ""}
                </small>
              )}
              {cola.length > 0 && (
                <ul style={{ margin: "0.4rem 0 0", paddingLeft: "1.1rem" }}>
                  {cola.map((t) => (
                    <li key={t.id}>
                      {t.titulo} <small>({t.sev})</small>{" "}
                      <button type="button" className="btn btn-secondary" onClick={() => pedir({ ...base, accion: "aprobar_item", itemId: t.id })}>
                        Aprobar
                      </button>{" "}
                      <button type="button" className="btn btn-secondary" onClick={() => pedir({ ...base, accion: "descartar_item", itemId: t.id })}>
                        Descartar
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
        {porConfirmar && (
          <div role="alertdialog" aria-label="Confirmar orden" className="card" style={{ marginTop: "0.8rem", border: "2px solid var(--accent)" }}>
            <p style={{ marginTop: 0 }}>{textoConfirmacion(porConfirmar.accion, porConfirmar.nombre, modo, porConfirmar.sensibilidad)}</p>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button type="button" className="btn btn-primary" disabled={enviando} onClick={() => void confirmar()}>
                {enviando ? "Enviando…" : "Confirmar"}
              </button>
              <button type="button" className="btn btn-secondary" disabled={enviando} onClick={() => setPorConfirmar(null)}>
                Cancelar
              </button>
            </div>
          </div>
        )}
        {aviso && (
          <p role="status" style={{ marginBottom: 0 }}>
            {aviso}
          </p>
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
                {ACCION_LABEL[o.accion] ?? o.accion}
                {typeof o.params?.id === "string" ? ` · ${o.params.id}` : ""} — {ESTADO_ORDEN_LABEL[estadoVisible(o, ahora)]}
                {o.resultado ? ` (${o.resultado})` : ""}
                {estadoVisible(o, ahora) === "pendiente" && (
                  <>
                    {" "}
                    <button type="button" className="btn btn-secondary" onClick={() => void cancelarOrden(o.id)}>
                      Cancelar
                    </button>
                  </>
                )}
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
