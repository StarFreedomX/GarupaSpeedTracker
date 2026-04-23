/** @typedef {import('./src/types/runtime-config').RuntimeAppConfig} RuntimeAppConfig */

const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");

dotenv.config({ path: [".env.local", ".env", ".env.example"] });

const app = express();
const backendApiUrl = process.env.BACKEND_API_URL || "http://localhost:5519/api";
const port = Number.parseInt(process.env.PORT || "5913", 10);
const host = process.env.HOST || "localhost";

const runtimeConfigPath = path.join(__dirname, "dist", "runtime-config.js");
/** @type {RuntimeAppConfig} */
const runtimeConfig = {
    API_BASE_DEFAULT: process.env.API_BASE_DEFAULT ?? "",
    DEFAULT_SERVER: process.env.DEFAULT_SERVER ?? "",
    DEFAULT_EVENT: process.env.DEFAULT_EVENT ?? "",
    DEFAULT_SAMPLE_INTERVAL_SECONDS: process.env.DEFAULT_SAMPLE_INTERVAL_SECONDS ?? "",
    DEFAULT_REQUEST_MODE: process.env.DEFAULT_REQUEST_MODE ?? "",
    DEFAULT_REQUEST_INTERVAL_SECONDS: process.env.DEFAULT_REQUEST_INTERVAL_SECONDS ?? "",
    DEFAULT_AUTO_RETRY_DELAY_SECONDS: process.env.DEFAULT_AUTO_RETRY_DELAY_SECONDS ?? "",
    DEFAULT_REQUEST_MINUTE_INTERVAL: process.env.DEFAULT_REQUEST_MINUTE_INTERVAL ?? "",
    DEFAULT_REQUEST_SECOND: process.env.DEFAULT_REQUEST_SECOND ?? "",
    DEFAULT_TIME_MINUTES: process.env.DEFAULT_TIME_MINUTES ?? "",
    DEFAULT_ROWS_PER_PAGE: process.env.DEFAULT_ROWS_PER_PAGE ?? "",
    DEFAULT_PRIMARY_HUE: process.env.DEFAULT_PRIMARY_HUE ?? "",
    DEFAULT_API_MODE: process.env.DEFAULT_API_MODE ?? "",
    DEFAULT_API_BACKEND_BASE_URL: process.env.DEFAULT_API_BACKEND_BASE_URL ?? "",
    BACKEND_API_URL: process.env.BACKEND_API_URL ?? backendApiUrl,
};

if (Number.isNaN(port)) {
    console.error("port is not a number");
    process.exit(1);
}

fs.mkdirSync(path.dirname(runtimeConfigPath), { recursive: true });
fs.writeFileSync(runtimeConfigPath, `window.__GARUPA_RUNTIME_CONFIG__ = ${JSON.stringify(runtimeConfig, null, 2)};\n`, "utf8");

const apiProxy = createProxyMiddleware({
    target: backendApiUrl,
    changeOrigin: true,
    pathRewrite: (path) => path.replace(/^\/api/, ""),
});
app.use("/api", apiProxy);

app.use(express.static(path.join(__dirname, "dist")));

app.use((_req, res) => {
    res.sendFile(path.join(__dirname, "dist/index.html"));
});
const server = app.listen(port, host, () => {
    console.log(`frontend server listening at: http://${host}:${port}`);
    console.log(`frontend website available at: http://localhost:${port}`);
});
const shutdown = (signal) => {
    console.log(`Received ${signal}, shutting down...`);
    server.close(() => {
        console.log("Server closed.");
        process.exit(0);
    });

    // 强制退出
    setTimeout(() => {
        console.error("Force shutdown after timeout");
        process.exit(1);
    }, 2000);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
