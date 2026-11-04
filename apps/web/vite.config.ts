import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import type { Plugin } from "vite";

import { prerender } from "./scripts/prerender";

/** After the build: per-page HTML for the public site and sitemap.xml (scripts/prerender.ts). */
const prerenderPublic = (): Plugin => ({
  name: "prerender-public",
  apply: "build",
  closeBundle: { order: "post", handler: () => prerender(fileURLToPath(new URL(".", import.meta.url))) },
});

export default defineConfig({
  server: { port: 3001 },
  resolve: { tsconfigPaths: true },
  plugins: [tailwindcss(), tanstackRouter({ target: "react", autoCodeSplitting: true }), react(), prerenderPublic()],
});
