import { describe, expect, it } from "vitest";
import {
  UMBRAL_LATIDO_MS,
  antiguedadTexto,
  estadoVisible,
  leerCuotas,
  leerEjecutor,
  leerResumen,
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
      { id: "a", nombre: "a", nota: 90, pendientes: 2 },
    ]);
  });
  it("cuotas y porcentaje", () => {
    const c = leerCuotas({ rutas: [{ ruta: "x", usado: 25, limite: 100 }, { ruta: "y" }, {}] });
    expect(c).toHaveLength(2);
    expect(porcentajeCuota(c[0])).toBe(25);
    expect(porcentajeCuota(c[1])).toBeNull();
    expect(porcentajeCuota({ ruta: "z", usado: 300, limite: 100 })).toBe(100);
  });
  it("ejecutor: valores por defecto seguros", () => {
    expect(leerEjecutor(undefined)).toEqual({ activo: false, pausadoProyectos: [], ultima: null });
    expect(leerEjecutor({ activo: true, ultima: { proyecto: "p", resultado: "done", cuando: "t" } }).ultima?.proyecto).toBe("p");
  });
});
