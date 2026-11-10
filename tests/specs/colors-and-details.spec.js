// Color coding, the hours box under the pickers, and tapping a day for its details.
const { test, expect, DAYS } = require("../support/fixtures");

// The color class (pc0..pc7) on an element, or "" if none.
const colorOf = loc => loc.evaluate(el => (el.className.match(/\bpc\d\b/) || [""])[0]);

async function caregiverWeek(app) {
  await app.addShift({ date: "2026-11-02", start: "09:00", end: "12:00", patient: "Mom", note: "breakfast" });
  await app.addShift({ date: "2026-11-03", start: "08:00", end: "10:00", patient: "Mom", note: "meds" });
  await app.addShift({ date: "2026-11-03", start: "13:00", end: "16:00", patient: "Dad", note: "pharmacy" });
  await app.show("schedule");
  await app.addToSchedule("weekly", { patient: "Mom", days: [DAYS.mon, DAYS.wed], from: "2026-11-02", start: "09:00", end: "13:00" });
  await app.addToSchedule("once", { patient: "Dad", from: "2026-11-03", start: "13:00", end: "15:00", note: "pharmacy run" });
  await app.addToSchedule("off", { from: "2026-11-06", until: "2026-11-06" });
  await app.show("both");
}

async function twoCaregiversForMom(openApp) {
  const cynda = await openApp();
  await cynda.signIn("cynda@example.com");
  await cynda.setName("Cynda B.");
  await cynda.addShift({ date: "2026-11-03", start: "22:00", end: "06:30", patient: "Mom", note: "overnight" });
  await cynda.show("schedule");
  await cynda.addToSchedule("weekly", { patient: "Mom", days: [DAYS.mon, DAYS.wed], from: "2026-11-02", start: "09:00", end: "13:00" });
  await cynda.addToSchedule("off", { from: "2026-11-04", until: "2026-11-04" });
  await cynda.show("worked");
  await cynda.share("Mom", "payer@example.com");
  const ann = await openApp();
  await ann.signIn("ann@example.com");
  await ann.setName("Ann L.");
  await ann.addShift({ date: "2026-11-03", start: "07:00", end: "09:00", patient: "Mom", note: "morning meds" });
  await ann.share("Mom", "payer@example.com");
  await cynda.waitSynced();
  await ann.waitSynced();
  const payer = await openApp();
  await payer.signIn("payer@example.com");
  await expect(payer.weekTotal()).toHaveText("10h 30m");
  return { cynda, ann, payer };
}

test.describe("Colors", () => {
  test("caregiver screens color shifts and schedule by patient", async ({ openApp }) => {
    const app = await openApp({ sync: false });
    await caregiverWeek(app);
    const mom = await colorOf(app.$("#list .shift").filter({ hasText: "breakfast" }));
    const dad = await colorOf(app.$("#list .shift").filter({ hasText: "pharmacy" }));
    expect(mom).toMatch(/^pc\d$/);
    expect(dad).toMatch(/^pc\d$/);
    expect(mom).not.toBe(dad);
    expect(await colorOf(app.$("#list .shift").filter({ hasText: "meds" }))).toBe(mom);   // same patient, same color

    // Chart bars and the hours box use the same colors.
    await expect(app.$(`#bars .track.worked .seg.${mom}`)).toHaveCount(2);   // worked Mon and Tue
    await expect(app.$(`#bars .track.worked .seg.${dad}`)).toHaveCount(1);   // worked Tue
    expect(await colorOf(app.$(".bycg-item").filter({ hasText: "Mom" }))).toBe(mom);

    // The schedule uses them too; time off has no patient color.
    await app.show("schedule");
    expect(await colorOf(app.$("#planList .occ").filter({ hasText: "Mom · Repeats" }).first())).toBe(mom);
    expect(await colorOf(app.$("#planList .occ.off").first())).toBe("");
  });

  test("a patient keeps their color after reloading and adding more patients", async ({ openApp }) => {
    const app = await openApp({ sync: false });
    await app.addShift({ date: "2026-11-02", start: "09:00", end: "12:00", patient: "Mom" });
    const before = await colorOf(app.$("#list .shift").first());
    await app.addShift({ date: "2026-11-03", start: "09:00", end: "10:00", patient: "Aunt Jo" });   // sorts before Mom
    await app.reload();
    expect(await colorOf(app.$("#list .shift").filter({ hasText: "Mom" }))).toBe(before);
    expect(await colorOf(app.$("#list .shift").filter({ hasText: "Aunt Jo" }))).not.toBe(before);
  });

  test("payer screens color by caregiver", async ({ openApp }) => {
    const { payer } = await twoCaregiversForMom(openApp);
    const cynda = await colorOf(payer.$("#list .shift").filter({ hasText: "by Cynda B." }));
    const ann = await colorOf(payer.$("#list .shift").filter({ hasText: "by Ann L." }));
    expect(cynda).toMatch(/^pc\d$/);
    expect(ann).not.toBe(cynda);
    expect(await colorOf(payer.$(".bycg-item").filter({ hasText: "Cynda B." }))).toBe(cynda);
    await payer.show("schedule");
    expect(await colorOf(payer.$("#planShared .occ.off").first())).toBe(cynda);   // her time off, in her color
  });
});

test.describe("Hours box", () => {
  test("caregivers see worked and scheduled hours for each patient, above the tabs", async ({ openApp }) => {
    const app = await openApp({ sync: false });
    await caregiverWeek(app);
    const order = await app.page.evaluate(() => [...document.querySelectorAll("#myPatientWrap, #byCaregiver, #tabs")].map(e => e.id));
    expect(order).toEqual(["myPatientWrap", "byCaregiver", "tabs"]);
    await expect(app.$("#byCaregiver .label")).toHaveText("Hours by patient");
    const row = name => app.$(".bycg-item").filter({ hasText: name });
    await expect(row("Mom")).toContainText("Worked5h 00m [5.00]");
    await expect(row("Mom")).toContainText("Scheduled8h 00m [8.00]");
    await expect(row("Dad")).toContainText("Worked3h 00m [3.00]");
    await expect(row("Dad")).toContainText("Scheduled2h 00m [2.00]");

    // It shows the chart's dates, and a total that matches the chart.
    await expect(app.$("#bycgDates")).toHaveText("This week · Nov 2 – Nov 8");
    await expect(app.weekTotal()).toHaveText("8h 00m");
    await expect(app.$(".bycg-total")).toContainText("Worked8h 00m [8.00]");
    await expect(app.$(".bycg-total")).toContainText("Scheduled10h 00m [10.00]");
    await app.$("#prevWeek").click();
    await expect(app.$("#bycgDates")).toHaveText("Last week · Oct 26 – Nov 1");
    await expect(app.$("#byCaregiver")).toContainText("No hours last week.");
    await app.$("#thisWeek").click();

    // It follows the Show picker. With one patient there's no separate total.
    await app.$("#myPatient").selectOption({ label: "Dad" });
    await expect(app.$(".bycg-item")).toHaveCount(1);
    await expect(row("Dad")).toBeVisible();
    await expect(app.$(".bycg-total")).toHaveCount(0);
  });

  test("payers see worked and scheduled hours for each caregiver", async ({ openApp }) => {
    const { payer } = await twoCaregiversForMom(openApp);
    await expect(payer.$("#byCaregiver .label")).toHaveText("Hours by caregiver");
    const row = name => payer.$(".bycg-item").filter({ hasText: name });
    await expect(row("Cynda B.")).toContainText("Worked8h 30m [8.50]");
    await expect(row("Cynda B.")).toContainText("Scheduled4h 00m [4.00]");   // Mon; Wed falls on her time off
    await expect(row("Ann L.")).toContainText("Worked2h 00m [2.00]");
    await expect(row("Ann L.")).toContainText("Scheduled0m [0.00]");
    await expect(payer.$("#bycgDates")).toHaveText("This week · Nov 2 – Nov 8");
    await expect(payer.$(".bycg-total")).toContainText("Worked10h 30m [10.50]");   // same as the chart
    await expect(payer.$(".bycg-total")).toContainText("Scheduled4h 00m [4.00]");
  });
});

test.describe("Tap a day", () => {
  test("caregivers see that day's shifts and schedule, with the patients after the date", async ({ openApp }) => {
    const app = await openApp({ sync: false });
    await caregiverWeek(app);
    await app.$("#bars button.day").nth(1).click();   // Tuesday
    const card = app.$("#dayDetail");
    await expect(card).toBeVisible();
    await expect(card.locator("h3")).toHaveText(/Tuesday, Nov 3\s*·\s*Dad\s*Mom/);
    await expect(card).toContainText("Worked 5h 00m [5.00] · Scheduled 2h 00m [2.00]");
    await expect(card).toContainText("Mom · meds");
    await expect(card).toContainText("Dad · One time · pharmacy run");
    await expect(app.$("#bars button.day").nth(1)).toHaveAttribute("aria-pressed", "true");

    // Tapping the same day again closes it; so does Close.
    await app.$("#bars button.day").nth(1).click();
    await expect(card).toBeHidden();
    await app.$("#bars button.day").nth(4).click();   // Friday: time off
    await expect(card).toContainText("All day");
    await expect(card).toContainText("Time off");
    await card.getByRole("button", { name: "Close" }).click();
    await expect(card).toBeHidden();
  });

  test("the Show picker narrows the day card to one patient", async ({ openApp }) => {
    const app = await openApp({ sync: false });
    await caregiverWeek(app);
    await app.$("#myPatient").selectOption({ label: "Dad" });
    await app.$("#bars button.day").nth(1).click();
    await expect(app.$("#dayDetail h3")).toHaveText(/Tuesday, Nov 3\s*·\s*Dad$/);
    await expect(app.$("#dayDetail")).not.toContainText("meds");
  });

  test("payers can open a day too, with the caregivers after the date", async ({ openApp }) => {
    const { payer } = await twoCaregiversForMom(openApp);
    await payer.$("#bars button.day").nth(1).click();
    const card = payer.$("#dayDetail");
    await expect(card.locator("h3")).toHaveText(/Tuesday, Nov 3\s*·\s*Ann L\.\s*Cynda B\./);
    await expect(card).toContainText("Mom · by Ann L. · morning meds");
    await expect(card).toContainText("Mom · by Cynda B. · overnight");
    await expect(card.locator("[data-act], [data-pact]")).toHaveCount(0);   // view only
    await payer.$("#bars button.day").nth(2).click();                        // Wednesday: Cynda's time off
    await expect(card).toContainText("Cynda B. unavailable");
  });
});
