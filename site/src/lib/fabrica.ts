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
