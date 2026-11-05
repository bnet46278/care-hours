// Shared setup for the Care Hours tests.
//
//   db       a fresh fake online database for each test (see fake-db.js)
//   openApp  opens Care Hours in its own browser window, like a separate phone.
//            Options: sync (online sync on, default true), slowDb (ms each database call takes), serviceWorkers.
//            Windows opened in the same test share one database, so a caregiver and a payer can interact.
//
// Every window starts on Wednesday, Nov 4, 2026, 8:00 PM New York time, and the clock stays there,
// so "this week" is always Mon Nov 2 - Sun Nov 8.
const path = require("path");
const fs = require("fs");
const { test: base, expect } = require("@playwright/test");
const { FakeDb } = require("./fake-db");

const NOW = new Date("2026-11-04T20:00:00-05:00");
const FAKE_CLIENT = fs.readFileSync(path.join(__dirname, "supabase-fake-client.js"), "utf8");
const SYNC_ON = 'window.CARE_HOURS_CONFIG = { supabaseUrl: "https://fake-project.supabase.co", supabaseAnonKey: "sb_publishable_test" };';
const SYNC_OFF = 'window.CARE_HOURS_CONFIG = { supabaseUrl: "", supabaseAnonKey: "" };';

const test = base.extend({
  db: async ({}, use) => { await use(new FakeDb()); },

  openApp: async ({ browser, db }, use, testInfo) => {
    const windows = [];
    const errors = [];
    async function openApp({ sync = true, serviceWorkers = "block", slowDb = 0 } = {}) {
      const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = testInfo.project.use;
      const context = await browser.newContext({
        baseURL: "http://localhost:4173", timezoneId: "America/New_York", acceptDownloads: true, serviceWorkers,
        viewport, userAgent, deviceScaleFactor, isMobile, hasTouch,
      });
      await context.clock.setFixedTime(NOW);
      const state = { offline: false, inflight: 0 };
      // Never reach the real Supabase project, whatever config.js says.
      await context.route(/supabase\.co/, r => r.abort());
      await context.route("**/config.js", r => r.fulfill({ contentType: "text/javascript", body: sync ? SYNC_ON : SYNC_OFF }));
      await context.route("https://cdn.jsdelivr.net/npm/@supabase/**", r => r.fulfill({ contentType: "text/javascript", body: FAKE_CLIENT }));
      await context.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
      await context.route("https://fake-supabase.test/q", async r => {
        if (state.offline) return r.abort("internetdisconnected");
        state.inflight++;
        try {
          if (slowDb) await new Promise(ok => setTimeout(ok, slowDb));   // a slow connection
          const res = db.handle(JSON.parse(r.request().postData()));
          await r.fulfill({ contentType: "application/json", body: JSON.stringify(res) });
        } finally { state.inflight--; }
      });
      const page = await context.newPage();
      page.on("pageerror", e => errors.push(String(e)));
      await page.goto("/");
      const app = new CareHours(page, state);
      windows.push(context);
      return app;
    }
    await use(openApp);
    for (const c of windows) await c.close();
    expect(errors, "the app should not throw errors").toEqual([]);
  },
});

// Actions and lookups on one Care Hours window, so tests read like the steps a person takes.
class CareHours {
  constructor(page, state) { this.page = page; this.state = state; }
  $(sel) { return this.page.locator(sel); }

  // ---------- signing in and syncing ----------
  async signIn(email, code = "123456") {
    await this.$("#siEmail").fill(email);
    await this.$("#emailForm button").click();
    await this.$("#siCode").fill(code);
    await this.$("#codeForm button").click();
    if (code === "123456") await expect(this.$("#sync")).toContainText(/Signed in as|Your account/);
  }
  async setName(name) {
    await this.$("#dispName").fill(name);
    await this.$("#nameForm button").click();
    await expect(this.$("#nameForm")).toContainText("Name saved.");
  }
  // Wait until the app has stopped talking to the database (no calls for a moment).
  async settle() {
    let quiet = 0;
    for (let i = 0; i < 200 && quiet < 3; i++) {
      await this.page.waitForTimeout(150);
      quiet = this.state.inflight === 0 ? quiet + 1 : 0;
    }
  }
  async waitSynced() { await expect(this.$("#syncState")).toContainText("All shifts saved online"); }
  async goOffline() { this.state.offline = true; }
  async goOnline() { this.state.offline = false; await this.page.evaluate(() => window.dispatchEvent(new Event("online"))); }
  async reload() { await this.page.reload(); }

  // ---------- tabs and week ----------
  async tab(name) { await this.page.getByRole("tab", { name }).click(); }
  weekTotal() { return this.$("#weekTotal"); }
  shiftRows() { return this.$("#list .shift"); }

  // ---------- logging shifts ----------
  async clockIn(patient) {
    if (patient !== undefined) await this.$("#personIn").fill(patient);
    await this.$("#clockBtn").click();
  }
  async clockOut() { await this.$("#clockBtn").click(); }
  async addShift({ date, start, end, patient, note = "" }) {
    await this.$("#addBtn").click();
    await this.$("#fDate").fill(date);
    await this.$("#fStart").fill(start);
    await this.$("#fEnd").fill(end);
    await this.$("#fPerson").fill(patient ?? "");
    await this.$("#fNote").fill(note);
    await this.$("#shiftForm button[type=submit]").click();
  }

  // ---------- sharing ----------
  async share(patient, email) {
    await this.$("#sharePerson").fill(patient);
    await this.$("#shareEmail").fill(email);
    await this.$("#shareForm button[type=submit]").click();
    // Wait for the app's answer, so the share is saved before the next step (or the error is showing).
    await expect(this.$("#shareForm .ok-msg, #shareForm .err").filter({ hasText: /\S/ })).toHaveCount(1);
  }

  // ---------- schedule ----------
  async addToSchedule(kind, f) {
    await this.$(`[data-new=${kind}]`).click();
    if (f.patient !== undefined) await this.$("#pPerson").fill(f.patient);
    for (const d of f.days || []) await this.$(`#pDay${d}`).check();
    if (f.from) await this.$("#pFrom").fill(f.from);
    if (f.until) await this.$("#pUntil").fill(f.until);
    if (f.allDay === false) await this.$("#pAllDay").uncheck();
    if (f.start) await this.$("#pStart").fill(f.start);
    if (f.end) await this.$("#pEnd").fill(f.end);
    if (f.note) await this.$("#pNote").fill(f.note);
    await this.$("#planFormEl button[type=submit]").click();
  }

  // ---------- downloads ----------
  async downloadCsv() {
    const [dl] = await Promise.all([this.page.waitForEvent("download"), this.$("#csvBtn").click()]);
    const file = await dl.path();
    return { name: dl.suggestedFilename(), text: fs.readFileSync(file, "utf8") };
  }
}

// Weekday numbers used by the schedule form: 0 = Sunday ... 6 = Saturday.
const DAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

module.exports = { test, expect, NOW, DAYS };
