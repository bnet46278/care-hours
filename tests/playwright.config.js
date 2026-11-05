// Playwright settings for the Care Hours tests.
const { defineConfig, devices } = require("@playwright/test");

// The app works in local time. Run everything on New York time so results are the same on any computer.
process.env.TZ = "America/New_York";

module.exports = defineConfig({
  testDir: ".",
  testMatch: ["specs/**/*.spec.js", "unit/**/*.spec.js"],
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"], ["html", { open: "on-failure" }]],
  use: {
    baseURL: "http://localhost:4173",
    timezoneId: "America/New_York",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    // Default: Chrome's engine at a phone-sized window.
    { name: "chromium", use: { browserName: "chromium", viewport: { width: 390, height: 844 } } },
    // Safari's engine with an iPhone screen, closest to how caregivers use it. Run with: npm run test:iphone
    { name: "iphone", use: { ...devices["iPhone 13"] } },
  ],
  webServer: {
    command: "node serve.js",
    url: "http://localhost:4173/index.html",
    reuseExistingServer: !process.env.CI,
    cwd: __dirname,
  },
});
