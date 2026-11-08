import { defineConfig } from "astro/config";
import react from "@astrojs/react";

// El sitio (tablero de la IA Factory) se sirve desde
// https://<usuario>.github.io/iafactory/ -- el path "/iafactory/" tiene que
// coincidir siempre con el nombre real del repo en GitHub. Si el repo se
// renombra, hay que actualizar `base` acá (y en public/manifest.webmanifest)
// o los assets rompen.
export default defineConfig({
  site: "https://ramirosilvera.github.io",
  base: "/iafactory/",
  integrations: [react()],
});
