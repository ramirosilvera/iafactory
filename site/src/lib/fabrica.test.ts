import { describe, expect, it } from "vitest";
import {
  ACCION_LABEL,
  leerAuditoria,
  proximoPaso,
  accionEjecutor,
  calcularAtencion,
  esErrorDePermiso,
  fechaCorta,
  nombreDe,
  resultadoTexto,
  UMBRAL_LATIDO_MS,
  antiguedadTexto,
  estadoVisible,
  leerCola,
  leerCuotas,
  leerEjecutor,
  leerPc,
  leerResumen,
  nuevaOrden,
  textoConfirmacion,
  modoConexion,
  porcentajeCuota,
  vigenciaHasta,
} from "./fabrica";

const AHORA = Date.parse("2026-11-06T20:00:00Z");
const hace = (ms: number) => new Date(AHORA - ms).toISOString();

describe("modoConexion", () => {
  it("sin latido → sin_datos", () => {
    expect(modoConexion(null, AHORA)).toBe("sin_datos");
    expect(modoConexion(undefined, AHORA)).toBe("sin_datos");
  });
  it("latido reciente → vivo; pasado el umbral → apagada", () => {
    expect(modoConexion({ visto_at: hace(30_000) }, AHORA)).toBe("vivo");
    expect(modoConexion({ visto_at: hace(UMBRAL_LATIDO_MS) }, AHORA)).toBe("vivo");
    expect(modoConexion({ visto_at: hace(UMBRAL_LATIDO_MS + 1000) }, AHORA)).toBe("apagada");
    expect(modoConexion({ visto_at: hace(5 * 3_600_000) }, AHORA)).toBe("apagada");
  });
  it("fecha inválida o reloj de la PC muy adelantado no cuentan como vivo", () => {
    expect(modoConexion({ visto_at: "no-es-fecha" }, AHORA)).toBe("sin_datos");
    expect(modoConexion({ visto_at: hace(-3_600_000) }, AHORA)).toBe("sin_datos");
  });
});

describe("antiguedadTexto", () => {
  it("formatea en instantes / min / h / días", () => {
    expect(antiguedadTexto(hace(10_000), AHORA)).toBe("hace instantes");
    expect(antiguedadTexto(hace(5 * 60_000), AHORA)).toBe("hace 5 min");
    expect(antiguedadTexto(hace(3 * 3_600_000), AHORA)).toBe("hace 3 h");
    expect(antiguedadTexto(hace(72 * 3_600_000), AHORA)).toBe("hace 3 días");
    expect(antiguedadTexto(null, AHORA)).toBe("sin datos");
  });
});

describe("órdenes", () => {
  it("pausar es urgente (15 min) y encolar dura un día", () => {
    expect(Date.parse(vigenciaHasta("pausar_ejecutor", AHORA)) - AHORA).toBe(15 * 60_000);
    expect(Date.parse(vigenciaHasta("encolar", AHORA)) - AHORA).toBe(24 * 3_600_000);
  });
  it("una pendiente con vigencia pasada se ve vencida; las demás no cambian", () => {
    expect(estadoVisible({ estado: "pendiente", vigencia_hasta: hace(1000) }, AHORA)).toBe("vencida");
    expect(estadoVisible({ estado: "pendiente", vigencia_hasta: new Date(AHORA + 1000).toISOString() }, AHORA)).toBe("pendiente");
    expect(estadoVisible({ estado: "hecha", vigencia_hasta: hace(1000) }, AHORA)).toBe("hecha");
  });
});

describe("lectura tolerante de lo que publica la PC", () => {
  it("resumen: ignora basura y completa faltantes", () => {
    expect(leerResumen(null)).toEqual([]);
    expect(leerResumen({ proyectos: [{ id: "a", nota: 90, pendientes: 2 }, { nombre: "sin id" }, 5] })).toEqual([
      { id: "a", nombre: "a", nota: 90, grado: null, pendientes: 2, sensibilidad: null },
    ]);
  });
  it("cuotas y porcentaje", () => {
    const c = leerCuotas({ rutas: [{ ruta: "x", usado: 25, limite: 100 }, { ruta: "y" }, {}] });
    expect(c).toHaveLength(2);
    expect(porcentajeCuota(c[0])).toBe(25);
    expect(porcentajeCuota(c[1])).toBeNull();
    expect(porcentajeCuota({ ruta: "z", usado: 300, limite: 100, hasta: null })).toBe(100);
  });
  it("ejecutor: valores por defecto seguros", () => {
    expect(leerEjecutor(undefined)).toEqual({ activo: false, pausadoProyectos: [], proyectos: [], ultima: null });
    expect(leerEjecutor({ activo: true, ultima: { proyecto: "p", resultado: "done", cuando: "t" } }).ultima?.proyecto).toBe("p");
  });
});

describe("órdenes nuevas", () => {
  const EMAIL = "a@b.c";
  it("arma la fila con vigencia según la acción", () => {
    const r = nuevaOrden("pausar_ejecutor", { id: "ia-factory" }, AHORA, EMAIL);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.orden.params).toEqual({ id: "ia-factory" });
      expect(Date.parse(r.orden.vigencia_hasta) - AHORA).toBe(15 * 60_000);
      expect(r.orden.creada_por).toBe(EMAIL);
    }
  });
  it("rechaza proyecto, tarea o acción inválidos", () => {
    expect(nuevaOrden("pausar_ejecutor", { id: "../x" }, AHORA, EMAIL).ok).toBe(false);
    expect(nuevaOrden("aprobar_item", { id: "p" }, AHORA, EMAIL).ok).toBe(false);
    expect(nuevaOrden("aprobar_item", { id: "p", itemId: "zz; drop" }, AHORA, EMAIL).ok).toBe(false);
    expect(nuevaOrden("borrar" as never, { id: "p" }, AHORA, EMAIL).ok).toBe(false);
  });
  it("aprobar lleva el itemId; reanudar exige confirmación y la incluye", () => {
    const a = nuevaOrden("aprobar_item", { id: "p", itemId: "0e44896f" }, AHORA, null);
    expect(a.ok && a.orden.params).toEqual({ id: "p", itemId: "0e44896f" });
    expect(nuevaOrden("reanudar_ejecutor", { id: "p" }, AHORA, null).ok).toBe(false);
    const r = nuevaOrden("reanudar_ejecutor", { id: "p", confirmado: true }, AHORA, null);
    expect(r.ok && r.orden.params).toEqual({ id: "p", confirmado: true });
  });
  it("todas las acciones tienen texto y la confirmación avisa si la PC no está", () => {
    for (const k of Object.keys(ACCION_LABEL)) expect(ACCION_LABEL[k as keyof typeof ACCION_LABEL].length).toBeGreaterThan(3);
    expect(textoConfirmacion("pausar_ejecutor", "X", "vivo", null)).toMatch(/en segundos/);
    expect(textoConfirmacion("pausar_ejecutor", "X", "apagada", null)).toMatch(/queda en cola/);
    expect(textoConfirmacion("reanudar_ejecutor", "X", "vivo", "P3")).toMatch(/sensibles/);
  });
});

describe("lectura de cola y estado de la PC", () => {
  it("cola: descarta ids raros", () => {
    expect(leerCola({ items: [{ id: "0e44896f", titulo: "t", sev: "alta", cat: "x" }, { id: "../x" }, null] })).toHaveLength(1);
    expect(leerCola(undefined)).toEqual([]);
  });
  it("pc: tablero apagado por defecto, órdenes habilitadas salvo que diga que no", () => {
    expect(leerPc(undefined)).toEqual({ tablero: false, ordenes: true });
    expect(leerPc({ tablero: true, ordenes: false })).toEqual({ tablero: true, ordenes: false });
  });
});

describe("presentación", () => {
  const P = [{ id: "a", nombre: "Proyecto A" }];
  it("traduce resultados del ejecutor y no inventa los desconocidos", () => {
    expect(resultadoTexto("done")).toBe("corrigió");
    expect(resultadoTexto("needs-human")).toMatch(/persona/);
    expect(resultadoTexto("raro")).toBe("raro");
    expect(resultadoTexto("")).toBe("sin dato");
  });
  it("nombre de proyecto o el id si no se conoce", () => {
    expect(nombreDe(P, "a")).toBe("Proyecto A");
    expect(nombreDe(P, "zz")).toBe("zz");
  });
  it("fecha corta tolera basura", () => {
    expect(fechaCorta("no-fecha")).toBe("fecha desconocida");
    expect(fechaCorta("2026-11-09T14:20:00Z")).toMatch(/9/);
  });
  it("atención: pausado, persona, sin cupo y error de las últimas 24 h", () => {
    const ej = leerEjecutor({ proyectos: [{ id: "a", habilitado: true, pausado: "3 fallos", necesitaPersona: 2 }] });
    const cuotas = [{ ruta: "x", usado: null, limite: null, hasta: new Date(AHORA + 3600_000).toISOString() }, { ruta: "y", usado: 1, limite: null, hasta: new Date(AHORA - 1000).toISOString() }];
    const ev = [{ nivel: "error", ts: new Date(AHORA - 3600_000).toISOString(), proyecto: null, titulo: "Se cayó" }, { nivel: "error", ts: new Date(AHORA - 3 * 86_400_000).toISOString(), proyecto: null, titulo: "viejo" }];
    const a = calcularAtencion(P, ej, cuotas, ev, AHORA);
    expect(a.map((x) => x.tipo)).toEqual(["pausado", "persona", "sin_cupo", "error"]);
    expect(a[0].texto).toMatch(/Proyecto A/);
    expect(calcularAtencion(P, leerEjecutor(undefined), [], [], AHORA)).toEqual([]);
  });
  it("botón del ejecutor según el estado real", () => {
    expect(accionEjecutor({ id: "a", habilitado: true, pausado: null, esperando: 0, hechasHoy: 0, necesitaPersona: 0, sensibilidad: null }).label).toBe("Pausar ejecutor");
    expect(accionEjecutor({ id: "a", habilitado: true, pausado: "x", esperando: 0, hechasHoy: 0, necesitaPersona: 0, sensibilidad: null }).label).toBe("Reanudar ejecutor");
    expect(accionEjecutor({ id: "a", habilitado: false, pausado: null, esperando: 0, hechasHoy: 0, necesitaPersona: 0, sensibilidad: null }).label).toBe("Encender ejecutor");
    expect(accionEjecutor(undefined).accion).toBe("reanudar_ejecutor");
  });
  it("distingue error de permisos de otros", () => {
    expect(esErrorDePermiso("permission denied for schema factory")).toBe(true);
    expect(esErrorDePermiso("Failed to fetch")).toBe(false);
  });
});

describe("auditoría legible", () => {
  const A = { cuando: "2026-11-08T01:20:55Z", nota: 88, grado: "B", conteos: { alta: 0, media: 3, baja: 0, info: 4 }, tendencia: { delta: 0, nuevos: 0, resueltos: 0 }, total: 7, hallazgos: [{ id: "a", sev: "media", cat: "x", titulo: "t", sugerencia: "s", nuevo: true }, { id: "b", sev: "rara", titulo: "no" }] };
  it("lee, filtra severidades raras y tolera basura", () => {
    const a = leerAuditoria(A)!;
    expect(a.nota).toBe(88);
    expect(a.hallazgos.map((h) => h.id)).toEqual(["a"]);
    expect(a.hallazgos[0].nuevo).toBe(true);
    expect(leerAuditoria(null)).toBeNull();
    expect(leerAuditoria({ nota: 5 })).toBeNull();
    expect(leerAuditoria({ cuando: "x", conteos: "mal", hallazgos: 7 })!.hallazgos).toEqual([]);
  });
  it("próximo paso: prioriza persona > altos > tareas > medios > nada", () => {
    const a = leerAuditoria(A)!;
    expect(proximoPaso(null, 0, 0)).toMatch(/Auditar ahora/);
    expect(proximoPaso(a, 2, 1)).toMatch(/necesita a una persona|necesitan a una persona|necesita/);
    expect(proximoPaso({ ...a, conteos: { ...a.conteos, alta: 2 } }, 5, 0)).toMatch(/2 hallazgos altos/);
    expect(proximoPaso(a, 2, 0)).toMatch(/2 tareas esperando/);
    expect(proximoPaso(a, 0, 0)).toMatch(/Armar plan/);
    expect(proximoPaso({ ...a, conteos: { alta: 0, media: 0, baja: 0, info: 4 } }, 0, 0)).toMatch(/No hace falta/);
  });
});

import { calcularPilares, leerPrivacidad, saludGeneral } from "./fabrica";
describe("pilares", () => {
  const ej = { activo: true, pausadoProyectos: [], ultima: null, proyectos: [
    { id: "a", habilitado: true, pausado: null, esperando: 0, hechasHoy: 2, necesitaPersona: 0, sensibilidad: "P3" },
    { id: "b", habilitado: false, pausado: null, esperando: 0, hechasHoy: 0, necesitaPersona: 0, sensibilidad: null },
  ] } as never;
  const ps = [{ id: "a", nombre: "A", nota: 80, grado: "B", pendientes: 1, sensibilidad: "P3" }, { id: "b", nombre: "B", nota: 60, grado: "C", pendientes: 0, sensibilidad: null }];
  it("devuelve 7 pilares con datos vivos", () => {
    const r = calcularPilares(ps, ej, [{ ruta: "x", usado: 1, limite: null, hasta: null }], [], 0, Date.now());
    expect(r).toHaveLength(7);
    expect(r[0].valor).toBe("1/2");
    expect(r[4].valor).toBe("—");
    expect(r[3].valor).toBe("—");
    expect(r[5].tono).toBe("ok");
    expect(r[6].valor).toBe("—");
  });
  it("salud general promedia notas", () => {
    expect(saludGeneral(ps)).toEqual({ nota: 70, grado: "C" });
    expect(saludGeneral([])).toBeNull();
  });
});

describe("pilares medidos de verdad", () => {
  const base = { cuando: "x", nota: 90, grado: "A", conteos: { alta: 0, media: 0, baja: 0, info: 0 }, tendencia: { delta: 0, nuevos: 0, resueltos: 0 }, total: 0, hallazgos: [] };
  const ej = { activo: false, pausadoProyectos: [], ultima: null, proyectos: [] } as never;
  it("5S cuenta hallazgos de orden y privacidad detecta exposición", () => {
    const priv = leerPrivacidad({ leido: true, dias: 7, total: 4, enmascaradas: 2, locales: 1, expuestas: 1 });
    const r = calcularPilares([], ej, [], [{ ...base, orden: 2 }, { ...base, orden: 0 }], 0, Date.now(), priv);
    expect(r[3].valor).toBe("2");
    expect(r[3].tono).toBe("warn");
    expect(r[4].valor).toBe("3/4");
    expect(r[4].tono).toBe("mal");
  });
  it("sin lectura del log, privacidad queda sin dato", () => {
    expect(leerPrivacidad({ leido: false })).toBeNull();
    expect(leerPrivacidad(undefined)).toBeNull();
  });
});
