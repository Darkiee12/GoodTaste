import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import reylo from "reylo/vite";
import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";
export default defineConfig({
  server: {
    port: 3000,
  },
  plugins: [
    reylo(),
    tsConfigPaths(),
    tanstackStart({ importProtection: { behavior: "error" } }),
    nitro({ preset: process.env.NITRO_PRESET ?? "bun" }),
    viteReact(),
    tailwindcss(),
  ],
});
