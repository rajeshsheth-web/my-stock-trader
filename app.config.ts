import { defineConfig } from "@tanstack/start/config";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-vite-plugin";

export default defineConfig({
  server: {
    preset: "cloudflare-workers",
  },
  vite: {
    plugins: [
      tailwindcss(),
      TanStackRouterVite({
        routesDirectory: "./src/routes",
        generatedRouteTree: "./src/routeTree.gen.ts",
      }),
    ],
    resolve: {
      alias: {
        "@": "/src",
      },
    },
  },
});
