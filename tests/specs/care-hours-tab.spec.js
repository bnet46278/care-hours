// The Care Hours tab: shifts worked and the schedule together, with Worked and Schedule boxes on the chart.
const { test, expect, DAYS } = require("../support/fixtures");

async function weekWithBoth(app) {
  await app.addShift({ date: "2026-11-02", start: "09:00", end: "13:00", patient: "Mom" });
  await app.addShift({ date: "2026-11-03", start: "14:00", end: "17:00", patient: "Dad" });
  await app.addToSchedule("weekly", { patient: "Mom", days: [DAYS.mon, DAYS.wed], from: "2026-11-02", start: "09:00", end: "12:00" });
}
const day = (app, i) => app.$("#bars button.day").nth(i);

test.describe("Care Hours tab", () => {
  test("both boxes start on: each day has a worked bar and a scheduled bar", async ({ openApp }) => {
    const app = await openApp({ sync: false });
    await weekWithBoth(app);
    await app.show("both");
    await expect(app.$("#showShifts")).toBeChecked();
    await expect(app.$("#showSched")).toBeChecked();
    await expect(app.$(".showpick")).toHaveText(/Worked\s*Schedule/);
    // Monday: 4h worked (Mom), 3h scheduled (Mom).
    await expect(day(app, 0).locator(".track")).toHaveCount(2);
    await expect(day(app, 0).locator(".track.worked .seg")).toHaveCount(1);
    await expect(day(app, 0).locator(".track.sched .seg")).toHaveCount(1);
    await expect(day(app, 0).locator(".dhrs")).toHaveText("4.03.0");
    await expect(day(app, 0)).toHaveAttribute("aria-label", "Monday, Nov 2, 4h 00m worked, 3h 00m scheduled. Show details");
    // Worked: bold patient color and a green border. Scheduled: the same color, muted, and a gray border.
    const look = await day(app, 0).evaluate(d => {
      const st = el => getComputedStyle(el);
      const w = d.querySelector(".track.worked"), s = d.querySelector(".track.sched");
      return { wEdge: st(w).borderTopColor, sEdge: st(s).borderTopColor,
        wSeg: st(w.querySelector(".seg")).backgroundColor, sSeg: st(s.querySelector(".seg")).backgroundColor };
    });
    expect(look.wEdge).not.toBe(look.sEdge);
    expect(look.wSeg).not.toBe(look.sSeg);
    // The big number is hours worked, with the schedule next to it; all three lists show.
    await expect(app.weekTotal()).toHaveText("7h 00m");
    await expect(app.$("#weekVs")).toHaveText("Scheduled: 6h 00m [6.00]");
    for (const id of ["#clock", "#plan", "#logSection"]) await expect(app.$(id)).toBeVisible();
  });

  test("one box at a time: one bar per day, and its list alone", async ({ openApp }) => {
    const app = await openApp({ sync: false });
    await weekWithBoth(app);
    await app.show("schedule");
    await expect(day(app, 0).locator(".track")).toHaveCount(1);
    await expect(day(app, 0).locator(".track.sched")).toHaveCount(1);
    await expect(app.weekTotal()).toHaveText("6h 00m");
    await expect(app.$("#weekVs")).toHaveText("Worked: 7h 00m [7.00]");
    await expect(app.$("#plan")).toBeVisible();
    await expect(app.$("#logSection")).toBeHidden();

    await app.show("worked");
    await expect(day(app, 0).locator(".track.worked")).toHaveCount(1);
    await expect(day(app, 0).locator(".track.sched")).toHaveCount(0);
    await expect(app.$("#plan")).toBeHidden();
    await expect(app.$("#logSection")).toBeVisible();
    // The day card follows too.
    await day(app, 0).click();
    await expect(app.$("#dayDetail")).toContainText("Worked");
    await expect(app.$("#dayDetail .label")).toHaveText(["Worked"]);
  });

  test("the last box that's on can't be turned off, and the choice is remembered", async ({ openApp }) => {
    const app = await openApp({ sync: false });
    await app.show("worked");
    await app.$("#showShifts").click();
    await expect(app.$("#showShifts")).toBeChecked();
    await expect(app.$("#showSched")).not.toBeChecked();
    await app.reload();
    await expect(app.$("#showShifts")).toBeChecked();
    await expect(app.$("#showSched")).not.toBeChecked();
    await app.show("both");
    await app.reload();
    await expect(app.$("#showSched")).toBeChecked();
  });

  test("payers get the same chart, with the schedule they're shared", async ({ openApp }) => {
    const cynda = await openApp();
    await cynda.signIn("cynda@example.com");
    await weekWithBoth(cynda);
    await cynda.share("Mom", "pat@example.com");
    await cynda.waitSynced();
    const pat = await openApp();
    await pat.signIn("pat@example.com");
    await expect(pat.page.getByRole("tab")).toHaveText(["Care Hours", "Caregivers"]);
    await expect(pat.weekTotal()).toHaveText("4h 00m");
    await expect(day(pat, 0).locator(".track.worked .seg")).toHaveCount(1);
    await expect(day(pat, 0).locator(".track.sched .seg")).toHaveCount(1);
    await expect(pat.$("#planShared")).toBeVisible();
    await expect(pat.$("#logSection")).toBeVisible();
  });
});
