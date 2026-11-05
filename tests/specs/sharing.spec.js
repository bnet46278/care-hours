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
    await expect(app.$("#shareForm .err")).toHaveText("Enter the patient whose shifts you want to share.");
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

    await expect(payer.page.getByRole("tab", { name: "Shifts" })).toHaveAttribute("aria-selected", "true");
    await expect(payer.$("#clock")).toBeHidden();
    await expect(payer.$("#addBtn")).toBeHidden();
    await expect(payer.page.getByRole("tab", { name: "Schedule" })).toBeHidden();

    await expect(payer.weekTotal()).toHaveText("16h 30m");
    await expect(payer.$("#byCaregiver")).toContainText("Ann L.5h 00m [5.00]");
    await expect(payer.$("#byCaregiver")).toContainText("Cynda B.11h 30m [11.50]");
    await expect(payer.shiftRows()).toHaveCount(4);
    await expect(payer.$("#list")).toContainText("Mom · by Ann L. · morning meds");
    await expect(payer.$("#list")).not.toContainText("Aunt Jo");
    await expect(payer.$("#list")).not.toContainText("mom ·");          // one spelling per patient
    await expect(payer.$("[data-act=edit], [data-act=del]")).toHaveCount(0);
  });

  test("Shared with me shows one patient at a time, across caregivers", async ({ openApp }) => {
    await twoCaregivers(openApp);
    const payer = await openApp();
    await payer.signIn("payer@example.com");
    await payer.tab("Shared with me");

    await expect(payer.$("#ownerPick option")).toHaveText(["Dad", "Mom"]);
    await payer.$("#ownerPick").selectOption({ label: "Mom" });
    await expect(payer.$("#sharedWho")).toContainText("Cared for by Ann L., Cynda B.");
    await expect(payer.weekTotal()).toHaveText("13h 30m");
    await expect(payer.$("#list")).not.toContainText("doctor visit");

    const csv = await payer.downloadCsv();
    expect(csv.name).toBe("care-hours-mom-week-of-2026-11-02.csv");
    expect(csv.text).toContain("Date,Start,End,Hours,Patient,Caregiver,Notes");
    expect(csv.text).toContain("Total for Ann L.,,,2.00,,Ann L.,");
    expect(csv.text).toContain("Total for Cynda B.,,,11.50,,Cynda B.,");
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
