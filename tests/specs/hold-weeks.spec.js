// Holding each week until the caregiver shares it.
// "Today" is Wednesday, Nov 4, 2026, so this week is Mon Nov 2 - Sun Nov 8 and last week is Oct 26 - Nov 1.
const { test, expect, DAYS } = require("../support/fixtures");

async function setUp(openApp) {
  const cynda = await openApp();
  await cynda.signIn("cynda@example.com");
  await cynda.setName("Cynda B.");
  await cynda.addShift({ date: "2026-10-27", start: "09:00", end: "12:00", patient: "Mom", note: "last week" });
  await cynda.addShift({ date: "2026-11-02", start: "09:00", end: "13:00", patient: "Mom", note: "this monday" });
  await cynda.addShift({ date: "2026-11-03", start: "10:00", end: "12:00", patient: "Dad", note: "dad tuesday" });
  await cynda.share("Mom", "pat@example.com");
  await cynda.share("Dad", "pat@example.com");
  await cynda.waitSynced();
  return cynda;
}
const holdBox = app => app.$("#holdBox");
const patBox = (app, name) => app.$(".holdpat").filter({ has: app.page.locator(".holdhead b", { hasText: name }) });
const weeksOf = (app, name) => patBox(app, name).locator(".holdweek");
async function payer(openApp) {
  const pat = await openApp();
  await pat.signIn("pat@example.com");
  await pat.settle();
  return pat;
}

test.describe("Holding each week", () => {
  test("each patient's week is shared on its own, and sharing can't be undone", async ({ openApp, db }) => {
    const cynda = await setUp(openApp);
    await expect(holdBox(cynda)).toContainText("Off: payers see your shifts as soon as you save them.");
    await cynda.$("#holdWeeks").check();
    await expect(cynda.$("#holdStatus")).toHaveText("Each patient's weeks are shared on their own, oldest week first. Payers see a week once you share it.");
    // One line per patient and week, with that week's hours.
    await expect(cynda.$(".holdhead b")).toHaveText(["Dad", "Mom"]);
    await expect(patBox(cynda, "Mom").locator(".holdhead .hint")).toHaveText("Shared through Sunday, Nov 1.");
    await expect(weeksOf(cynda, "Mom")).toHaveText([/Nov 2 – Nov 8 \(this week\)\s*4h 00m\s*Share/]);
    await expect(weeksOf(cynda, "Dad")).toHaveText([/Nov 2 – Nov 8 \(this week\)\s*2h 00m\s*Share/]);
    await expect(cynda.$("#heldNote")).toHaveText("Not shared yet. Payers can't see these shifts until you share them in Sync & sharing.");
    const prof = () => db.rows("profiles").find(r => r.email === "cynda@example.com");
    expect(prof().hold_weeks).toBe(true);
    expect(prof().shared_through).toBe("2026-11-02T05:00:00.000Z");   // Monday midnight in New York

    // The schedule isn't held.
    await cynda.show("schedule");
    await cynda.addToSchedule("weekly", { patient: "Mom", days: [DAYS.fri], from: "2026-11-02", start: "09:00", end: "13:00" });
    await cynda.show("worked");
    await cynda.waitSynced();

    // Pat sees last week, but nothing from this week yet; the schedule still shows.
    const pat = await payer(openApp);
    await expect(pat.weekTotal()).toHaveText("0h");
    await expect(pat.$("#heldNote")).toHaveText("Cynda B. has shared shifts through Sunday, Nov 1. Later shifts appear when they share them.");
    await expect(pat.$(".bycg-item")).toContainText("Mom0m [0.00]4h 00m [4.00]");
    await pat.$("#prevWeek").click();
    await expect(pat.weekTotal()).toHaveText("3h 00m");
    await expect(pat.$("#heldNote")).toBeHidden();

    // Cynda shares Mom's week; Cancel first changes nothing.
    const shareMom = cynda.page.getByRole("button", { name: "Share Mom, Nov 2 – Nov 8" });
    await shareMom.click();
    await expect(cynda.$("#holdConfirm")).toContainText("Payers will see Mom's shifts through Sunday, Nov 8. You can't take this back.");
    await cynda.$("#holdNo").click();
    expect(db.rows("shared_weeks")).toEqual([]);
    await shareMom.click();
    await cynda.$("#holdYes").click();
    await expect(patBox(cynda, "Mom").locator(".holdhead .hint")).toHaveText("Shared through Sunday, Nov 8. Next week (Nov 9 – Nov 15) is held until you share it.");
    await expect(weeksOf(cynda, "Mom")).toHaveCount(0);
    await expect(weeksOf(cynda, "Dad")).toHaveCount(1);   // Dad is still held
    await expect(cynda.$("#heldNote")).toHaveText("Some of these shifts aren't shared yet. Share them in Sync & sharing when you're ready.");
    expect(db.rows("shared_weeks").map(r => [r.person, r.shared_through])).toEqual([["mom", "2026-11-09T05:00:00.000Z"]]);
    expect(prof().shared_through).toBe("2026-11-02T05:00:00.000Z");   // the other patients stay where they were

    // Pat sees Mom's week now, but not Dad's.
    await pat.reload();
    await pat.settle();
    await expect(pat.weekTotal()).toHaveText("4h 00m");
    await expect(pat.$("#heldNote")).toHaveText("Cynda B. has shared shifts through Sunday, Nov 1. Later shifts appear when they share them.");

    // Picking Mom on the caregiver's screen: her shifts are all shared.
    await cynda.$("#myPatient").selectOption({ label: "Mom" });
    await expect(cynda.$("#heldNote")).toBeHidden();
    await cynda.$("#myPatient").selectOption({ label: "Dad" });
    await expect(cynda.$("#heldNote")).toHaveText("Not shared yet. Payers can't see these shifts until you share them in Sync & sharing.");
    await cynda.$("#myPatient").selectOption({ label: "All patients" });

    // Shifts in a shared week can still be added and fixed, and payers see them.
    await cynda.addShift({ date: "2026-11-03", start: "08:00", end: "09:00", patient: "Mom", note: "added after sharing" });
    await cynda.waitSynced();
    await pat.reload();
    await pat.settle();
    await expect(pat.weekTotal()).toHaveText("5h 00m");

    // Then Dad's week; everything is shared and the notes go away.
    await cynda.page.getByRole("button", { name: "Share Dad, Nov 2 – Nov 8" }).click();
    await cynda.$("#holdYes").click();
    await expect(weeksOf(cynda, "Dad")).toHaveCount(0);
    await expect(cynda.$("#heldNote")).toBeHidden();
    await pat.reload();
    await pat.settle();
    await expect(pat.weekTotal()).toHaveText("7h 00m");
    await expect(pat.$("#heldNote")).toBeHidden();

    // The database won't move a patient back, even if asked directly.
    const res = await cynda.page.evaluate(async id => {
      const c = window.supabase.createClient("x", "y", { auth: { storageKey: "care-hours-auth" } });
      return c.from("shared_weeks").upsert({ owner: id, person: "mom", shared_through: "2026-11-02T05:00:00.000Z" });
    }, db.userId("cynda@example.com"));
    expect(res.error.code).toBe("23514");
    expect(db.rows("shared_weeks").find(r => r.person === "mom").shared_through).toBe("2026-11-09T05:00:00.000Z");
  });

  test("weeks not shared yet are listed oldest first, empty ones too, and only the oldest can be shared", async ({ openApp, db }) => {
    const cynda = await setUp(openApp);
    await cynda.$("#holdWeeks").check();
    await expect(cynda.$("#holdStatus")).toBeVisible();
    // Pretend she turned holding on three weeks ago and hasn't shared since.
    db.tables.profiles.find(r => r.email === "cynda@example.com").shared_through = "2026-10-19T04:00:00.000Z";
    await cynda.reload();
    await expect(patBox(cynda, "Mom").locator(".holdhead .hint")).toHaveText("Shared through Sunday, Oct 18.");
    await expect(weeksOf(cynda, "Mom")).toHaveText([/Oct 19 – Oct 25\s*0m\s*Share/, /Oct 26 – Nov 1\s*3h 00m\s*$/, /Nov 2 – Nov 8 \(this week\)\s*4h 00m\s*$/]);
    await expect(weeksOf(cynda, "Dad")).toHaveText([/Oct 19 – Oct 25\s*0m\s*Share/, /Oct 26 – Nov 1\s*0m\s*$/, /Nov 2 – Nov 8 \(this week\)\s*2h 00m\s*$/]);
    await expect(patBox(cynda, "Mom").locator("[data-share-through]")).toHaveCount(1);
    await cynda.$("#prevWeek").click();
    await expect(cynda.$("#heldNote")).toContainText("Not shared yet.");

    // Sharing Mom's oldest week moves her Share button to the next one.
    await cynda.page.getByRole("button", { name: "Share Mom, Oct 19 – Oct 25" }).click();
    await cynda.$("#holdYes").click();
    await expect(weeksOf(cynda, "Mom")).toHaveText([/Oct 26 – Nov 1\s*3h 00m\s*Share/, /Nov 2 – Nov 8 \(this week\)\s*4h 00m\s*$/]);
    await cynda.page.getByRole("button", { name: "Share Mom, Oct 26 – Nov 1" }).click();
    await cynda.$("#holdYes").click();
    await expect(patBox(cynda, "Mom").locator(".holdhead .hint")).toHaveText("Shared through Sunday, Nov 1.");
    await expect(weeksOf(cynda, "Mom")).toHaveText([/Nov 2 – Nov 8 \(this week\)\s*4h 00m\s*Share/]);
    await expect(weeksOf(cynda, "Dad")).toHaveCount(3);
    await expect(cynda.$("#heldNote")).toHaveText("Some of these shifts aren't shared yet. Share them in Sync & sharing when you're ready.");

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
    await expect(pat.weekTotal()).toHaveText("6h 00m");

    // This week was already visible, so turning it back on holds starting next week, for every patient.
    await cynda.$("#holdWeeks").check();
    for (const name of ["Mom", "Dad"]) {
      await expect(patBox(cynda, name).locator(".holdhead .hint")).toHaveText("Shared through Sunday, Nov 8. Next week (Nov 9 – Nov 15) is held until you share it.");
      await expect(weeksOf(cynda, name)).toHaveCount(0);
    }
    expect(db.rows("profiles").find(r => r.email === "cynda@example.com").shared_through).toBe("2026-11-09T05:00:00.000Z");
  });

  test("before running setup.sql version 11, sharing a patient's week explains what's needed", async ({ openApp, db }) => {
    db.version = 10;
    const cynda = await setUp(openApp);
    await cynda.$("#holdWeeks").check();
    await cynda.page.getByRole("button", { name: "Share Mom, Nov 2 – Nov 8" }).click();
    await cynda.$("#holdYes").click();
    await expect(holdBox(cynda).locator(".err")).toHaveText("Sharing each patient's weeks needs the latest setup.sql (version 11). Run it in Supabase, then try again.");
    await expect(weeksOf(cynda, "Mom")).toHaveCount(1);   // still held
  });

  test("before running the new setup.sql, the option explains what's needed", async ({ openApp, db }) => {
    db.version = 4;
    const cynda = await setUp(openApp);
    await cynda.$("#holdWeeks").click();
    await expect(holdBox(cynda).locator(".err")).toHaveText("Holding weeks needs the latest setup.sql. Run it in Supabase, then try again.");
    await expect(cynda.$("#holdWeeks")).not.toBeChecked();
    const pat = await payer(openApp);
    await expect(pat.weekTotal()).toHaveText("6h 00m");   // nothing is hidden
  });
});
