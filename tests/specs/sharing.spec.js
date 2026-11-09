// Sharing a patient with a payer, and what payers can see.
const { test, expect } = require("../support/fixtures");

// Two caregivers who both care for Mom; Ann also cares for Dad; Cynda also has an unshared patient.
async function twoCaregivers(openApp) {
  const cynda = await openApp();
  await cynda.signIn("cynda@example.com");
  await cynda.setName("Cynda B.");
  await cynda.addShift({ date: "2026-11-02", start: "09:00", end: "12:00", patient: "Mom", note: "breakfast" });
  await cynda.addShift({ date: "2026-11-03", start: "22:00", end: "06:30", patient: "Mom", note: "overnight" });
  await cynda.addShift({ date: "2026-11-03", start: "13:00", end: "14:00", patient: "Aunt Jo", note: "not shared" });
  await cynda.share("Mom", "payer@example.com");

  const ann = await openApp();
  await ann.signIn("ann@example.com");
  await ann.setName("Ann L.");
  await ann.addShift({ date: "2026-11-03", start: "07:00", end: "09:00", patient: "mom", note: "morning meds" });
  await ann.addShift({ date: "2026-11-04", start: "08:00", end: "11:00", patient: "Dad", note: "doctor visit" });
  await ann.share("Mom", "payer@example.com");
  await ann.share("Dad", "payer@example.com");
  await cynda.waitSynced();
  await ann.waitSynced();
  return { cynda, ann };
}

test.describe("Sharing with payers", () => {
  test("the share form needs a patient and a payer email", async ({ openApp }) => {
    const app = await openApp();
    await app.signIn("cynda@example.com");
    await app.share("", "payer@example.com");
    await expect(app.$("#shareForm .err")).toHaveText("Choose the patient whose shifts you want to share.");
    await app.share("Mom", "cynda@example.com");
    await expect(app.$("#shareForm .err")).toContainText("That's your own email");
    await app.share("Mom", "Payer@Example.com");
    await expect(app.$("#shareForm .ok-msg")).toContainText("You don't have any shifts for \"Mom\" yet");
    await app.share("mom", "payer@example.com");
    await expect(app.$("#shareForm .err")).toHaveText("payer@example.com can already see Mom's shifts.");
  });

  test("a payer sees every shared shift from every caregiver, view only", async ({ openApp }) => {
    await twoCaregivers(openApp);
    const payer = await openApp();
    await payer.signIn("payer@example.com");

    // Payers get Shifts, Schedule, Client/Patient and Messages tabs, and no time clock.
    await expect(payer.page.getByRole("tab")).toHaveText(["Shifts", "Schedule", "Client/Patient", "Messages"]);
    await expect(payer.page.getByRole("tab", { name: "Shifts" })).toHaveAttribute("aria-selected", "true");
    await expect(payer.$("#clock")).toBeHidden();
    await expect(payer.$("#addBtn")).toBeHidden();

    await expect(payer.weekTotal()).toHaveText("16h 30m");
    const hours = name => payer.$(".bycg-item").filter({ hasText: name });
    await expect(hours("Ann L.")).toContainText("Worked5h 00m [5.00]");
    await expect(hours("Cynda B.")).toContainText("Worked11h 30m [11.50]");
    await expect(payer.shiftRows()).toHaveCount(4);
    await expect(payer.$("#list")).toContainText("Mom · by Ann L. · morning meds");
    await expect(payer.$("#list")).not.toContainText("Aunt Jo");
    await expect(payer.$("#list")).not.toContainText("mom ·");          // one spelling per patient
    await expect(payer.$("[data-act=edit], [data-act=del]")).toHaveCount(0);
  });

  test("the payer's Shifts tab shows shifts, and the Schedule tab shows the schedule", async ({ openApp }) => {
    await twoCaregivers(openApp);
    const payer = await openApp();
    await payer.signIn("payer@example.com");
    await expect(payer.weekTotal()).toHaveText("16h 30m");
    await expect(payer.$("#logSection")).toBeVisible();
    await expect(payer.$("#planShared")).toBeHidden();
    await payer.tab("Schedule");
    await expect(payer.page.getByRole("tab", { name: "Schedule" })).toHaveAttribute("aria-selected", "true");
    await expect(payer.$("#planShared")).toBeVisible();
    await expect(payer.$("#logSection")).toBeHidden();
    await expect(payer.$("#weekDecimal")).toContainText("hours scheduled");
  });

  test("the caregiver picker at the top filters both payer tabs", async ({ openApp }) => {
    await twoCaregivers(openApp);
    const payer = await openApp();
    await payer.signIn("payer@example.com");
    await expect(payer.weekTotal()).toHaveText("16h 30m");

    // The picker sits at the top, above the hours box and the tabs. All caregivers is the default.
    const order = await payer.page.evaluate(() => [...document.querySelectorAll("#ownerPickWrap, #byCaregiver, #tabs")].map(e => e.id));
    expect(order).toEqual(["ownerPickWrap", "byCaregiver", "tabs"]);
    await expect(payer.$("#ownerPick option")).toHaveText(["All caregivers", "Ann L.", "Cynda B."]);
    await expect(payer.$("#ownerPick")).toHaveValue("all");
    await expect(payer.$("#sharedWho")).toContainText("Ann L. · caring for Dad, Mom");
    await expect(payer.$("#sharedWho")).toContainText("Cynda B. · caring for Mom");

    // One caregiver: only their shifts, for every patient they share.
    await payer.$("#ownerPick").selectOption({ label: "Ann L." });
    await expect(payer.$("#sharedWho")).toContainText("Caring for Dad, Mom");
    await expect(payer.weekTotal()).toHaveText("5h 00m");
    await expect(payer.$("#list")).toContainText("doctor visit");
    await expect(payer.$("#list")).not.toContainText("by Cynda B.");
    await expect(payer.$("#byCaregiver")).not.toContainText("Cynda B.");

    const csv = await payer.downloadCsv();
    expect(csv.name).toBe("care-hours-ann-l-week-of-2026-11-02.csv");
    expect(csv.text).toContain("Date,Start,End,Hours,Patient,Caregiver,Notes");
    expect(csv.text).toContain("Total for Ann L.,,,5.00,,Ann L.,");
    expect(csv.text).not.toContain("Cynda B.");

    // The choice carries over to the Schedule tab.
    await payer.tab("Schedule");
    await expect(payer.$("#ownerPick")).toHaveValue(await payer.$("#ownerPick").inputValue());
    await expect(payer.$("#ownerPick option:checked")).toHaveText("Ann L.");

    await payer.tab("Shifts");
    await payer.$("#ownerPick").selectOption({ label: "Cynda B." });
    await expect(payer.weekTotal()).toHaveText("11h 30m");
    await expect(payer.$("#list")).not.toContainText("Aunt Jo");   // still only patients shared with this payer

    await payer.$("#ownerPick").selectOption("all");
    await expect(payer.weekTotal()).toHaveText("16h 30m");
  });

  test("a payer only sees the patients shared with them", async ({ openApp }) => {
    await twoCaregivers(openApp);
    const other = await openApp();
    await other.signIn("someone-else@example.com");
    await expect(other.$("#tabShared")).toBeHidden();
    await expect(other.weekTotal()).toHaveText("0h");
  });

  test("removing a share takes the patient away from the payer", async ({ openApp }) => {
    const { cynda, ann } = await twoCaregivers(openApp);
    await cynda.$('[data-unshare="mom|payer@example.com"]').click();
    await cynda.$("[data-unshare-yes]").click();
    await ann.$('[data-unshare="mom|payer@example.com"]').click();
    await ann.$("[data-unshare-yes]").click();
    await expect(ann.$("#sync .field > b")).toHaveText(["Dad"]);

    const payer = await openApp();
    await payer.signIn("payer@example.com");
    await expect(payer.$("#list")).not.toContainText("Mom");
    await expect(payer.weekTotal()).toHaveText("3h 00m");   // only Dad is left
    // With one caregiver left, the picker still shows.
    await expect(payer.$("#ownerPick")).toBeVisible();
    await expect(payer.$("#ownerPick option")).toHaveText(["All caregivers", "Ann L."]);
  });

  test("a name saved right after signing in for the first time is kept", async ({ openApp, db }) => {
    // The app is still loading the account (a slow profile read) when the name is saved.
    const app = await openApp({ slowDb: q => (q.table === "profiles" && q.op === "select" ? 1500 : 0) });
    await app.signIn("cynda@example.com");
    await app.setName("Cynda B.");
    await app.settle();
    expect(db.rows("profiles").find(r => r.email === "cynda@example.com").display_name).toBe("Cynda B.");
    await expect(app.$("#dispName")).toHaveValue("Cynda B.");
  });

  test("a name being typed survives the account card redrawing", async ({ openApp, db }) => {
    const app = await openApp();
    await app.signIn("ann@example.com");
    await app.settle();
    await app.$("#dispName").fill("Ann L.");
    await app.page.evaluate(() => renderSync());   // what happens when sign-in finishes loading
    await expect(app.$("#dispName")).toHaveValue("Ann L.");
    await app.$("#nameForm button").click();
    await expect(app.$("#nameForm")).toContainText("Saved.");
    expect(db.rows("profiles").find(r => r.email === "ann@example.com").display_name).toBe("Ann L.");
  });

  test("the database refuses a payer who tries to change shifts", async ({ openApp, db }) => {
    await twoCaregivers(openApp);
    const payer = await openApp();
    await payer.signIn("payer@example.com");
    const cyndaId = db.userId("cynda@example.com");
    const result = await payer.page.evaluate(async owner => {
      const c = window.supabase.createClient("x", "y", { auth: { storageKey: "care-hours-auth" } });
      return c.from("shifts").upsert({ owner, id: "evil", start_at: new Date().toISOString(), person: "Mom" });
    }, cyndaId);
    expect(result.error.code).toBe("42501");
    expect(db.rows("shifts").some(r => r.id === "evil")).toBe(false);
  });
});
