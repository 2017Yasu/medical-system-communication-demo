import { defineConfig } from "@playwright/test";

// Docker で起動したアプリ（docker compose up）に対して実行する
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.DEMO_URL ?? "http://localhost:8080",
    viewport: { width: 1920, height: 1080 },
  },
});
