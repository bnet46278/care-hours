// Holding each week until the caregiver shares it.
// "Today" is Wednesday, Nov 4, 2026, so this week is Mon Nov 2 - Sun Nov 8 and last week is Oct 26 - Nov 1.
const { test, expect, DAYS } = require("../support/fixtures");

async function setUp(openApp) {
  const cynda = await openApp();
  await cynda.signIn("cynda@example.com");
  await cynda.setName("Cynda B.");
  await cynda.addShift({ date: "2026-10-27", start: "09:00", end: "12:00", patient: "Mom", note: "last week" });
  await cynda.addShift({ date: "2026-11-02", start: "09:00", end: "13:00", patient: "Mom", note: "this monday" });
  await cynda.share("Mom", "pat@example.com");
  await cynda.waitSynced();
  return cynda;
}
const holdBox = app => app.$("#holdBox");
async function payer(openApp) {
  const pat = await openApp();
  await pat.signIn("pat@example.com");
  await pat.settle();
  return pat;
}

test.describe("Holding each week", () => {
  test("payers don't see this week until the caregiver shares it, and sharing can't be undone", async ({ openApp, db }) => {
    const cynda = await setUp(openApp);
    await expect(holdBox(cynda)).toContainText("Off: payers see your shifts as soon as you save them.");
    await cynda.$("#holdWeeks").check();
    await expect(cynda.$("#holdStatus")).toHaveText("Payers can see your shifts through Sunday, Nov 1.");
    const shareBtn = cynda.page.getByRole("button", { name: "Share this week (Nov 2 – Nov 8)" });
    await expect(shareBtn).toBeVisible();
    await expect(cynda.$("#heldNote")).toHaveText("Not shared yet. Payers can't see these shifts until you share them in Sync & sharing.");
    const prof = () => db.rows("profiles").find(r => r.email === "cynda@example.com");
    expect(prof().hold_weeks).toBe(true);
    expect(prof().shared_through).toBe("2026-11-02T05:00:00.000Z");   // Monday midnight in New York

    // The schedule isn't held.
    await cynda.tab("Schedule");
    await cynda.addToSchedule("weekly", { patient: "Mom", days: [DAYS.fri], from: "2026-11-02", start: "09:00", end: "13:00" });
    await cynda.tab("Shifts");
    await cynda.waitSynced();

    // Pat sees last week, but nothing from this week yet; the schedule still shows.
    const pat = await payer(openApp);
    await expect(pat.weekTotal()).toHaveText("0h");
    await expect(pat.$("#heldNote")).toHaveText("Cynda B. has shared shifts through Sunday, Nov 1. Later shifts appear when they share them.");
    await expect(pat.$(".bycg-item")).toContainText("Scheduled4h 00m [4.00]");
    await pat.$("#prevWeek").click();
    await expect(pat.weekTotal()).toHaveText("3h 00m");
    await expect(pat.$("#heldNote")).toBeHidden();

    // Cynda shares the week; Cancel first changes nothing.
    await shareBtn.click();
    await expect(cynda.$("#holdConfirm")).toContainText("Payers will see your shifts through Sunday, Nov 8. You can't take this back.");
    await cynda.$("#holdNo").click();
    expect(prof().shared_through).toBe("2026-11-02T05:00:00.000Z");
    await shareBtn.click();
    await cynda.$("#holdYes").click();
    await expect(cynda.$("#holdStatus")).toHaveText("Payers can see your shifts through Sunday, Nov 8. This week is shared. Next week (Nov 9 – Nov 15) is held until you share it.");
    await expect(holdBox(cynda).locator("[data-share-through]")).toHaveCount(0);
    await expect(cynda.$("#heldNote")).toBeHidden();
    expect(prof().shared_through).toBe("2026-11-09T05:00:00.000Z");

    // Shifts in a shared week can still be added and fixed, and payers see them.
    await cynda.addShift({ date: "2026-11-03", start: "08:00", end: "09:00", patient: "Mom", note: "added after sharing" });
    await cynda.waitSynced();
    await pat.reload();
    await pat.settle();
    await expect(pat.weekTotal()).toHaveText("5h 00m");
    await expect(pat.$("#heldNote")).toBeHidden();

    // The database won't move the date back, even if asked directly.
    const res = await cynda.page.evaluate(async id => {
      const c = window.supabase.createClient("x", "y", { auth: { storageKey: "care-hours-auth" } });
      return c.from("profiles").upsert({ id, shared_through: "2026-11-02T05:00:00.000Z" });
    }, db.userId("cynda@example.com"));
    expect(res.error.code).toBe("23514");
    expect(prof().shared_through).toBe("2026-11-09T05:00:00.000Z");
  });

  test("weeks that weren't shared can be shared one at a time", async ({ openApp, db }) => {
    const cynda = await setUp(openApp);
    await cynda.$("#holdWeeks").check();
    await expect(cynda.$("#holdStatus")).toBeVisible();
    // Pretend she turned holding on two weeks ago and hasn't shared since.
    db.tables.profiles.find(r => r.email === "cynda@example.com").shared_through = "2026-10-26T04:00:00.000Z";
    await cynda.reload();
    await expect(cynda.$("#holdStatus")).toHaveText("Payers can see your shifts through Sunday, Oct 25.");
    await expect(holdBox(cynda).locator("[data-share-through]")).toHaveText([
      "Share through last week (Oct 26 – Nov 1)", "Share through this week (Oct 26 – Nov 8)"]);
    await cynda.$("#prevWeek").click();
    await expect(cynda.$("#heldNote")).toContainText("Not shared yet.");

    await cynda.page.getByRole("button", { name: /Share through last week/ }).click();
    await cynda.$("#holdYes").click();
    await expect(cynda.$("#holdStatus")).toHaveText("Payers can see your shifts through Sunday, Nov 1.");
    await expect(holdBox(cynda).locator("[data-share-through]")).toHaveText(["Share this week (Nov 2 – Nov 8)"]);
    await expect(cynda.$("#heldNote")).toBeHidden();   // last week is shared now

    const pat = await payer(openApp);
    await pat.$("#prevWeek").click();
    await expect(pat.weekTotal()).toHaveText("3h 00m");
  });

  test("turning holding off shares everything, and turning it back on holds from next week", async ({ openApp, db }) => {
    const cynda = await setUp(openApp);
    await cynda.$("#holdWeeks").check();
    await expect(cynda.$("#holdStatus")).toBeVisible();

    await cynda.$("#holdWeeks").click();
    await expect(cynda.$("#holdConfirm")).toContainText("Turning this off shares all your shifts now, including this week. You can't take that back.");
    await expect(cynda.$("#holdWeeks")).toBeChecked();
    await cynda.page.getByRole("button", { name: "Keep holding" }).click();
    await expect(cynda.$("#holdStatus")).toBeVisible();

    await cynda.$("#holdWeeks").click();
    await cynda.page.getByRole("button", { name: "Turn off and share" }).click();
    await expect(cynda.$("#holdWeeks")).not.toBeChecked();
    await expect(cynda.$("#heldNote")).toBeHidden();
    const pat = await payer(openApp);
    await expect(pat.weekTotal()).toHaveText("4h 00m");

    // This week was already visible, so turning it back on holds starting next week.
    await cynda.$("#holdWeeks").check();
    await expect(cynda.$("#holdStatus")).toHaveText("Payers can see your shifts through Sunday, Nov 8. This week is shared. Next week (Nov 9 – Nov 15) is held until you share it.");
    expect(db.rows("profiles").find(r => r.email === "cynda@example.com").shared_through).toBe("2026-11-09T05:00:00.000Z");
  });

  test("before running the new setup.sql, the option explains what's needed", async ({ openApp, db }) => {
    db.version = 4;
    const cynda = await setUp(openApp);
    await cynda.$("#holdWeeks").click();
    await expect(holdBox(cynda).locator(".err")).toHaveText("Holding weeks needs the latest setup.sql. Run it in Supabase, then try again.");
    await expect(cynda.$("#holdWeeks")).not.toBeChecked();
    const pat = await payer(openApp);
    await expect(pat.weekTotal()).toHaveText("4h 00m");   // nothing is hidden
  });
});
