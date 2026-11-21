import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // Several engines at once (WebKit included) crash pages when too many run in parallel.
  workers: process.env.CI ? 2 : 4,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL: "http://localhost:5181", trace: "retain-on-failure" },
  projects: [
    // Behaviour of the playground: Chromium is enough.
    { name: "chromium", testMatch: /playground\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
    // Layout in both themes and languages, on a desktop and two phones (one of them WebKit, like Safari).
    { name: "desktop", testMatch: /layout\.spec\.ts/, use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "iphone-13", testMatch: /layout\.spec\.ts/, use: { ...devices["iPhone 13"] } },
    { name: "pixel-7", testMatch: /layout\.spec\.ts/, use: { ...devices["Pixel 7"] } },
  ],
  // The production build, so the specs check what Netlify serves.
  webServer: { command: "npm run build && npx vite preview --port 5181 --strictPort", url: "http://localhost:5181", reuseExistingServer: false },
});
