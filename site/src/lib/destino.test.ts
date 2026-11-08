import { describe, expect, it } from "vitest";
import { destinoSeguro } from "./destino";

describe("destinoSeguro", () => {
  const B = "/miropa/";
  it("acepta rutas internas simples", () => {
    expect(destinoSeguro("fabrica/", B)).toBe("/miropa/fabrica/");
    expect(destinoSeguro("prenda/nueva/", B)).toBe("/miropa/prenda/nueva/");
  });
  it("rechaza URLs externas, protocolos, dobles barras y vacíos", () => {
    for (const x of ["https://malo.com", "//malo.com", "/\\malo.com", "javascript:alert(1)", "a//b", "../x", "", null, undefined, "x".repeat(80)]) {
      expect(destinoSeguro(x as string, B)).toBe(B);
    }
  });
});
