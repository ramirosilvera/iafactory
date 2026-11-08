/**
 * Lógica pura del tablero de la IA Factory (sin red, sin React): decidir si la PC está "en vivo" o apagada a partir del
 * latido, interpretar los datos de estado que publica la PC y marcar como vencidas las órdenes viejas.
 *
 * Regla de oro: NUNCA mostrar un dato viejo como si fuera actual -- por eso todo pasa por `modoConexion` y por
 * `antiguedadTexto`.
 */

export type ModoConexion = "vivo" | "apagada" | "sin_datos";

/** Sin latido por más de esto = la PC se considera apagada (la PC late cada ~30 s). */
export const UMBRAL_LATIDO_MS = 90_000;

export interface Latido {
  dispositivo: string;
  visto_at: string;
  version?: string | null;
}

export function modoConexion(latido: Pick<Latido, "visto_at"> | null | undefined, ahoraMs: number, umbralMs = UMBRAL_LATIDO_MS): ModoConexion {
  if (!latido) return "sin_datos";
  const t = Date.parse(latido.visto_at);
  if (Number.isNaN(t)) return "sin_datos";
  // un reloj adelantado del lado de la PC (t en el futuro) no puede contar como "vivo" para siempre
  const edad = ahoraMs - t;
  if (edad < -umbralMs) return "sin_datos";
  return edad <= umbralMs ? "vivo" : "apagada";
}

export function antiguedadTexto(desdeIso: string | null | undefined, ahoraMs: number): string {
  if (!desdeIso) return "sin datos";
  const t = Date.parse(desdeIso);
  if (Number.isNaN(t)) return "sin datos";
  const s = Math.max(0, Math.round((ahoraMs - t) / 1000));
  if (s < 60) return "hace instantes";
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}

/* ───────────── órdenes ───────────── */

export type AccionOrden = "pausar_ejecutor" | "reanudar_ejecutor" | "encolar" | "aprobar_item" | "descartar_item" | "auditar";
export type EstadoOrden = "pendiente" | "tomada" | "hecha" | "rechazada" | "vencida" | "cancelada";

export interface Orden {
  id: string;
  creada_at: string;
  accion: AccionOrden;
  params: Record<string, unknown>;
  vigencia_hasta: string;
  estado: EstadoOrden;
  resultado?: string | null;
}

/** Cuánto vive una orden en cola antes de considerarse vencida (ms). Las que frenan algo son urgentes. */
export const VIGENCIA_MS: Record<AccionOrden, number> = {
  pausar_ejecutor: 15 * 60_000,
  reanudar_ejecutor: 6 * 3_600_000,
  encolar: 24 * 3_600_000,
  aprobar_item: 24 * 3_600_000,
  descartar_item: 24 * 3_600_000,
  auditar: 24 * 3_600_000,
};

export function vigenciaHasta(accion: AccionOrden, ahoraMs: number): string {
  return new Date(ahoraMs + VIGENCIA_MS[accion]).toISOString();
}

/** Una orden pendiente cuya vigencia pasó se muestra (y la PC la trata) como vencida. */
export function estadoVisible(o: Pick<Orden, "estado" | "vigencia_hasta">, ahoraMs: number): EstadoOrden {
  if (o.estado !== "pendiente") return o.estado;
  const v = Date.parse(o.vigencia_hasta);
  return !Number.isNaN(v) && v < ahoraMs ? "vencida" : "pendiente";
}

export const ESTADO_ORDEN_LABEL: Record<EstadoOrden, string> = {
  pendiente: "Pendiente: se ejecuta cuando la PC esté disponible",
  tomada: "En ejecución",
  hecha: "Hecha",
  rechazada: "Rechazada",
  vencida: "Vencida (no se ejecutó a tiempo)",
  cancelada: "Cancelada",
};

/* ───────────── datos publicados por la PC (tolerantes: pueden faltar campos) ───────────── */

export interface ResumenProyecto {
  id: string;
  nombre: string;
  nota: number | null;
  grado: string | null;
  pendientes: number;
  sensibilidad: string | null;
}
export interface CuotaRuta {
  ruta: string;
  usado: number | null;
  limite: number | null;
  /** si la ruta está en enfriamiento por cuota agotada, hasta cuándo (ISO) */
  hasta: string | null;
}
export interface EjecutorProyecto {
  id: string;
  habilitado: boolean;
  pausado: string | null;
  esperando: number;
  hechasHoy: number;
  necesitaPersona: number;
  sensibilidad: string | null;
}
export interface EstadoEjecutor {
  activo: boolean;
  pausadoProyectos: string[];
  proyectos: EjecutorProyecto[];
  ultima: { proyecto: string; resultado: string; cuando: string } | null;
}
export interface TareaCola {
  id: string;
  titulo: string;
  sev: string;
  cat: string;
}
export interface EstadoPc {
  tablero: boolean;
  ordenes: boolean;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export function leerResumen(valor: unknown): ResumenProyecto[] {
  return arr(obj(valor).proyectos)
    .map((p) => obj(p))
    .filter((p) => str(p.id))
    .map((p) => ({
      id: str(p.id),
      nombre: str(p.nombre) || str(p.id),
      nota: num(p.nota),
      grado: str(p.grado) || null,
      pendientes: num(p.pendientes) ?? 0,
      sensibilidad: str(p.sensibilidad) || null,
    }));
}

export function leerCuotas(valor: unknown): CuotaRuta[] {
  return arr(obj(valor).rutas)
    .map((r) => obj(r))
    .filter((r) => str(r.ruta))
    .map((r) => ({ ruta: str(r.ruta), usado: num(r.usado), limite: num(r.limite), hasta: str(r.hasta) || null }));
}

export function leerEjecutor(valor: unknown): EstadoEjecutor {
  const o = obj(valor);
  const u = o.ultima ? obj(o.ultima) : null;
  return {
    activo: o.activo === true,
    pausadoProyectos: arr(o.pausadoProyectos).map(str).filter(Boolean),
    proyectos: arr(o.proyectos)
      .map((p) => obj(p))
      .filter((p) => str(p.id))
      .map((p) => ({
        id: str(p.id),
        habilitado: p.habilitado === true,
        pausado: str(p.pausado) || null,
        esperando: num(p.esperando) ?? 0,
        hechasHoy: num(p.hechasHoy) ?? 0,
        necesitaPersona: num(p.necesitaPersona) ?? 0,
        sensibilidad: str(p.sensibilidad) || null,
      })),
    ultima: u && str(u.proyecto) ? { proyecto: str(u.proyecto), resultado: str(u.resultado), cuando: str(u.cuando) } : null,
  };
}

export function porcentajeCuota(c: CuotaRuta): number | null {
  if (c.usado === null || c.limite === null || c.limite <= 0) return null;
  return Math.min(100, Math.round((c.usado / c.limite) * 100));
}

export function leerCola(valor: unknown): TareaCola[] {
  return arr(obj(valor).items)
    .map((i) => obj(i))
    .filter((i) => ID_ITEM.test(str(i.id)))
    .map((i) => ({ id: str(i.id), titulo: str(i.titulo), sev: str(i.sev), cat: str(i.cat) }));
}

export function leerPc(valor: unknown): EstadoPc {
  const o = obj(valor);
  return { tablero: o.tablero === true, ordenes: o.ordenes !== false };
}

/* ───────────── crear órdenes (mismas reglas que la lista permitida de la PC) ───────────── */

export const ID_PROYECTO = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const ID_ITEM = /^[a-f0-9]{6,12}$/;

export const ACCION_LABEL: Record<AccionOrden, string> = {
  pausar_ejecutor: "Pausar el ejecutor",
  reanudar_ejecutor: "Reanudar el ejecutor",
  encolar: "Armar plan de tareas",
  aprobar_item: "Aprobar tarea",
  descartar_item: "Descartar tarea",
  auditar: "Auditar ahora",
};

export interface NuevaOrden {
  accion: AccionOrden;
  params: Record<string, unknown>;
  vigencia_hasta: string;
  creada_por: string | null;
}

/** Arma la fila a insertar o devuelve el problema. La base y la PC vuelven a validar: esta es la primera barrera. */
export function nuevaOrden(
  accion: AccionOrden,
  params: { id: string; itemId?: string; confirmado?: boolean },
  ahoraMs: number,
  email: string | null,
): { ok: true; orden: NuevaOrden } | { ok: false; error: string } {
  if (!(accion in VIGENCIA_MS)) return { ok: false, error: "acción desconocida" };
  if (!ID_PROYECTO.test(params.id)) return { ok: false, error: "proyecto inválido" };
  const p: Record<string, unknown> = { id: params.id };
  if (accion === "aprobar_item" || accion === "descartar_item") {
    if (!params.itemId || !ID_ITEM.test(params.itemId)) return { ok: false, error: "tarea inválida" };
    p.itemId = params.itemId;
  }
  if (accion === "reanudar_ejecutor") {
    if (params.confirmado !== true) return { ok: false, error: "falta la confirmación" };
    p.confirmado = true;
  }
  return { ok: true, orden: { accion, params: p, vigencia_hasta: vigenciaHasta(accion, ahoraMs), creada_por: email } };
}

/** Texto de la confirmación en pantalla (ninguna orden sale sin que la persona la lea y acepte). */
export function textoConfirmacion(accion: AccionOrden, proyecto: string, modo: ModoConexion, sensibilidad: string | null): string {
  const cuando =
    modo === "vivo"
      ? "La PC está conectada: se ejecuta en segundos."
      : "La PC no está conectada: queda en cola y se ejecuta cuando vuelva (si no vuelve a tiempo, vence sola).";
  const extra = accion === "reanudar_ejecutor" && sensibilidad === "P3" ? " Es un proyecto con datos sensibles (P3): vas a volver a habilitar el ejecutor automático, que modifica código." : "";
  return `${ACCION_LABEL[accion]} en ${proyecto}. ${cuando}${extra}`;
}

/* ───────────── presentación ───────────── */

/** Resultados del ejecutor tal como los escribe el log (en inglés) → texto para la persona. */
export const RESULTADO_LABEL: Record<string, string> = {
  done: "corrigió",
  failed: "revirtió (no pasó las pruebas)",
  "needs-human": "necesita a una persona",
  "model-down": "sin modelo disponible",
  stale: "reintenta (el archivo cambió)",
};
export const resultadoTexto = (r: string): string => RESULTADO_LABEL[r] ?? (r || "sin dato");

export const nombreDe = (proyectos: { id: string; nombre: string }[], id: string): string => proyectos.find((p) => p.id === id)?.nombre ?? id;

/** Fecha corta y no ambigua: "dom 9 nov, 11:20". */
export function fechaCorta(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "fecha desconocida";
  return new Date(t).toLocaleString("es-AR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
}

export interface Atencion {
  tipo: "pausado" | "persona" | "sin_cupo" | "error";
  texto: string;
}

/** Lo que hay que mirar primero: ejecutor pausado, tareas que esperan a una persona, rutas sin cupo, errores recientes. */
export function calcularAtencion(
  proyectos: { id: string; nombre: string }[],
  ejecutor: EstadoEjecutor,
  cuotas: CuotaRuta[],
  eventos: { nivel: string; ts: string; proyecto: string | null; titulo: string }[],
  ahoraMs: number,
): Atencion[] {
  const out: Atencion[] = [];
  for (const p of ejecutor.proyectos) {
    const n = nombreDe(proyectos, p.id);
    if (p.pausado) out.push({ tipo: "pausado", texto: `${n}: ejecutor pausado (${p.pausado})` });
    if (p.necesitaPersona > 0) out.push({ tipo: "persona", texto: `${n}: ${p.necesitaPersona} tarea${p.necesitaPersona === 1 ? "" : "s"} necesita${p.necesitaPersona === 1 ? "" : "n"} a una persona` });
  }
  for (const c of cuotas) if (c.hasta && Date.parse(c.hasta) > ahoraMs) out.push({ tipo: "sin_cupo", texto: `${c.ruta}: sin cupo hasta ${fechaCorta(c.hasta)}` });
  const reciente = eventos.find((e) => e.nivel === "error" && ahoraMs - Date.parse(e.ts) < 24 * 3_600_000);
  if (reciente) out.push({ tipo: "error", texto: reciente.titulo });
  return out;
}

/** Texto del botón de encendido/apagado del ejecutor según su estado real. */
export function accionEjecutor(e: EjecutorProyecto | undefined): { accion: "pausar_ejecutor" | "reanudar_ejecutor"; label: string } {
  if (e?.habilitado && !e.pausado) return { accion: "pausar_ejecutor", label: "Pausar ejecutor" };
  return { accion: "reanudar_ejecutor", label: e?.pausado ? "Reanudar ejecutor" : "Encender ejecutor" };
}

/** ¿El error de lectura es de permisos (cuenta sin acceso) y no de conexión o de migración pendiente? */
export function esErrorDePermiso(mensaje: string): boolean {
  return /permission denied|42501|row-level security|not allowed|JWT/i.test(mensaje);
}

/* ───────────── auditoría: qué encontró y qué hacer ───────────── */

export interface Hallazgo {
  id: string;
  sev: "alta" | "media" | "baja" | "info";
  cat: string;
  titulo: string;
  sugerencia: string;
  nuevo: boolean;
}
export interface Auditoria {
  cuando: string;
  nota: number | null;
  grado: string | null;
  conteos: { alta: number; media: number; baja: number; info: number };
  tendencia: { delta: number | null; nuevos: number; resueltos: number };
  total: number;
  /** hallazgos de orden y limpieza (pilar 5S); null si la PC todavía no lo publica */
  orden: number | null;
  hallazgos: Hallazgo[];
}

const SEVS = ["alta", "media", "baja", "info"] as const;

export function leerAuditoria(valor: unknown): Auditoria | null {
  const o = obj(valor);
  if (!str(o.cuando)) return null;
  const c = obj(o.conteos);
  const t = obj(o.tendencia);
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    cuando: str(o.cuando),
    nota: typeof o.nota === "number" ? o.nota : null,
    grado: str(o.grado) || null,
    conteos: { alta: n(c.alta), media: n(c.media), baja: n(c.baja), info: n(c.info) },
    tendencia: { delta: typeof t.delta === "number" ? t.delta : null, nuevos: n(t.nuevos), resueltos: n(t.resueltos) },
    total: n(o.total),
    orden: typeof o.orden === "number" && Number.isFinite(o.orden) ? o.orden : null,
    hallazgos: arr(o.hallazgos)
      .map((h) => obj(h))
      .filter((h) => (SEVS as readonly string[]).includes(str(h.sev)))
      .map((h) => ({ id: str(h.id), sev: str(h.sev) as Hallazgo["sev"], cat: str(h.cat), titulo: str(h.titulo), sugerencia: str(h.sugerencia), nuevo: h.nuevo === true })),
  };
}

/** Una frase con lo primero que conviene hacer según lo que encontró la auditoría y lo que espera en la cola. */
export function proximoPaso(a: Auditoria | null, tareasEsperando: number, necesitaPersona: number): string {
  if (!a) return "Todavía no hay una auditoría guardada: tocá “Auditar ahora”.";
  if (necesitaPersona > 0) return `Hay ${necesitaPersona} tarea${necesitaPersona === 1 ? "" : "s"} que necesita${necesitaPersona === 1 ? "" : "n"} a una persona: revisalas primero.`;
  if (a.conteos.alta > 0) return `Resolvé primero ${a.conteos.alta === 1 ? "el hallazgo alto" : `los ${a.conteos.alta} hallazgos altos`}; son los que más pesan en la nota.`;
  if (tareasEsperando > 0) return `Hay ${tareasEsperando} tarea${tareasEsperando === 1 ? "" : "s"} esperando: aprobalas o descartalas, o dejá que el ejecutor las tome.`;
  if (a.conteos.media > 0) return `Sin altos. Quedan ${a.conteos.media} hallazgo${a.conteos.media === 1 ? "" : "s"} medio${a.conteos.media === 1 ? "" : "s"}: pedí “Armar plan” para convertirlos en tareas.`;
  return "Sin hallazgos importantes. No hace falta hacer nada.";
}

export const SEV_LABEL: Record<string, string> = { alta: "Alta", media: "Media", baja: "Baja", info: "Info" };

// ───────── Los 7 pilares de la fábrica, con el dato vivo que los respalda ─────────
export type TonoPilar = "ok" | "warn" | "mal" | "neutro";
export interface Pilar {
  n: number;
  clave: string;
  nombre: string;
  lema: string;
  valor: string;
  unidad: string;
  detalle: string;
  tono: TonoPilar;
}

export interface Privacidad {
  dias: number;
  total: number;
  enmascaradas: number;
  locales: number;
  expuestas: number;
}
/** Lee la medición de privacidad publicada por la PC; null si no existe o no se pudo leer el log. */
export function leerPrivacidad(valor: unknown): Privacidad | null {
  const o = obj(valor);
  if (o.leido !== true) return null;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
  return { dias: n(o.dias) || 7, total: n(o.total), enmascaradas: n(o.enmascaradas), locales: n(o.locales), expuestas: n(o.expuestas) };
}

export function calcularPilares(
  proyectos: ResumenProyecto[],
  ejecutor: EstadoEjecutor,
  cuotas: CuotaRuta[],
  auditorias: Auditoria[],
  paraMirar: number,
  ahoraMs: number,
  privacidad: Privacidad | null = null,
): Pilar[] {
  const ejs = ejecutor.proyectos;
  const activos = ejs.filter((e) => e.habilitado && !e.pausado).length;
  const pausados = ejs.filter((e) => e.pausado).length;
  const hechas = ejs.reduce((s, e) => s + e.hechasHoy, 0);
  const conCupo = cuotas.filter((c) => !(c.hasta && Date.parse(c.hasta) > ahoraMs)).length;
  const delta = auditorias.reduce((s, a) => s + (a.tendencia.delta ?? 0), 0);
  const nuevos = auditorias.reduce((s, a) => s + a.tendencia.nuevos, 0);
  const resueltos = auditorias.reduce((s, a) => s + a.tendencia.resueltos, 0);
  const altas = auditorias.reduce((s, a) => s + a.conteos.alta, 0);
  const p3 = proyectos.filter((p) => p.sensibilidad === "P3").length;
  const ordenConDato = auditorias.filter((a) => a.orden !== null);
  const ordenTotal = ordenConDato.reduce((n, a) => n + (a.orden ?? 0), 0);
  const s = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios);
  return [
    {
      n: 1, clave: "autonomia", nombre: "Autonomía", lema: "Automática y reversible",
      valor: `${activos}/${ejs.length}`, unidad: s(activos, "ejecutor activo", "ejecutores activos"),
      detalle: `${hechas} ${s(hechas, "tarea hecha", "tareas hechas")} hoy. Si algo falla, revierte solo y frena.`,
      tono: pausados > 0 ? "warn" : activos > 0 ? "ok" : "neutro",
    },
    {
      n: 2, clave: "eficiencia", nombre: "Eficiencia", lema: "Costo cero",
      valor: cuotas.length ? `${conCupo}/${cuotas.length}` : "—", unidad: "rutas con cupo",
      detalle: "Primero rutas gratuitas; lo pago nunca es el camino por defecto.",
      tono: cuotas.length === 0 ? "neutro" : conCupo === 0 ? "mal" : conCupo < cuotas.length ? "warn" : "ok",
    },
    {
      n: 3, clave: "mejora", nombre: "Mejora continua", lema: "Medir antes de decidir",
      valor: auditorias.length ? `${delta > 0 ? "+" : ""}${delta}` : "—", unidad: "puntos vs. auditoría anterior",
      detalle: `${nuevos} ${s(nuevos, "hallazgo nuevo", "hallazgos nuevos")} · ${resueltos} ${s(resueltos, "resuelto", "resueltos")}. Se decide con datos, no con opiniones.`,
      tono: !auditorias.length ? "neutro" : delta < 0 ? "warn" : "ok",
    },
    {
      n: 4, clave: "cinco-s", nombre: "Metodología 5S", lema: "Orden y limpieza",
      valor: ordenConDato.length ? String(ordenTotal) : "—", unidad: ordenConDato.length ? s(ordenTotal, "hallazgo de orden abierto", "hallazgos de orden abiertos") : "esperando datos de la PC",
      detalle: "Cuenta respaldos .bak y scripts sueltos en la raíz de cada proyecto, según la última auditoría.",
      tono: !ordenConDato.length ? "neutro" : ordenTotal > 0 ? "warn" : "ok",
    },
    {
      n: 5, clave: "privacidad", nombre: "Privacidad P3", lema: "Datos enmascarados",
      valor: privacidad ? (privacidad.total === 0 ? "0" : `${privacidad.total - privacidad.expuestas}/${privacidad.total}`) : "—",
      unidad: privacidad ? (privacidad.total === 0 ? `consultas P3 en ${privacidad.dias} días` : `consultas P3 protegidas (${privacidad.dias} días)`) : "esperando datos de la PC",
      detalle: privacidad
        ? `${privacidad.enmascaradas} salieron enmascaradas · ${privacidad.locales} se quedaron en la PC · ${privacidad.expuestas} sin protección. ${p3} ${s(p3, "proyecto sensible", "proyectos sensibles")}.`
        : `${p3} ${s(p3, "proyecto con datos sensibles", "proyectos con datos sensibles")}. Lo sensible se queda en la PC o sale enmascarado.`,
      tono: !privacidad ? "neutro" : privacidad.expuestas > 0 ? "mal" : "ok",
    },
    {
      n: 6, clave: "experiencia", nombre: "Experiencia", lema: "Simple e intuitiva",
      valor: paraMirar === 0 ? "Todo en orden" : String(paraMirar), unidad: paraMirar === 0 ? "nada para mirar" : s(paraMirar, "cosa para mirar", "cosas para mirar"),
      detalle: "Cada acción en un paso, con confirmación clara antes de actuar.",
      tono: paraMirar === 0 ? "ok" : "warn",
    },
    {
      n: 7, clave: "calidad", nombre: "Calidad", lema: "Lo crítico, auditado solo",
      valor: auditorias.length ? String(altas) : "—", unidad: s(altas, "hallazgo alto abierto", "hallazgos altos abiertos"),
      detalle: "La fábrica detecta sola el código sensible y lo audita cada día.",
      tono: !auditorias.length ? "neutro" : altas > 0 ? "mal" : "ok",
    },
  ];
}

/** Promedio de las notas disponibles (0–100) y su grado; null si ningún proyecto tiene nota. */
export function saludGeneral(proyectos: ResumenProyecto[]): { nota: number; grado: string } | null {
  const notas = proyectos.map((p) => p.nota).filter((n): n is number => typeof n === "number");
  if (!notas.length) return null;
  const nota = Math.round(notas.reduce((a, b) => a + b, 0) / notas.length);
  return { nota, grado: nota >= 90 ? "A" : nota >= 75 ? "B" : nota >= 60 ? "C" : "D" };
}
