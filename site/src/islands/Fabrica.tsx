import { useCallback, useEffect, useRef, useState } from "react";
import {
  ACCION_LABEL,
  ESTADO_ORDEN_LABEL,
  accionEjecutor,
  antiguedadTexto,
  calcularAtencion,
  calcularPilares,
  saludGeneral,
  esErrorDePermiso,
  esSesionVencida,
  leerAuditoria,
  proximoPaso,
  SEV_LABEL,
  fechaCorta,
  nombreDe,
  resultadoTexto,
  estadoVisible,
  leerCola,
  leerColaTotal,
  leerSinResolver,
  leerCuotas,
  leerPrivacidad,
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

type Vista = "inicio" | "proyectos" | "pilares" | "ordenes" | "actividad" | "modelos";
const VISTAS: { id: Vista; nombre: string }[] = [
  { id: "inicio", nombre: "Inicio" },
  { id: "proyectos", nombre: "Proyectos" },
  { id: "pilares", nombre: "Los 7 pilares" },
  { id: "ordenes", nombre: "Órdenes" },
  { id: "actividad", nombre: "Actividad" },
  { id: "modelos", nombre: "Modelos y cuotas" },
];
const vistaDeHash = (): Vista => {
  try {
    const h = window.location.hash.replace("#", "");
    return VISTAS.some((v) => v.id === h) ? (h as Vista) : "inicio";
  } catch {
    return "inicio";
  }
};

export default function Fabrica() {
  const [vista, setVista] = useState<Vista>("inicio");
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    setVista(vistaDeHash());
    const alCambiar = () => setVista(vistaDeHash());
    window.addEventListener("hashchange", alCambiar);
    return () => window.removeEventListener("hashchange", alCambiar);
  }, []);
  const irA = (v: Vista) => {
    setMenu(false);
    setVista(v);
    try {
      window.history.replaceState(null, "", v === "inicio" ? window.location.pathname + window.location.search : `#${v}`);
      window.scrollTo({ top: 0 });
    } catch {
      /* sin historial: igual cambia la vista */
    }
  };
  useEffect(() => {
    if (!menu) return;
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [menu]);
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
  const [sesionVencida, setSesionVencida] = useState(false);

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
    if (fallo && esSesionVencida(fallo.message)) {
      // S7: el token venció y no se pudo renovar: se pide volver a entrar (no es un problema de permisos)
      setSesionVencida(true);
      setSesion("no");
      return;
    }
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
    // S7: si la sesión se cierra (en otra pestaña o porque no se pudo renovar), se vuelve a la pantalla de entrada
    const { data: sub } = supabase.auth.onAuthStateChange((evento) => {
      if (cerrado || evento !== "SIGNED_OUT") return;
      setSesion("no");
      setEmail(null);
    });
    return () => {
      cerrado = true;
      sub.subscription.unsubscribe();
    };
  }, [cargar]);

  async function salir() {
    await supabase.auth.signOut({ scope: "local" });
    setSesionVencida(false);
    setSesion("no");
    setEmail(null);
  }

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
    // S6: sin .select() un UPDATE que RLS deja en 0 filas (la PC ya la tomó) no da error: se verifica que cambió de verdad
    const { data, error: e } = await fab().from("ordenes").update({ estado: "cancelada" }).eq("id", id).eq("estado", "pendiente").select("id");
    setAviso(e ? `No se pudo cancelar: ${e.message}` : data && data.length > 0 ? "Orden cancelada." : "No se pudo cancelar: la PC ya la tomó o venció.");
    void cargar();
  }

  if (!SUPABASE_CONFIGURADO) return <ConfigWarning />;
  if (sesion === "cargando") return <p>Cargando…</p>;
  if (sesion === "no") {
    return (
      <div className="card empty-state">
        <p>{sesionVencida ? "Tu sesión venció. Volvé a entrar para seguir." : "Entrá con tu cuenta para ver la fábrica."}</p>
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

  const auditorias = proyectos.map((p) => leerAuditoria(estado[`auditoria:${p.id}`]?.valor)).filter((x): x is NonNullable<typeof x> => x !== null);
  const pilares = calcularPilares(proyectos, ejecutor, cuotas, auditorias, atencion.length, ahora, leerPrivacidad(estado["privacidad"]?.valor));
  const salud = saludGeneral(proyectos);
  const pendientesTotal = proyectos.reduce((n, p) => n + p.pendientes, 0);
  const hechasHoy = ejecutor.proyectos.reduce((n, e) => n + e.hechasHoy, 0);
  const ordenesEnCola = ordenes.filter((o) => estadoVisible(o, ahora) === "pendiente").length;
  const CIRC = 2 * Math.PI * 52;
  const paraAprobar = proyectos.reduce((n, p) => n + leerColaTotal(estado[`cola:${p.id}`]?.valor) + leerSinResolver(estado[`cola:${p.id}`]?.valor).total, 0);

  const acciones = (p: (typeof proyectos)[number]) => {
    const ej = ejecutor.proyectos.find((x) => x.id === p.id);
    const base = { id: p.id, nombre: p.nombre, sensibilidad: p.sensibilidad };
    const cola = leerCola(estado[`cola:${p.id}`]?.valor);
    const sr = leerSinResolver(estado[`cola:${p.id}`]?.valor);
    return { ej, base, ae: accionEjecutor(ej), cola, totalCola: leerColaTotal(estado[`cola:${p.id}`]?.valor) + sr.total };
  };

  return (
    <div className="app">
      <header className="app-top">
        <div className="app-marca">
          <Logo />
          <div>
            <strong>IA Factory</strong>
            <span>{VISTAS.find((v) => v.id === vista)?.nombre ?? "Centro de control"}</span>
          </div>
        </div>
        <div className="app-der">
          <div className={`pill-estado ${modo}`} role="status">
            <span className="fab-punto" aria-hidden="true" />
            {modo === "vivo" && <>En vivo<span className="pill-tiempo"> · {antiguedadTexto(latido?.visto_at, ahora)}</span></>}
            {modo === "apagada" && <>Sin conexión<span className="pill-tiempo"> · {antiguedadTexto(fotoDe, ahora)}</span></>}
            {modo === "sin_datos" && <>Sin datos todavía</>}
          </div>
          <button type="button" className="btn-menu" aria-label="Menú" aria-expanded={menu} aria-controls="menu-principal" onClick={() => setMenu((m) => !m)}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              {menu ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
      </header>

      {menu && (
        <>
          <div className="menu-fondo" onClick={() => setMenu(false)} aria-hidden="true" />
          <nav id="menu-principal" className="menu-panel" aria-label="Secciones">
            <ul>
              {VISTAS.map((v) => (
                <li key={v.id}>
                  <button type="button" aria-current={vista === v.id ? "page" : undefined} onClick={() => irA(v.id)}>
                    {v.nombre}
                    {v.id === "ordenes" && ordenesEnCola > 0 && <span className="menu-badge">{ordenesEnCola}</span>}
                    {v.id === "proyectos" && paraAprobar > 0 && <span className="menu-badge">{paraAprobar}</span>}
                  </button>
                </li>
              ))}
            </ul>
            <div className="menu-pie">
              {email && <span className="fab-sub">{email}</span>}
              <button type="button" className="btn btn-secondary btn-chico" onClick={() => void salir()}>
                Salir
              </button>
            </div>
          </nav>
        </>
      )}

      {refrescoFallo && (
        <p role="alert" className="fab-sub">
          No pude actualizar ({refrescoFallo}). Estás viendo lo último que se cargó.
        </p>
      )}
      {porConfirmar && (
        <div ref={dialogoRef} tabIndex={-1} role="alertdialog" aria-label="Confirmar orden" className="card fab-confirmar">
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

      {vista === "inicio" && (
        <>
          <section className="hero hero-chico" aria-label="Salud de la fábrica">
            <div className="hero-anillo">
              <svg viewBox="0 0 120 120" width="92" height="92" role="img" aria-label={salud ? `Salud general ${salud.nota} de 100, grado ${salud.grado}` : "Sin nota todavía"}>
                <defs>
                  <linearGradient id="grad-anillo" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="var(--accent)" />
                    <stop offset="100%" stopColor="var(--accent2)" />
                  </linearGradient>
                </defs>
                <circle cx="60" cy="60" r="52" className="anillo-fondo" />
                <circle cx="60" cy="60" r="52" className="anillo-valor" stroke="url(#grad-anillo)" strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - (salud?.nota ?? 0) / 100)} transform="rotate(-90 60 60)" />
              </svg>
              <div className="anillo-centro">
                <strong>{salud ? salud.nota : "—"}</strong>
                <span>{salud ? salud.grado : ""}</span>
              </div>
            </div>
            <div className="hero-texto">
              <p className="hero-etiqueta">Salud de la fábrica</p>
              <h1>{proyectos.length === 0 ? "Esperando a la PC" : atencion.length === 0 ? "Todo bajo control" : `${atencion.length} ${atencion.length === 1 ? "cosa" : "cosas"} para mirar`}</h1>
            </div>
            <dl className="hero-kpis">
              <div><dt>Proyectos</dt><dd>{proyectos.length}</dd></div>
              <div><dt>Pendientes</dt><dd>{pendientesTotal}</dd></div>
              <div><dt>Hechas hoy</dt><dd>{hechasHoy}</dd></div>
              <div><dt>En cola</dt><dd>{ordenesEnCola}</dd></div>
            </dl>
          </section>

          {atencion.length > 0 && (
            <section className="card fab-atencion" aria-label="Atención">
              <ul>
                {atencion.slice(0, 2).map((a, i) => (
                  <li key={i}>{a.texto}</li>
                ))}
              </ul>
              {atencion.length > 2 && (
                <button type="button" className="enlace" onClick={() => irA("actividad")}>
                  Ver las {atencion.length}
                </button>
              )}
            </section>
          )}

          <section aria-labelledby="t-pilares" className="card tabla-card">
            <div className="tabla-cab">
              <h2 id="t-pilares" className="sec-titulo">Los 7 pilares</h2>
              <button type="button" className="enlace" onClick={() => irA("pilares")}>Detalle</button>
            </div>
            <table className="tabla-pilares">
              <caption className="solo-lectores">Resumen de los 7 pilares</caption>
              <thead className="solo-lectores"><tr><th>Pilar</th><th>Valor</th><th>Estado</th></tr></thead>
              <tbody>
                {pilares.map((pl) => (
                  <tr key={pl.clave} className={pl.tono}>
                    <td><span className="pilar-num">{pl.n}</span> {pl.nombre}</td>
                    <td className="tabla-valor"><strong>{pl.valor}</strong> <span>{pl.unidad}</span></td>
                    <td><span className={`semaforo ${pl.tono}`} role="img" aria-label={pl.tono === "ok" ? "bien" : pl.tono === "warn" ? "atención" : pl.tono === "mal" ? "mal" : "sin dato"} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section aria-labelledby="t-acciones" className="card">
            <h2 id="t-acciones" className="sec-titulo">Acciones</h2>
            {proyectos.length === 0 && <p style={{ margin: 0 }}>Todavía no hay proyectos publicados.</p>}
            <ul className="acc-lista">
              {proyectos.map((p) => {
                const { ej, base, ae, cola, totalCola } = acciones(p);
                return (
                  <li key={p.id}>
                    <div className="acc-cab">
                      <strong>{p.nombre}</strong>
                      <span className={`fab-nota ${p.grado ?? ""}`}>{p.nota !== null ? `${p.nota}${p.grado ? ` · ${p.grado}` : ""}` : "sin nota"}</span>
                      {ej?.pausado && <span className="fab-chip mal">pausado</span>}
                      {totalCola > 0 && <button type="button" className="btn btn-primary btn-chico btn-aprobar" onClick={() => irA("proyectos")}>Revisar {totalCola}</button>}
                    </div>
                    <div className="fab-botones">
                      <button type="button" className="btn btn-secondary btn-chico" onClick={() => pedir({ ...base, accion: ae.accion })}>{ae.label}</button>
                      <button type="button" className="btn btn-secondary btn-chico" onClick={() => pedir({ ...base, accion: "auditar" })}>Auditar</button>
                      <button type="button" className="btn btn-secondary btn-chico" onClick={() => pedir({ ...base, accion: "encolar" })}>Armar plan</button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}

      {vista === "pilares" && (
      <section aria-labelledby="t-pilares">
        <h2 id="t-pilares" className="sec-titulo">Los 7 pilares, en detalle</h2>
        <ul className="pilares">
          {pilares.map((pl) => (
            <li key={pl.clave} className={`pilar ${pl.tono}`}>
              <div className="pilar-cab">
                <span className="pilar-icono" aria-hidden="true"><IconoPilar clave={pl.clave} /></span>
                <span className="pilar-num">{pl.n}</span>
              </div>
              <h3>{pl.nombre}</h3>
              <p className="pilar-lema">{pl.lema}</p>
              <p className="pilar-valor"><strong>{pl.valor}</strong> <span>{pl.unidad}</span></p>
              <p className="pilar-detalle">{pl.detalle}</p>
            </li>
          ))}
        </ul>
      </section>

      )}

      {vista === "proyectos" && (
        <div className="fab-grid">
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
        const totalCola = leerColaTotal(estado[`cola:${p.id}`]?.valor);
        const sinRes = leerSinResolver(estado[`cola:${p.id}`]?.valor);
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
                <div className="fab-sub">Tareas esperando{totalCola > cola.length ? ` (se muestran ${cola.length} de ${totalCola}; al aprobar o descartar aparecen las siguientes)` : ""}</div>
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
            {sinRes.items.length > 0 && (
              <>
                <div className="fab-sub">
                  Sin resolver: requieren tu autorización o revisión{sinRes.total > sinRes.items.length ? ` (se muestran ${sinRes.items.length} de ${sinRes.total})` : ""}
                </div>
                <ul className="fab-filas">
                  {sinRes.items.map((t) => (
                    <li key={t.id}>
                      <span>
                        {t.titulo} <span className="fab-sub">({t.sev}{t.intentos ? `, ${t.intentos} intento${t.intentos === 1 ? "" : "s"}` : ""})</span>
                        {t.motivo && <span className="fab-sub fab-motivo">{t.motivo}</span>}
                      </span>
                      <div className="fab-fila-acc">
                        <button type="button" className="btn btn-secondary" onClick={() => pedir({ ...base, accion: "aprobar_item", itemId: t.id })}>
                          Autorizar y reintentar
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
            {sinRes.enviadas > 0 && <p className="fab-sub">{sinRes.enviadas} tarea{sinRes.enviadas === 1 ? "" : "s"} en manos del ejecutor o del agente.</p>}
          </section>
        );
      })}

        </div>
      )}

      {vista === "ordenes" && <div className="fab-grid">
      <section className="card fab-ancho">
        <h2>Órdenes</h2>
        {ordenes.length >= 15 && <p className="fab-sub" style={{ marginTop: 0 }}>Se muestran las últimas 15.</p>}
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

</div>}

      {vista === "actividad" && (
        <div className="fab-grid">
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

      {ejecutor.ultima && (
        <section className="card fab-ancho">
          <h2>Última corrida del ejecutor</h2>
          <p style={{ margin: 0 }}>
            {nombreDe(proyectos, ejecutor.ultima.proyecto)}: {resultadoTexto(ejecutor.ultima.resultado)}{" "}
            <span className="fab-sub">({antiguedadTexto(ejecutor.ultima.cuando, ahora)})</span>
          </p>
        </section>
      )}

      <section className="card fab-ancho">
        <h2>Eventos recientes</h2>
        <p className="fab-sub" style={{ marginTop: 0 }}>Del ejecutor y de las órdenes remotas, últimos {eventos.length >= 30 ? "30" : eventos.length}.</p>
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

        </div>
      )}

      {vista === "modelos" && <div className="fab-grid">
      <section className="card fab-ancho">
        <h2>Modelos y cuotas</h2>
        {cuotas.length === 0 ? (
          <p>Sin información todavía: la PC publica los modelos declarados en cuanto arranca.</p>
        ) : (
          <>
            <p className="fab-sub" style={{ marginTop: 0 }}>
              {cuotas.length} modelos de {new Set(cuotas.map((c) => c.proveedor)).size} proveedores. El uso y el enfriamiento se cuentan por proveedor, no por modelo.
            </p>
            <ul className="modelos">
              {cuotas.map((c) => {
                const enfriando = !!c.hasta && Date.parse(c.hasta) > ahora;
                const local = /ollama|local/i.test(c.proveedor) || /:\d+k$/.test(c.ruta);
                return (
                  <li key={c.ruta}>
                    <div>
                      <strong>{c.ruta}{c.pago ? " · de pago" : ""}</strong>
                      <span className="fab-sub">{c.roles.length ? `Roles: ${c.roles.join(", ")}` : "Sin rol asignado"}</span>
                    </div>
                    <div className="modelos-der">
                      <span className="fab-sub">{c.usado !== null ? `${c.usado}${c.limite ? ` de ${c.limite}` : ""} uso${c.usado === 1 ? "" : "s"} hoy` : local ? "local" : "sin uso hoy"}</span>
                      <span className={`fab-chip ${enfriando ? "mal" : "ok"}`}>{enfriando ? `sin cupo hasta ${fechaCorta(c.hasta as string)}` : local ? "sin límite" : "con cupo"}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

</div>}
    </div>
  );
}

function Logo() {
  return (
    <svg className="logo" viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">
      <defs>
        <linearGradient id="grad-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--accent)" />
          <stop offset="100%" stopColor="var(--accent2)" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill="url(#grad-logo)" />
      <path d="M10 28V16l7 4v-4l7 4v-4l6 3v9z" fill="#fff" fillOpacity=".95" />
      <rect x="11" y="9" width="4" height="9" rx="1" fill="#fff" fillOpacity=".95" />
    </svg>
  );
}

function IconoPilar({ clave }: { clave: string }) {
  const caminos: Record<string, string> = {
    autonomia: "M12 3v3m0 12v3M3 12h3m12 0h3M7 7l2 2m6 6 2 2M17 7l-2 2m-6 6-2 2M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
    eficiencia: "M13 2 4 14h7l-1 8 9-12h-7z",
    mejora: "M3 17l6-6 4 4 8-8m0 0h-5m5 0v5",
    "cinco-s": "M4 6h16M4 12h16M4 18h10",
    privacidad: "M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6zM9.5 12l2 2 3.5-4",
    experiencia: "M12 21c-5-4-8-7-8-11a5 5 0 0 1 8-3.500A5 5 0 0 1 20 10c0 4-3 7-8 11z",
    calidad: "M12 3l2.5 5.5 6 .7-4.5 4 1.3 6L12 16.5 6.7 19.2 8 13.2 3.5 9.2l6-.7z",
  };
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={caminos[clave] ?? ""} />
    </svg>
  );
}
