import { defineConfig } from "@playwright/test";

/**
 * Browser tests (npm run test:e2e). They drive the installed Microsoft Edge, so no browser
 * download is needed on Windows; set E2E_CHANNEL=chrome to use Chrome instead.
 * The dev server is started automatically unless one is already running on the port.
 */
const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: process.env.E2E_CHANNEL ?? "msedge",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
  ],
  webServer: {
    command: `npm run dev -- -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
