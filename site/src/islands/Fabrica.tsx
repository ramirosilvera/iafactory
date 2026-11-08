import { useCallback, useEffect, useRef, useState } from "react";
import {
  ACCION_LABEL,
  ESTADO_ORDEN_LABEL,
  accionEjecutor,
  antiguedadTexto,
  calcularAtencion,
  esErrorDePermiso,
  leerAuditoria,
  proximoPaso,
  SEV_LABEL,
  fechaCorta,
  nombreDe,
  resultadoTexto,
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
  const dialogoRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (porConfirmar) dialogoRef.current?.focus();
  }, [porConfirmar]);

  const pedidoRef = useRef(0); // R6: número de pedido; una respuesta vieja no pisa a una más nueva
  const hayDatosRef = useRef(false);
  const realtimeOkRef = useRef(false);
  const [refrescoFallo, setRefrescoFallo] = useState("");

  const cargar = useCallback(async () => {
    const n = ++pedidoRef.current;
    const [h, e, ev, o] = await Promise.all([
      fab().from("heartbeat").select("*").eq("dispositivo", "pc").maybeSingle(),
      fab().from("estado").select("*"),
      fab().from("eventos").select("id,ts,nivel,tipo,proyecto,titulo").order("ts", { ascending: false }).limit(30),
      fab().from("ordenes").select("*").order("creada_at", { ascending: false }).limit(15),
    ]);
    if (n !== pedidoRef.current) return;
    const fallo = h.error || e.error || ev.error || o.error;
    if (fallo) {
      // R6: con datos ya cargados, un error pasajero no tira abajo el tablero: se avisa y se sigue mostrando lo último
      if (hayDatosRef.current) setRefrescoFallo(fallo.message);
      else setError(fallo.message);
      return;
    }
    hayDatosRef.current = true;
    setRefrescoFallo("");
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
      .subscribe((st) => {
        realtimeOkRef.current = st === "SUBSCRIBED";
      });
    // R5: respaldo por consulta. Si el tiempo real no conecta (proxy, red móvil), sin esto el latido no se actualiza
    // en pantalla y a los 90 s se vería "PC sin conexión" con la PC viva. Cada 15 s se recalcula el reloj; se vuelve a
    // consultar cada 30 s si el tiempo real no está conectado, y cada 2 min aunque lo esté.
    let vueltas = 0;
    const tick = setInterval(() => {
      setAhora(Date.now());
      vueltas++;
      if (document.visibilityState === "visible" && (vueltas % 8 === 0 || (!realtimeOkRef.current && vueltas % 2 === 0))) void cargar();
    }, 15_000);
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
        <p>Entrá con tu cuenta para ver la fábrica.</p>
        <a className="btn btn-primary" href={`${import.meta.env.BASE_URL}login/`}>
          Entrar
        </a>
      </div>
    );
  }

  if (error) {
    const permiso = esErrorDePermiso(error);
    return (
      <div className="card" role="alert">
        <h2 style={{ marginTop: 0 }}>{permiso ? "Esta cuenta no tiene acceso" : "No pude leer el tablero"}</h2>
        <p>
          {permiso
            ? `La cuenta ${email ?? ""} no está habilitada para la fábrica. Hay que cargar su email en factory.acceso.`
            : "Puede ser la conexión o que falte aplicar la migración 0038 en Supabase."}
        </p>
        <p className="fab-sub">Detalle técnico: {error}</p>
        <button type="button" className="btn btn-primary" onClick={() => void cargar()}>
          Reintentar
        </button>
      </div>
    );
  }

  const modo = modoConexion(latido, ahora);
  const proyectos = leerResumen(estado["resumen"]?.valor);
  const cuotas = leerCuotas(estado["cuotas"]?.valor);
  const ejecutor = leerEjecutor(estado["ejecutor"]?.valor);
  const fotoDe = estado["resumen"]?.actualizado_at ?? latido?.visto_at ?? null;
  const pc = leerPc(estado["pc"]?.valor);
  const atencion = calcularAtencion(proyectos, ejecutor, cuotas, eventos, ahora);
  const pedir = (p: PorConfirmar) => {
    setAviso("");
    setPorConfirmar(p);
  };

  return (
    <div className="fab-grid">
      <div className={`card fab-estado fab-ancho ${modo}`} role="status" style={{ display: "flex", gap: "0.7rem", alignItems: "center" }}>
        <span className="fab-punto" aria-hidden="true" />
        <div>
          {modo === "vivo" && (
            <>
              <strong>PC en vivo</strong>
              <div className="fab-sub">Último latido {antiguedadTexto(latido?.visto_at, ahora)}</div>
            </>
          )}
          {modo === "apagada" && (
            <>
              <strong>PC sin conexión</strong>
              <div className="fab-sub">Ves la última foto ({antiguedadTexto(fotoDe, ahora)}). Las órdenes quedan en cola hasta que vuelva.</div>
            </>
          )}
          {modo === "sin_datos" && (
            <>
              <strong>Sin datos todavía</strong>
              <div className="fab-sub">La PC aún no publicó nada.</div>
            </>
          )}
        </div>
      </div>

      {refrescoFallo && (
        <p role="alert" className="fab-sub fab-ancho">
          No pude actualizar ({refrescoFallo}). Estás viendo lo último que se cargó.
        </p>
      )}

      {atencion.length > 0 && (
        <section className="card fab-atencion fab-ancho" aria-label="Atención">
          <h2 style={{ margin: 0 }}>Para mirar primero</h2>
          <ul>
            {atencion.map((a, i) => (
              <li key={i}>{a.texto}</li>
            ))}
          </ul>
        </section>
      )}

      {!pc.ordenes && <p className="fab-sub fab-ancho">Las órdenes remotas están desactivadas en la PC.</p>}
      {pc.ordenes && modo === "vivo" && !pc.tablero && <p className="fab-sub fab-ancho">El tablero de la PC está cerrado: las órdenes esperan hasta que lo abras.</p>}

      {proyectos.length === 0 && (
        <section className="card fab-ancho">
          <p style={{ margin: 0 }}>Todavía no hay proyectos publicados.</p>
        </section>
      )}
      {proyectos.map((p) => {
        const ej = ejecutor.proyectos.find((x) => x.id === p.id);
        const cola = leerCola(estado[`cola:${p.id}`]?.valor);
        const base = { id: p.id, nombre: p.nombre, sensibilidad: p.sensibilidad };
        const ae = accionEjecutor(ej);
        const aud = leerAuditoria(estado[`auditoria:${p.id}`]?.valor);
        return (
          <section key={p.id} className="card fab-proyecto" aria-label={p.nombre}>
            <div className="fab-cab">
              <h3>{p.nombre}</h3>
              <span className={`fab-nota ${p.grado ?? ""}`}>{p.nota !== null ? `${p.nota}${p.grado ? ` · ${p.grado}` : ""}` : "sin nota"}</span>
            </div>
            <div style={{ marginTop: "0.4rem" }}>
              <span className="fab-chip">
                {p.pendientes} pendiente{p.pendientes === 1 ? "" : "s"}
              </span>
              {ej && (
                <span className={`fab-chip ${ej.pausado ? "mal" : ej.habilitado ? "ok" : ""}`}>
                  {ej.pausado ? "ejecutor pausado" : ej.habilitado ? "ejecutor activo" : "ejecutor apagado"}
                </span>
              )}
              {ej && <span className="fab-chip">{ej.hechasHoy} hecha{ej.hechasHoy === 1 ? "" : "s"} hoy</span>}
            </div>
            {ej?.pausado && <p className="fab-sub" style={{ margin: "0.4rem 0 0" }}>Motivo: {ej.pausado}</p>}
            {aud && (
              <div className="fab-auditoria">
                <div className="fab-sub">
                  Última auditoría ({antiguedadTexto(aud.cuando, ahora)}): {aud.conteos.alta} alta{aud.conteos.alta === 1 ? "" : "s"}, {aud.conteos.media} media
                  {aud.conteos.media === 1 ? "" : "s"}, {aud.conteos.baja} baja{aud.conteos.baja === 1 ? "" : "s"}
                  {aud.tendencia.delta !== null && aud.tendencia.delta !== 0 ? ` · ${aud.tendencia.delta > 0 ? "+" : ""}${aud.tendencia.delta} puntos vs. la anterior` : ""}
                  {aud.tendencia.nuevos > 0 ? ` · ${aud.tendencia.nuevos} nuevo${aud.tendencia.nuevos === 1 ? "" : "s"}` : ""}
                </div>
                {aud.hallazgos.length > 0 && (
                  <details>
                    <summary>Qué encontró ({aud.total})</summary>
                    <ul className="fab-filas">
                      {aud.hallazgos.map((h) => (
                        <li key={h.id}>
                          <span>
                            <strong>{SEV_LABEL[h.sev]}</strong>
                            {h.nuevo ? " · nuevo" : ""} — {h.titulo}
                          </span>
                          {h.sugerencia && <span className="fab-sub">Qué hacer: {h.sugerencia}</span>}
                        </li>
                      ))}
                    </ul>
                    {aud.total > aud.hallazgos.length && <p className="fab-sub">Se muestran los {aud.hallazgos.length} más importantes de {aud.total}.</p>}
                  </details>
                )}
              </div>
            )}
            <p className="fab-paso">
              <strong>Próximo paso:</strong> {proximoPaso(aud, cola.length, ej?.necesitaPersona ?? 0)}
            </p>
            <div className="fab-botones">
              <button type="button" className="btn btn-secondary" onClick={() => pedir({ ...base, accion: ae.accion })}>
                {ae.label}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => pedir({ ...base, accion: "auditar" })}>
                Auditar ahora
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => pedir({ ...base, accion: "encolar" })}>
                Armar plan
              </button>
            </div>
            {cola.length > 0 && (
              <>
                <div className="fab-sub">Tareas esperando</div>
                <ul className="fab-filas">
                  {cola.map((t) => (
                    <li key={t.id}>
                      <span>
                        {t.titulo} <span className="fab-sub">({t.sev})</span>
                      </span>
                      <div className="fab-fila-acc">
                        <button type="button" className="btn btn-secondary" onClick={() => pedir({ ...base, accion: "aprobar_item", itemId: t.id })}>
                          Aprobar
                        </button>
                        <button type="button" className="btn btn-secondary" onClick={() => pedir({ ...base, accion: "descartar_item", itemId: t.id })}>
                          Descartar
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        );
      })}

      {ejecutor.ultima && (
        <section className="card fab-ancho">
          <h2>Última corrida del ejecutor</h2>
          <p style={{ margin: 0 }}>
            {nombreDe(proyectos, ejecutor.ultima.proyecto)}: {resultadoTexto(ejecutor.ultima.resultado)}{" "}
            <span className="fab-sub">({antiguedadTexto(ejecutor.ultima.cuando, ahora)})</span>
          </p>
        </section>
      )}

      <section className="card">
        <h2>Cuotas de modelos</h2>
        {cuotas.length === 0 ? (
          <p>Sin información.</p>
        ) : (
          <ul className="fab-filas">
            {cuotas.map((c) => {
              const enfriando = c.hasta && Date.parse(c.hasta) > ahora;
              return (
                <li key={c.ruta}>
                  <strong>{c.ruta}</strong>
                  <span className="fab-sub">
                    {c.usado !== null ? `${c.usado} uso${c.usado === 1 ? "" : "s"} hoy` : "sin dato de uso"}
                    {enfriando ? ` · sin cupo hasta ${fechaCorta(c.hasta as string)}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Órdenes</h2>
        {ordenes.length === 0 ? (
          <p>No hay órdenes.</p>
        ) : (
          <ul className="fab-filas">
            {ordenes.map((o) => {
              const ev = estadoVisible(o, ahora);
              const proy = typeof o.params?.id === "string" ? nombreDe(proyectos, o.params.id) : null;
              return (
                <li key={o.id}>
                  <span>
                    <strong>{ACCION_LABEL[o.accion] ?? o.accion}</strong>
                    {proy ? ` · ${proy}` : ""}
                  </span>
                  <span className="fab-sub">
                    {ESTADO_ORDEN_LABEL[ev]}
                    {o.resultado ? ` — ${o.resultado}` : ""}
                  </span>
                  {ev === "pendiente" && (
                    <div className="fab-fila-acc">
                      <button type="button" className="btn btn-secondary" onClick={() => void cancelarOrden(o.id)}>
                        Cancelar orden
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card fab-ancho">
        <h2>Eventos recientes</h2>
        {eventos.length === 0 ? (
          <p>Sin eventos.</p>
        ) : (
          <ul className="fab-filas">
            {eventos.map((e) => (
              <li key={e.id}>
                <span>
                  {e.nivel === "error" ? "⛔ " : e.nivel === "aviso" ? "⚠️ " : ""}
                  {e.proyecto ? `${nombreDe(proyectos, e.proyecto)} · ` : ""}
                  {e.titulo}
                </span>
                <span className="fab-sub">{fechaCorta(e.ts)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {porConfirmar && (
        <div ref={dialogoRef} tabIndex={-1} role="alertdialog" aria-label="Confirmar orden" className="card fab-confirmar fab-ancho">
          <p style={{ marginTop: 0 }}>{textoConfirmacion(porConfirmar.accion, porConfirmar.nombre, modo, porConfirmar.sensibilidad)}</p>
          <div className="fab-botones" style={{ marginBottom: 0 }}>
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
        <p role="status" className="fab-sub fab-ancho">
          {aviso}
        </p>
      )}
    </div>
  );
}
