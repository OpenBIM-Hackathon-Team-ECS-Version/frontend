import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "ifc-lite-worker-shim",
      resolveId(source) {
        if (source.endsWith("snippets/wasm-bindgen-rayon-38edf6e439f6d70d/src/workerHelpers.js")) {
          return fileURLToPath(new URL("./src/shims/ifcLiteWorkerHelpers.ts", import.meta.url));
        }

        return null;
      },
    },
  ],
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  optimizeDeps: {
    exclude: ["@ifc-lite/geometry", "@ifc-lite/renderer"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
