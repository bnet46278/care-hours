// The Schedule tab, and the schedule payers see.
// "Today" in the tests is Wednesday, Nov 4, 2026 at 8:00 PM, so this week is Mon Nov 2 - Sun Nov 8.
const { test, expect, DAYS } = require("../support/fixtures");

async function weekWithTimeOff(app) {
  await app.tab("Schedule");
  await app.addToSchedule("weekly", { patient: "Mom", days: [DAYS.mon, DAYS.wed, DAYS.fri], from: "2026-11-02", start: "09:00", end: "13:00", note: "bring lunch" });
  await app.addToSchedule("once", { patient: "Dad", from: "2026-11-07", start: "08:00", end: "12:00" });
  await app.addToSchedule("once", { patient: "mom", from: "2026-11-04", start: "21:00", end: "22:30" });
  await app.addToSchedule("off", { from: "2026-11-06", until: "2026-11-06" });
}

test.describe("Schedule", () => {
  test("caregivers get Shifts, Schedule and Client/Patient tabs", async ({ openApp }) => {
    const app = await openApp({ sync: false });
    await expect(app.page.getByRole("tab")).toHaveText(["Shifts", "Schedule", "Client/Patient"]);
    await app.tab("Schedule");
    await expect(app.$("#clock")).toBeHidden();
    await expect(app.$("#planList")).toContainText("Nothing scheduled this week.");
  });

  test("the forms explain what's missing", async ({ openApp }) => {
    const app = await openApp({ sync: false });
    await app.tab("Schedule");
    await app.addToSchedule("weekly", { patient: "Mom", from: "2026-11-02", start: "09:00", end: "13:00" });
    await expect(app.$("#pErr")).toHaveText("Pick at least one day of the week.");
    await app.$("#pCancel").click();
    await app.addToSchedule("once", { from: "2026-11-07", start: "08:00", end: "12:00" });
    await expect(app.$("#pErr")).toHaveText("Choose a patient.");
    await app.$("#pCancel").click();
    await app.addToSchedule("off", { from: "2026-11-06", until: "2026-11-05" });
    await expect(app.$("#pErr")).toHaveText("The last day must be on or after the first day.");
  });

  test("time off wins over scheduled shifts", async ({ openApp }) => {
    const app = await openApp({ sync: false });
    await weekWithTimeOff(app);
    // Mon 4h + Wed 4h + Wed evening 1.5h + Sat 4h. Friday's shift falls on time off and doesn't count.
    await expect(app.weekTotal()).toHaveText("13h 30m");
    await expect(app.$("#weekDecimal")).toContainText("13.50 hours scheduled");
    await expect(app.$(".occ.cancel")).toHaveCount(1);
    await expect(app.$(".occ.cancel")).toContainText("Time off");
    // "mom" was matched to the existing spelling.
    await expect(app.$("#planList")).not.toContainText("mom ·");
  });

  test("Skip this day removes one repeating shift", async ({ openApp }) => {
    const app = await openApp({ sync: false });
    await weekWithTimeOff(app);
    await app.$("[data-pact=skip]").nth(1).click();   // Wednesday 9-1
    await expect(app.weekTotal()).toHaveText("9h 30m");
    await expect(app.$(".occ.cancel")).toHaveCount(2);
  });

  test("next week shows the repeating shift again", async ({ openApp }) => {
    const app = await openApp({ sync: false });
    await weekWithTimeOff(app);
    await app.$("#nextWeek").click();
    await expect(app.$("#weekTitle")).toHaveText("Next week");
    await expect(app.weekTotal()).toHaveText("12h 00m");
  });

  test("clock in from today's schedule, and see scheduled vs worked", async ({ openApp }) => {
    const app = await openApp({ sync: false });
    await weekWithTimeOff(app);
    await app.tab("Shifts");
    await expect(app.$("#weekVs")).toHaveText("Scheduled: 13h 30m [13.50]");
    const button = app.$("[data-clockfor]");
    await expect(button).toHaveText("Clock in for Mom · 9:00 PM – 10:30 PM");   // the 9-1 shift is already over
    await button.click();
    await expect(app.$("#clock .status")).toHaveText("On the clock · Mom");
  });

  test("tapping Schedule right after signing in stays on Schedule", async ({ openApp }) => {
    // On a slow connection the app is still loading after sign-in; it must not switch tabs on its own.
    const app = await openApp({ slowDb: 400 });
    await app.$("#siEmail").fill("cynda@example.com");
    await app.$("#emailForm button").click();
    await app.$("#siCode").fill("123456");
    await app.$("#codeForm button").click();
    await app.tab("Schedule");
    await app.settle();   // let the app finish loading everything after sign-in
    await expect(app.page.getByRole("tab", { name: "Schedule" })).toHaveAttribute("aria-selected", "true", { timeout: 1000 });
    await expect(app.$("#plan")).toBeVisible();
  });

  test("the schedule syncs to a second device", async ({ openApp, db }) => {
    const phone = await openApp();
    await phone.signIn("cynda@example.com");
    await weekWithTimeOff(phone);
    await phone.waitSynced();
    expect(db.rows("schedule").map(r => r.kind).sort()).toEqual(["off", "once", "once", "weekly"]);

    const laptop = await openApp();
    await laptop.signIn("cynda@example.com");
    await laptop.tab("Schedule");
    await expect(laptop.weekTotal()).toHaveText("13h 30m");
  });

  test("payers see their patient's schedule, and time off only as unavailable", async ({ openApp }) => {
    const cynda = await openApp();
    await cynda.signIn("cynda@example.com");
    await cynda.setName("Cynda B.");
    await weekWithTimeOff(cynda);
    await cynda.share("Mom", "payer@example.com");
    await cynda.waitSynced();

    const payer = await openApp();
    await payer.signIn("payer@example.com");
    await expect(payer.$("#byCaregiver")).toContainText("Scheduled9h 30m [9.50]");
    await payer.tab("Schedule");                       // payers see the schedule on their Schedule tab
    const plan = payer.$("#planShared");
    await expect(plan).toContainText("Scheduled this week");
    await expect(plan).toContainText("Mom · by Cynda B. · bring lunch");
    await expect(plan).toContainText("Cynda B. unavailable");
    await expect(plan).toContainText("Caregiver unavailable");
    await expect(plan).not.toContainText("Dad");
    await expect(plan.locator("[data-pact]")).toHaveCount(0);   // nothing to edit, skip or delete

    await payer.$("#nextWeek").click();
    await expect(plan).toContainText("Scheduled next week");
    await expect(plan).toContainText("MONDAY, NOV 9", { ignoreCase: true });
  });
});
