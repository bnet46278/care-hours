// Collapsible cards, the Week / 2 weeks / Month switch, and where things sit on the page.
const { test, expect, DAYS } = require("../support/fixtures");

test.describe("Shifts and Schedule cards", () => {
  test("start collapsed, open with a tap, and stay open after reloading", async ({ openApp }) => {
    const app = await openApp({ sync: false, cardsOpen: false });
    await app.addShift({ date: "2026-11-02", start: "09:00", end: "12:00", patient: "Mom" });   // adding works while collapsed
    await expect(app.$("#list")).toBeHidden();
    await expect(app.$("#listToggle")).toHaveAttribute("aria-expanded", "false");
    await expect(app.$("#addBtn")).toBeVisible();
    await expect(app.$("#csvBtn")).toBeVisible();

    await app.$("#listToggle").click();
    await expect(app.$("#list")).toBeVisible();
    await expect(app.shiftRows()).toHaveCount(1);
    await app.reload();
    await expect(app.$("#list")).toBeVisible();

    await app.tab("Schedule");
    await expect(app.$("#planList")).toBeHidden();
    await app.$("#planToggle").click();
    await expect(app.$("#planList")).toBeVisible();
    await app.$("#planToggle").click();
    await expect(app.$("#planList")).toBeHidden();
  });

  test("the payer's schedule card collapses too", async ({ openApp }) => {
    const cynda = await openApp({ cardsOpen: false });
    await cynda.signIn("cynda@example.com");
    await cynda.tab("Schedule");
    await cynda.$("#planToggle").click();
    await cynda.addToSchedule("weekly", { patient: "Mom", days: [DAYS.mon], from: "2026-11-02", start: "09:00", end: "13:00" });
    await cynda.share("Mom", "payer@example.com");
    await cynda.waitSynced();
    const payer = await openApp({ cardsOpen: false });
    await payer.signIn("payer@example.com");
    await payer.tab("Schedule");
    await expect(payer.$("#planSharedList")).toBeHidden();
    await payer.$("#planSharedToggle").click();
    await expect(payer.$("#planSharedList")).toContainText("Mom · by");
  });
});

test.describe("Week / 2 weeks / Month", () => {
  async function spreadOut(app) {
    await app.addShift({ date: "2026-10-27", start: "09:00", end: "12:00", patient: "Dad" });   // last week
    await app.addShift({ date: "2026-11-02", start: "09:00", end: "11:00", patient: "Mom" });   // this week
    await app.addShift({ date: "2026-11-01", start: "10:00", end: "11:00", patient: "Mom" });   // Sun Nov 1: last week, this month
  }

  test("Week is the default and works as before", async ({ openApp }) => {
    const app = await openApp({ sync: false });
    await spreadOut(app);
    await app.$("#thisWeek").click();   // adding a shift jumps to that shift's week
    await expect(app.$('#rangePick [data-range="week"]')).toHaveAttribute("aria-pressed", "true");
    await expect(app.$("#weekTitle")).toHaveText("This week");
    await expect(app.weekTotal()).toHaveText("2h 00m");
    await expect(app.$("#bars button.day")).toHaveCount(7);
  });

  test("2 weeks starts on this week and next, and slides one week per tap", async ({ openApp }) => {
    const app = await openApp({ sync: false });
    await spreadOut(app);
    await app.$('[data-range="2weeks"]').click();
    await expect(app.$("#weekTitle")).toHaveText("This week and next");
    await expect(app.$("#weekDecimal")).toContainText("Nov 2–Nov 15");
    await expect(app.$("#bars button.day")).toHaveCount(14);
    await expect(app.weekTotal()).toHaveText("2h 00m");

    await app.$("#prevWeek").click();
    await expect(app.$("#weekTitle")).toHaveText("Last week and this week");
    await expect(app.$("#weekDecimal")).toContainText("Oct 26–Nov 8");
    await expect(app.weekTotal()).toHaveText("6h 00m");
    await expect(app.$("#bycgDates")).toHaveText("Last week and this week · Oct 26 – Nov 8");
    await expect(app.$(".bycg-total")).toContainText("Worked6h 00m [6.00]");
    await expect(app.shiftRows()).toHaveCount(3);

    await app.$("#prevWeek").click();
    await expect(app.$("#weekDecimal")).toContainText("Oct 19–Nov 1");

    const csv = await app.downloadCsv();
    expect(csv.name).toBe("care-hours-2-weeks-of-2026-10-19.csv");
  });

  test("Month shows a calendar for the whole month", async ({ openApp }) => {
    const app = await openApp({ sync: false });
    await spreadOut(app);
    await app.$('[data-range="month"]').click();
    await expect(app.$("#weekTitle")).toHaveText("November 2026");
    await expect(app.$("#bars button.day")).toHaveCount(30);
    await expect(app.$("#bars .dow")).toHaveText(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    await expect(app.$("#bars button.day").first().locator(".dname")).toHaveText("1");   // Nov 1 is a Sunday...
    await expect(app.$("#bars .day.blank")).toHaveCount(6 + 6);                         // ...after six blanks, and the last row is filled out
    await expect(app.weekTotal()).toHaveText("3h 00m");
    await expect(app.$("#bycgDates")).toHaveText("November 2026 · Nov 1 – Nov 30");
    const csv = await app.downloadCsv();
    expect(csv.name).toBe("care-hours-month-2026-11.csv");

    await app.$("#prevWeek").click();
    await expect(app.$("#weekTitle")).toHaveText("October 2026");
    await expect(app.weekTotal()).toHaveText("3h 00m");
  });

  test("the choice is remembered, and the Shifts tab doesn't go past now", async ({ openApp }) => {
    const app = await openApp({ sync: false });
    await app.$('[data-range="month"]').click();
    await expect(app.$("#nextWeek")).toBeHidden();
    await app.reload();
    await expect(app.$('#rangePick [data-range="month"]')).toHaveAttribute("aria-pressed", "true");
    await app.tab("Schedule");
    await expect(app.$("#nextWeek")).toBeVisible();   // the schedule can look ahead
    await app.$("#nextWeek").click();
    await expect(app.$("#weekTitle")).toHaveText("December 2026");
  });

  test("the schedule list and hours box follow the period", async ({ openApp }) => {
    const app = await openApp({ sync: false });
    await app.tab("Schedule");
    await app.addToSchedule("weekly", { patient: "Mom", days: [DAYS.mon], from: "2026-11-02", start: "09:00", end: "13:00" });
    await expect(app.weekTotal()).toHaveText("4h 00m");
    await app.$('[data-range="month"]').click();
    await expect(app.weekTotal()).toHaveText("20h 00m");   // five Mondays: Nov 2, 9, 16, 23, 30
    await expect(app.$("#planList .group")).toHaveCount(5);
    await expect(app.$(".bycg-item")).toContainText("Scheduled20h 00m [20.00]");
  });
});

test.describe("Page layout", () => {
  test("on the payer screen, the caregivers card sits below Your account", async ({ openApp }) => {
    const cynda = await openApp();
    await cynda.signIn("cynda@example.com");
    await cynda.addShift({ date: "2026-11-02", start: "09:00", end: "12:00", patient: "Mom" });
    await cynda.share("Mom", "payer@example.com");
    await cynda.waitSynced();
    const payer = await openApp();
    await payer.signIn("payer@example.com");
    await expect(payer.$("#sharedHead")).toBeVisible();
    const order = await payer.page.evaluate(() => [...document.querySelectorAll("#account, #sharedHead")].map(e => e.id));
    expect(order).toEqual(["account", "sharedHead"]);
  });

  test("the update notice stays hidden until a new version arrives", async ({ openApp }) => {
    const app = await openApp({ sync: false });
    await expect(app.$("#updateBar")).toBeHidden();
  });
});
