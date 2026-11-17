// Changing a patient's name, and a client's Patients list on the Caregivers tab.
// A patient's name ties their card to every shift, schedule entry and share, so a new name reaches all of them.
// "Today" is Wednesday, Nov 4, 2026.
const { test, expect } = require("../support/fixtures");

const MOM = {
  name: "Mom", dob: "1944-03-03", phone: "317 555 0100",
  client: { name: "Pat P.", rel: "Son", email: "pat@example.com", phone: "317-555-0111" },
};
async function rename(app, name) {
  if (!(await app.$("#pcForm").count())) await app.$("#pcDetails").getByRole("button", { name: "Edit" }).click();
  await app.$("#pcName").fill(name);
  await app.$("#pcSave").click();
}
async function invite(app, email) {
  await app.$("#pcInviteEmail").fill(email);
  await app.$("#pcInvite button[type=submit]").click();
}
const persons = (db, table, owner) => db.rows(table).filter(r => !owner || r.owner === owner).map(r => r.person);

test.describe("Renaming a patient on this device", () => {
  test("the new name reaches the card, shifts, schedule and patient filter, and the color stays", async ({ openApp }) => {
    const app = await openApp({ sync: false });
    await app.addPatient({ name: "Mom" });
    await app.addPatient({ name: "Dad" });
    await app.addShift({ date: "2026-11-02", start: "09:00", end: "12:00", patient: "Mom" });
    await app.addToSchedule("weekly", { patient: "Mom", days: [3], start: "09:00", end: "13:00" });
    const colorBefore = await app.page.evaluate(() => patientColor("Mom"));

    await app.openCard("Mom");
    await rename(app, "Dad");                                          // taken
    await expect(app.$("#pcErr")).toHaveText("You already have a patient named Dad.");
    await rename(app, "  Mother  Smith ");
    await expect(app.$(".pcard").filter({ hasText: "Mother Smith" })).toHaveCount(1);
    await expect(app.$(".pcard").filter({ hasText: /^Mom/ })).toHaveCount(0);

    const state = await app.page.evaluate(() => ({
      shifts: shifts.map(s => s.person), sched: sched.map(e => e.person), cards: pcards.filter(c => !c.deleted).map(c => c.person).sort(),
      list: patientList(), color: patientColor("Mother Smith"),
    }));
    expect(state.shifts).toEqual(["Mother Smith"]);
    expect(state.sched).toEqual(["Mother Smith"]);
    expect(state.cards).toEqual(["Dad", "Mother Smith"]);
    expect(state.list).not.toContain("Mom");
    expect(state.color).toBe(colorBefore);

    // Still that way after reloading, and no card comes back for the old name.
    await app.reload();
    await app.openPatients();
    await expect(app.$(".pcard .pname b")).toHaveText(["Dad", "Mother Smith"]);
    await app.show("worked");
    await expect(app.shiftRows().first()).toContainText("Mother Smith");

    // A new patient can use the old name.
    await app.addPatient({ name: "Mom" });
    await app.openPatients();
    await expect(app.$(".pcard .pname b")).toHaveText(["Dad", "Mom", "Mother Smith"]);
    expect(await app.page.evaluate(() => new Set(pcards.map(c => c.id)).size)).toBe(3);
  });
});

test.describe("Renaming a patient online", () => {
  // Cynda set up Mom (client Pat) and logged a shift; Ann is on the card and logged one too.
  async function setup(openApp, db) {
    const cynda = await openApp();
    await cynda.signIn("cynda@example.com");
    await cynda.setName("Cynda B.");
    await cynda.addPatient(MOM);
    await cynda.addShift({ date: "2026-11-02", start: "09:00", end: "12:00", patient: "Mom" });
    await cynda.addToSchedule("weekly", { patient: "Mom", days: [3], start: "09:00", end: "13:00" });
    await cynda.waitSynced();
    await cynda.openCard("Mom");
    await invite(cynda, "ann@example.com");
    await expect(cynda.$("#pcMemberOk")).toBeVisible();
    const ann = await openApp();
    await ann.signIn("ann@example.com");
    await ann.setName("Ann L.");
    await ann.addShift({ date: "2026-11-03", start: "13:00", end: "15:00", patient: "Mom" });
    await ann.waitSynced();
    await expect.poll(() => db.rows("shares").filter(s => s.viewer_email === "pat@example.com").length).toBe(2);   // both share with Pat
    return { cynda, ann };
  }

  test("the client renames the patient for every caregiver on the card", async ({ openApp, db }) => {
    const { cynda, ann } = await setup(openApp, db);
    const pat = await openApp();
    await pat.signIn("pat@example.com");
    await expect(pat.weekTotal()).toHaveText("5h 00m");

    // Pat's Patients list on the Caregivers tab.
    await pat.openPatients();
    const mine = pat.$("#cpList .pcard").filter({ hasText: "Mom" });
    await mine.locator(".prow").click();
    await expect(pat.$("#pcDetails")).toHaveCount(1);                  // open in one list only
    await rename(pat, "Mother");
    await expect(pat.$("#pcErr")).toBeEmpty();
    await expect(pat.$("#cpList .pcard").filter({ hasText: "Mother" })).toHaveCount(1);

    expect(persons(db, "patients")).toEqual(["Mother"]);
    expect(persons(db, "shifts").sort()).toEqual(["Mother", "Mother"]);
    expect(persons(db, "schedule")).toEqual(["Mother"]);
    expect(persons(db, "shares").sort()).toEqual(["Mother", "Mother"]);
    await expect(pat.weekTotal()).toHaveText("5h 00m");               // Pat still sees both caregivers' hours

    // Each caregiver gets the new name, and no card comes back for the old one.
    for (const app of [cynda, ann]) {
      await app.reload();
      await app.show("worked");
      await expect(app.shiftRows().first()).toContainText("Mother");
      expect(await app.page.evaluate(() => patientList())).toEqual(["Mother"]);
    }
    await cynda.waitSynced();
    expect(persons(db, "patients")).toEqual(["Mother"]);
  });

  test("a caregiver on the card renames it; a name another of its caregivers uses is refused", async ({ openApp, db }) => {
    const { cynda, ann } = await setup(openApp, db);
    await ann.addPatient({ name: "Dad" });
    await ann.waitSynced();
    await ann.openCard("Mom");
    await rename(ann, "dad");
    await expect(ann.$("#pcErr")).toHaveText("You already have a patient named Dad.");
    // Cynda doesn't have a Dad, but Ann (on the card) does: the database refuses it.
    await cynda.openCard("Mom");
    await rename(cynda, "Dad");
    await expect(cynda.$("#pcErr")).toHaveText("A caregiver on this card already has another patient named Dad.");
    expect(persons(db, "patients", db.userId("cynda@example.com"))).toEqual(["Mom"]);

    await ann.reload();
    await ann.openCard("Mom");
    await rename(ann, "Grandma");
    await expect(ann.$("#pcDetails")).toContainText("Grandma");
    expect(persons(db, "shifts").sort()).toEqual(["Grandma", "Grandma"]);
  });

  test("before setup.sql version 10, renaming explains what's needed", async ({ openApp, db }) => {
    const cynda = await openApp();
    await cynda.signIn("cynda@example.com");
    await cynda.addPatient(MOM);
    await cynda.waitSynced();
    db.version = 9;
    await cynda.openCard("Mom");
    await rename(cynda, "Mother");
    await expect(cynda.$("#pcErr")).toHaveText("Changing a patient's name needs the latest database setup. Run setup.sql in Supabase (version 10), then try again.");
    expect(persons(db, "patients")).toEqual(["Mom"]);
    expect(await cynda.page.evaluate(() => pcards.map(c => c.person))).toEqual(["Mom"]);
  });
});

test.describe("A client's Patients list", () => {
  test("a client adds a patient, renames them, and adds a caregiver who can log shifts", async ({ openApp, db }) => {
    const pat = await openApp();
    await pat.signIn("pat@example.com");
    await pat.$("#acctRoleClient").check();
    await pat.$("#dispName").fill("Pat P.");
    await pat.$("#acctSave").click();
    await expect(pat.page.getByRole("tab")).toHaveText(["Care Hours", "Caregivers"]);
    await pat.openPatients();
    await expect(pat.$("#patientsBody")).toContainText("No patients yet. Add the person you arrange care for.");

    // + Add patient goes to the form on the Account Card.
    await pat.$("#cpAddPatient").click();
    await expect(pat.$("#apName")).toBeFocused();
    await pat.$("#apName").fill("Grandma");
    await pat.$("#apSave").click();
    await expect(pat.$("#cpList .pcard")).toHaveText([/Grandma/]);

    // Rename from the card.
    await pat.$("#cpList .prow").click();
    await rename(pat, "Grandma Jo");
    await expect(pat.$("#cpList .pcard")).toHaveText([/Grandma Jo/]);
    await expect.poll(() => persons(db, "patients")).toEqual(["Grandma Jo"]);

    // Rename again from the Account Card.
    await pat.$("#acctPatients .apcard").filter({ hasText: "Grandma Jo" }).getByRole("button", { name: "Edit" }).click();
    await expect(pat.$("#apName")).toHaveValue("Grandma Jo");
    await pat.$("#apName").fill("Jo");
    await pat.$("#apSave").click();
    await expect(pat.$("#cpList .pcard")).toHaveText([/Jo/]);
    await expect.poll(() => persons(db, "patients")).toEqual(["Jo"]);

    // Add a caregiver to her.
    if ((await pat.$("#cpList .prow").getAttribute("aria-expanded")) !== "true") await pat.$("#cpList .prow").click();
    await invite(pat, "ann@example.com");
    await expect(pat.$("#pcMemberOk")).toHaveText("ann@example.com can now see and edit Jo's card.");
    const ann = await openApp();
    await ann.signIn("ann@example.com");
    await ann.addShift({ date: "2026-11-02", start: "09:00", end: "11:00", patient: "Jo" });
    await ann.waitSynced();
    expect(db.rows("shifts")[0]).toMatchObject({ person: "Jo", owner: db.userId("ann@example.com") });
    // Ann shares her shifts for Jo with Pat, so Pat sees them.
    await pat.reload();
    await expect(pat.weekTotal()).toHaveText("2h 00m");
    await pat.openPatients();
    await expect(pat.$(".cgcard")).toHaveText([/Ann L\.|ann@example\.com/]);
  });
});
