/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backend = process.env.DEMO_BACKEND ?? "http://localhost:8080";
const backendWs = backend.replace(/^http/, "ws");

// 開発時は FHIR サーバー（コンテナ）へプロキシする（research.md R-18、V-08）
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/fhir": backend,
      "/demo": backend,
      "/ws": { target: backendWs, ws: true },
    },
  },
  test: {
    environment: "jsdom",
    include: ["tests/unit/**/*.test.{ts,tsx}"],
  },
});
