import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

export default defineConfig({
  resolve: {
    alias: { "@": "/src" },
  },
  plugins: [
    nitro({ preset: "vercel" }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
});
