// The caregiver's patient picker on the Shifts and Schedule tabs.
const { test, expect, DAYS } = require("../support/fixtures");

test.describe("Patient picker for caregivers", () => {
  test("hidden until there's a patient, then defaults to All patients", async ({ openApp }) => {
    const app = await openApp({ sync: false });
    await expect(app.$("#myPatient")).toBeHidden();
    await app.addShift({ date: "2026-11-02", start: "09:00", end: "12:00", patient: "Mom" });
    await expect(app.$("#myPatient")).toBeVisible();
    await expect(app.$("#myPatient")).toHaveValue("all");
    await expect(app.$("#myPatient option")).toHaveText(["All patients", "Mom"]);
  });

  test("filters shifts, totals, the CSV and the schedule", async ({ openApp }) => {
    const app = await openApp({ sync: false });
    await app.addShift({ date: "2026-11-02", start: "09:00", end: "12:00", patient: "Mom", note: "breakfast" });
    await app.addShift({ date: "2026-11-03", start: "13:00", end: "15:00", patient: "Dad", note: "pharmacy" });
    await app.tab("Schedule");
    await app.addToSchedule("weekly", { patient: "Mom", days: [DAYS.mon, DAYS.wed], from: "2026-11-02", start: "09:00", end: "13:00" });
    await app.addToSchedule("once", { patient: "Dad", from: "2026-11-07", start: "08:00", end: "12:00" });
    await app.addToSchedule("off", { from: "2026-11-06", until: "2026-11-06" });
    await app.tab("Shifts");

    // All patients
    await expect(app.$("#myPatient option")).toHaveText(["All patients", "Dad", "Mom"]);
    await expect(app.weekTotal()).toHaveText("5h 00m");
    await expect(app.$("#weekVs")).toHaveText("Scheduled: 12h 00m [12.00]");

    // Just Dad
    await app.$("#myPatient").selectOption({ label: "Dad" });
    await expect(app.weekTotal()).toHaveText("2h 00m");
    await expect(app.shiftRows()).toHaveCount(1);
    await expect(app.$("#list")).not.toContainText("breakfast");
    await expect(app.$("#weekVs")).toHaveText("Scheduled: 4h 00m [4.00]");
    const csv = await app.downloadCsv();
    expect(csv.name).toBe("care-hours-dad-week-of-2026-11-02.csv");
    expect(csv.text).not.toContain("Mom");
    expect(csv.text).toContain("Total,,,2.00,,");

    // The choice carries over to the Schedule tab; time off still shows.
    await app.tab("Schedule");
    await expect(app.$("#myPatient")).toHaveValue("dad");
    await expect(app.weekTotal()).toHaveText("4h 00m");
    await expect(app.$("#planList")).toContainText("Dad · One time");
    await expect(app.$("#planList")).not.toContainText("Mom ·");
    await expect(app.$("#planList .occ.off")).toHaveCount(1);
    const repeating = app.$("#planList .field").filter({ has: app.page.getByRole("heading", { name: "Repeating shifts" }) });
    await expect(repeating).toContainText("None yet.");   // Mom's repeating shift is filtered out

    // Back to all
    await app.$("#myPatient").selectOption("all");
    await expect(app.weekTotal()).toHaveText("12h 00m");
  });

  test("a patient with nothing this week says so", async ({ openApp }) => {
    const app = await openApp({ sync: false });
    await app.addShift({ date: "2026-11-02", start: "09:00", end: "12:00", patient: "Mom" });
    await app.$("#prevWeek").click();
    await app.$("#myPatient").selectOption({ label: "Mom" });
    await expect(app.$("#list")).toHaveText("No shifts for Mom last week.");
  });

  test("payers don't see it", async ({ openApp }) => {
    const cynda = await openApp();
    await cynda.signIn("cynda@example.com");
    await cynda.addShift({ date: "2026-11-02", start: "09:00", end: "12:00", patient: "Mom" });
    await cynda.share("Mom", "payer@example.com");
    await cynda.waitSynced();
    const payer = await openApp();
    await payer.signIn("payer@example.com");
    await expect(payer.weekTotal()).toHaveText("3h 00m");
    await expect(payer.$("#myPatient")).toBeHidden();
  });
});
