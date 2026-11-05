// The app keeps working with no internet connection, once it has been opened once.
const { test, expect } = require("../support/fixtures");

test("opens and records shifts with no connection", async ({ openApp, browserName }) => {
  test.skip(browserName !== "chromium", "Offline caching is checked in Chrome's engine");
  const app = await openApp({ sync: false, serviceWorkers: "allow" });
  await app.page.evaluate(() => navigator.serviceWorker.ready);
  // Every file the app needs is saved for offline use.
  const cached = await app.page.evaluate(async () => {
    const keys = await caches.keys();
    const c = await caches.open(keys.find(k => k.startsWith("care-hours-")));
    return (await c.keys()).map(r => new URL(r.url).pathname).sort();
  });
  for (const f of ["/", "/index.html", "/styles.css", "/config.js", "/js/app.js", "/js/schedule.js", "/js/storage.js"]) expect(cached).toContain(f);

  await app.page.context().setOffline(true);
  await app.reload();
  await expect(app.page).toHaveTitle("Care Hours");
  await app.clockIn("Mom");
  await expect(app.$("#clock .status")).toHaveText("On the clock · Mom");
});
