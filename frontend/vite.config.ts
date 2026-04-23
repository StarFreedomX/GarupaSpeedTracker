// vite.config.ts
import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode, command }) => {
    const env = loadEnv(mode, process.cwd(), "");
    const apiBaseDefault = env.API_BASE_DEFAULT || "/api";

    const backendApiUrl = env.BACKEND_API_URL || "http://127.0.0.1:5519/api";

    if (command === "serve") {
        console.log(`[Vite] Current Mode: ${mode}`);
        console.log(`[Vite] Proxying /api to: ${backendApiUrl}`);
    }

    const runtimeConfigPlugin = command === "serve"
        ? {
            name: "runtime-config-dev-inject",
            apply: "serve" as const,
            transformIndexHtml: {
                order: "pre" as const,
                handler: () => [
                    {
                        tag: "script",
                        attrs: { type: "text/javascript" },
                        children: `window.__GARUPA_RUNTIME_CONFIG__ = Object.assign(window.__GARUPA_RUNTIME_CONFIG__ || {}, ${JSON.stringify({
                            API_BASE_DEFAULT: apiBaseDefault,
                        })});`,
                        injectTo: "head-prepend" as const,
                    },
                ],
            },
        }
        : undefined;

    return {
        plugins: [runtimeConfigPlugin, vue()].filter(Boolean),
        resolve: {
            alias: {
                "@": fileURLToPath(new URL("./src", import.meta.url)),
            },
        },
        server: {
            port: 5913,
            proxy: {
                "/api": {
                    target: backendApiUrl,
                    changeOrigin: true,
                    rewrite: (path) => path.replace(/^\/api/, ""),
                },
            },
        },
    };
});
