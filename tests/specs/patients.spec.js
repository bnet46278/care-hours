// Patient cards, and picking patients from the patient list everywhere.
// "Today" is Wednesday, Nov 4, 2026.
const { test, expect } = require("../support/fixtures");

const MOM = {
  name: "Mom", dob: "1944-03-03", address: "12 Elm St\nIndianapolis, IN 46278", email: "mom@example.com", phone: "317 555 0100",
  payer: { name: "Pat P.", rel: "Son", address: "9 Oak Ave", email: "pat@example.com", phone: "317-555-0111" },
  notes: "Allergic to penicillin. Door code 4321.",
};
const row = (app, name) => app.$(".pcard").filter({ hasText: name });

test.describe("Patient cards", () => {
  test("a caregiver sets up a patient with their details, payer and notes", async ({ openApp }) => {
    const app = await openApp({ sync: false });
    await expect(app.$("#patientsBody")).toBeHidden();   // collapsed until opened
    await app.$("#addPatient").click();
    await expect(app.$("#patientsBody")).toBeVisible();
    await app.$("#pcDob").fill("1944-03-03");
    await expect(app.$("#pcAge")).toHaveText("Age 82");   // worked out as you type
    await app.$("#pcCancel").click();

    await app.addPatient(MOM);
    await expect(row(app, "Mom")).toContainText("Age 82 · Payer: Pat P. (Son)");
    const d = app.$("#pcDetails");
    await expect(d.locator(".pcline").filter({ hasText: "Date of birth" })).toContainText("Mar 3, 1944 (age 82)");
    await expect(d).toContainText("12 Elm St\nIndianapolis, IN 46278");
    await expect(d.getByRole("link", { name: "mom@example.com" })).toHaveAttribute("href", "mailto:mom@example.com");
    await expect(d.getByRole("link", { name: "317-555-0100" })).toHaveAttribute("href", "tel:+13175550100");
    await expect(d.locator(".pcline").filter({ hasText: "Relationship" })).toContainText("Son");
    await expect(d.getByRole("link", { name: "317-555-0111" })).toBeVisible();
    await expect(d).toContainText("Allergic to penicillin. Door code 4321.");

    // Edit; the name can't be changed here.
    await d.getByRole("button", { name: "Edit" }).click();
    await expect(app.$("#pcName")).toHaveCount(0);
    await app.$("#pcNotes").fill("Allergic to penicillin.");
    await app.$("#pcSave").click();
    await expect(app.$("#pcDetails")).toContainText("Allergic to penicillin.");
    await expect(app.$("#pcDetails")).not.toContainText("Door code");

    // Kept on this device.
    await app.reload();
    await app.openCard("Mom");
    await expect(app.$("#pcDetails")).toContainText("Allergic to penicillin.");
  });

  test("“same info” fills the payer with the patient's details", async ({ openApp }) => {
    const app = await openApp({ sync: false });
    await app.$("#addPatient").click();
    await app.$("#pcName").fill("Dad");
    await app.$("#pcAddress").fill("5 Pine Rd");
    await app.$("#pcEmail").fill("dad@example.com");
    await app.$("#pcPayerName").fill("Someone else");
    await app.$("#pcSame").check();
    await expect(app.$("#pcPayerName")).toHaveValue("Dad");
    await expect(app.$("#pcPayerRel")).toHaveValue("Self");
    await expect(app.$("#pcPayerAddress")).toHaveValue("5 Pine Rd");
    await expect(app.$("#pcPayerEmail")).toHaveValue("dad@example.com");
    await expect(app.$("#pcPayerAddress")).toBeDisabled();
    await app.$("#pcAddress").fill("7 Pine Rd");                     // stays the same as the patient
    await expect(app.$("#pcPayerAddress")).toHaveValue("7 Pine Rd");
    await app.$("#pcSame").uncheck();                                 // what was typed before comes back
    await expect(app.$("#pcPayerName")).toHaveValue("Someone else");
    await expect(app.$("#pcPayerAddress")).toBeEnabled();
    await app.$("#pcSame").check();
    await app.$("#pcSave").click();
    await expect(row(app, "Dad")).toContainText("Pays for themselves");
    await expect(app.$("#pcDetails")).toContainText("Same as the patient");
    // Both sections show the same details.
    await expect(app.$("#pcDetails").getByRole("link", { name: "dad@example.com" })).toHaveCount(2);
    await expect(app.$("#pcDetails .pcline").filter({ hasText: "Relationship" })).toContainText("Self");
    const card = await app.page.evaluate(() => pcards.find(c => c.person === "Dad"));
    expect(card).toMatchObject({ payerSame: true, payerName: "Dad", payerRel: "Self", payerAddress: "7 Pine Rd", payerEmail: "dad@example.com" });
  });

  test("the form explains what's missing", async ({ openApp }) => {
    const app = await openApp({ sync: false });
    await app.addPatient({ name: "Mom" });
    const tryAdd = async (f, msg) => {
      await app.$("#addPatient").click();
      for (const [id, v] of Object.entries(f)) await app.$(id).fill(v);
      await app.$("#pcSave").click();
      await expect(app.$("#pcErr")).toHaveText(msg);
      await app.$("#pcCancel").click();
    };
    await tryAdd({}, "Enter the patient's name.");
    await tryAdd({ "#pcName": " mom " }, "You already have a patient named Mom.");
    await tryAdd({ "#pcName": "Dad", "#pcDob": "2027-01-01" }, "Enter a date of birth that isn't in the future.");
    await tryAdd({ "#pcName": "Dad", "#pcEmail": "dad@" }, "Enter the patient's full email address, like name@example.com.");
    await tryAdd({ "#pcName": "Dad", "#pcPayerPhone": "555" }, "Enter the payer's phone number with its area code, like 317-555-0123.");
    await expect(app.$(".pcard")).toHaveCount(1);
  });

  test("removing a patient takes them off the list, and their shifts stay", async ({ openApp }) => {
    const app = await openApp({ sync: false });
    await app.addShift({ date: "2026-11-02", start: "09:00", end: "12:00", patient: "Mom" });
    await app.openCard("Mom");
    await app.page.getByRole("button", { name: "Remove patient" }).click();
    await app.page.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(app.$(".pcard")).toHaveCount(0);
    await expect(app.$("#personIn option")).toHaveText(["No patients yet. Add one first."]);
    await expect(app.shiftRows()).toContainText(["Mom"]);
    // Editing that old shift still shows its patient.
    await app.shiftRows().first().locator("[data-act=edit]").click();
    await expect(app.$("#fPerson")).toHaveValue("Mom");
    // A removed patient doesn't come back on their own after reloading.
    await app.reload();
    await expect(app.$("#personIn option")).toHaveCount(1);
  });
});

test.describe("Picking patients", () => {
  test("patients are picked from the list, not typed", async ({ openApp }) => {
    const app = await openApp({ sync: false });
    await expect(app.$("#personIn")).toHaveJSProperty("tagName", "SELECT");
    await expect(app.$("#personIn option")).toHaveText(["No patients yet. Add one first."]);
    await app.addPatient({ name: "Mom" });
    await app.addPatient({ name: "Dad" });
    await expect(app.$("#personIn option")).toHaveText(["Choose a patient", "Dad", "Mom"]);
    await app.$("#addBtn").click();
    await expect(app.$("#fPerson")).toHaveJSProperty("tagName", "SELECT");
    await expect(app.$("#fPerson option")).toHaveText(["Choose a patient", "Dad", "Mom"]);
    await app.$("#shiftCancel, #shiftForm button[type=button]").first().click();
    await app.tab("Schedule");
    await app.$("[data-new=once]").click();
    await expect(app.$("#pPerson option")).toHaveText(["Choose a patient", "Dad", "Mom"]);
  });

  test("+ New patient from a form adds the patient and picks them", async ({ openApp }) => {
    const app = await openApp({ sync: false });
    await app.$("#addBtn").click();
    await app.$("#fDate").fill("2026-11-03");
    await app.$("#fStart").fill("09:00");
    await app.$("#fEnd").fill("11:00");
    await app.$('[data-add-patient="fPerson"]').click();
    await app.$("#pcName").fill("Aunt Jo");
    await app.$("#pcSave").click();
    await expect(app.$("#fPerson")).toHaveValue("Aunt Jo");
    await expect(app.$("#fDate")).toHaveValue("2026-11-03");   // what was entered stays
    await app.$("#shiftForm button[type=submit]").click();
    await expect(app.shiftRows()).toContainText(["Aunt Jo"]);
  });

  test("patients already on shifts get a card, so they stay on the list", async ({ openApp }) => {
    const app = await openApp({ sync: false });
    // Shifts saved before patient cards existed.
    await app.page.evaluate(() => {
      const t = new Date(2026, 10, 2, 9).getTime();
      localStorage.setItem("care-hours-shifts-v1", JSON.stringify([
        { id: "b", start: t - 7200000, end: t - 3600000, person: " mom ", note: "", updatedAt: t },
        { id: "a", start: t, end: t + 3600000, person: "Mom", note: "", updatedAt: t + 1 },   // the newest spelling wins
        { id: "c", start: t + 86400000, end: t + 90000000, person: "Grandpa", note: "", updatedAt: t + 2 },
      ]));
    });
    await app.reload();
    await expect(app.$("#personIn option")).toHaveText(["Choose a patient", "Grandpa", "Mom"]);
    await app.openPatients();
    await expect(app.$(".pcard")).toHaveCount(2);
  });
});

test.describe("Patient cards online", () => {
  async function cyndaWithMom(openApp) {
    const cynda = await openApp();
    await cynda.signIn("cynda@example.com");
    await cynda.setName("Cynda B.");
    await cynda.addPatient(MOM);
    await cynda.addShift({ date: "2026-11-02", start: "09:00", end: "12:00", patient: "Mom" });
    await cynda.share("Mom", "pat@example.com");
    await cynda.waitSynced();
    return cynda;
  }

  test("cards sync to the caregiver's other devices", async ({ openApp, db }) => {
    await cyndaWithMom(openApp);
    expect(db.rows("patients")).toHaveLength(1);
    expect(db.rows("patients")[0]).toMatchObject({ person: "Mom", birth_date: "1944-03-03", phone: "+13175550100", payer_relationship: "Son" });
    const laptop = await openApp();
    await laptop.signIn("cynda@example.com");
    await laptop.waitSynced();
    await laptop.openPatients();
    await expect(row(laptop, "Mom")).toContainText("Age 82 · Payer: Pat P. (Son)");
    await expect(laptop.$("#personIn option")).toHaveText(["Choose a patient", "Mom"]);
    expect(db.rows("patients")).toHaveLength(1);   // no second card for the same patient
  });

  test("a payer sees and edits the card, and the caregiver gets the changes", async ({ openApp, db }) => {
    const cynda = await cyndaWithMom(openApp);
    const pat = await openApp();
    await pat.signIn("pat@example.com");
    await expect(pat.weekTotal()).toHaveText("3h 00m");
    await expect(pat.$("#addPatient")).toHaveCount(0);   // payers can't add patients
    await pat.openPatients();
    await expect(row(pat, "Mom")).toContainText("Cynda B.'s card");
    await pat.openCard("Mom");
    await expect(pat.$("#pcDetails")).toContainText("Door code 4321");
    await expect(pat.page.getByRole("button", { name: "Remove patient" })).toHaveCount(0);

    await pat.$("#pcDetails").getByRole("button", { name: "Edit" }).click();
    await expect(pat.$("#pcName")).toHaveCount(0);
    await pat.$("#pcNotes").fill("Door code changed to 9876.");
    await pat.$("#pcSave").click();
    await expect(pat.$("#pcDetails")).toContainText("Door code changed to 9876.");
    expect(db.rows("patients")[0].notes).toBe("Door code changed to 9876.");

    await cynda.reload();
    await cynda.waitSynced();
    await cynda.openCard("Mom");
    await expect(cynda.$("#pcDetails")).toContainText("Door code changed to 9876.");
  });

  test("the database keeps cards to the caregiver and their payers", async ({ openApp, db }) => {
    await cyndaWithMom(openApp);
    const cyndaId = db.userId("cynda@example.com");
    const pat = await openApp();
    await pat.signIn("pat@example.com");
    const asPat = await pat.page.evaluate(async owner => {
      const c = window.supabase.createClient("x", "y", { auth: { storageKey: "care-hours-auth" } });
      return {
        rename: await c.from("patients").update({ person: "Someone else" }).eq("owner", owner),
        remove: await c.from("patients").update({ deleted: true }).eq("owner", owner),
        add: await c.from("patients").upsert({ owner, id: "p-new", person: "New" }),
      };
    }, cyndaId);
    expect(asPat.rename.error.code).toBe("42501");
    expect(asPat.remove.error.code).toBe("42501");
    expect(asPat.add.error.code).toBe("42501");

    const stranger = await openApp();
    await stranger.signIn("stranger@example.com");
    const seen = await stranger.page.evaluate(async () => {
      const c = window.supabase.createClient("x", "y", { auth: { storageKey: "care-hours-auth" } });
      return (await c.from("patients").select("*")).data;
    });
    expect(seen).toEqual([]);
    expect(db.rows("patients").map(r => [r.person, r.deleted])).toEqual([["Mom", false]]);
  });

  test("before running the new setup.sql, cards stay on the device with no sync error", async ({ openApp, db }) => {
    db.version = 5;
    const cynda = await openApp();
    await cynda.signIn("cynda@example.com");
    await cynda.addPatient({ name: "Mom", notes: "kept here" });
    await cynda.addShift({ date: "2026-11-02", start: "09:00", end: "12:00", patient: "Mom" });
    await cynda.waitSynced();
    await expect(cynda.$("#syncState")).not.toContainText("couldn't");
    expect(db.rows("shifts")).toHaveLength(1);
  });
});

test.describe("Patient cards shared by several caregivers", () => {
  async function cyndaAndAnn(openApp) {
    const cynda = await openApp();
    await cynda.signIn("cynda@example.com");
    await cynda.setName("Cynda B.");
    await cynda.addPatient({ ...MOM, payer: { name: "Pat P.", rel: "Son" } });   // no payer email, so nothing is shared yet
    await cynda.waitSynced();
    const ann = await openApp();
    await ann.signIn("ann@example.com");
    await ann.setName("Ann L.");
    return { cynda, ann };
  }
  async function invite(app, email) {
    await app.$("#pcInviteEmail").fill(email);
    await app.$("#pcInvite button[type=submit]").click();
  }

  test("the caregiver who set up a card adds another caregiver, who can edit it and log shifts", async ({ openApp, db }) => {
    const { cynda, ann } = await cyndaAndAnn(openApp);
    await cynda.openCard("Mom");
    await expect(cynda.$("#pcCaregivers li")).toHaveText([/You\s*set up this card/]);
    await invite(cynda, "ann@");
    await expect(cynda.$("#pcMemberErr")).toHaveText("Enter the caregiver's full email address, like name@example.com.");
    await invite(cynda, "cynda@example.com");
    await expect(cynda.$("#pcMemberErr")).toHaveText("That's your own email.");
    await invite(cynda, "Ann@Example.com");
    await expect(cynda.$("#pcMemberOk")).toHaveText("ann@example.com can now see and edit Mom's card.");
    await expect(cynda.$("#pcCaregivers li")).toHaveText([/You\s*set up this card/, /ann@example\.com\s*Remove/]);
    await invite(cynda, "ann@example.com");
    await expect(cynda.$("#pcMemberErr")).toHaveText("ann@example.com is already on this card.");

    // Ann sees Cynda's card, can pick Mom, and doesn't get a second card of her own.
    await ann.reload();
    await ann.waitSynced();
    await ann.openPatients();
    await expect(row(ann, "Mom")).toContainText("Cynda B.'s card · shared with you");
    await expect(ann.$("#personIn option")).toHaveText(["Choose a patient", "Mom"]);
    await ann.clockIn("Mom");
    await expect(ann.$("#clock .status")).toHaveText("On the clock · Mom");
    await ann.clockOut();
    await ann.waitSynced();
    expect(await ann.page.evaluate(() => pcards.length)).toBe(0);

    // She sees who's on it, can edit it, but can't remove the patient.
    await ann.openCard("Mom");
    await expect(ann.$("#pcCaregivers li")).toHaveText([/Cynda B\.\s*set up this card/, "You"]);
    await expect(ann.page.getByRole("button", { name: "Remove patient" })).toHaveCount(0);
    await expect(ann.$("#pcInvite")).toBeVisible();                           // she can add caregivers too...
    await expect(ann.$("#pcCaregivers [data-pc-unmember]")).toHaveCount(0);   // ...but not remove anyone
    await ann.$("#pcDetails").getByRole("button", { name: "Edit" }).click();
    await ann.$("#pcNotes").fill("Door code changed to 9876.");
    await ann.$("#pcSave").click();
    await expect(ann.$("#pcDetails")).toContainText("Door code changed to 9876.");
    expect(db.rows("patients").map(r => r.notes)).toEqual(["Door code changed to 9876."]);

    await cynda.reload();
    await cynda.waitSynced();
    await cynda.openCard("Mom");
    await expect(cynda.$("#pcDetails")).toContainText("Door code changed to 9876.");
  });

  test("a payer sees one card for the patient, through either caregiver", async ({ openApp }) => {
    const { cynda, ann } = await cyndaAndAnn(openApp);
    await cynda.openCard("Mom");
    await invite(cynda, "ann@example.com");
    await expect(cynda.$("#pcMemberOk")).toBeVisible();
    // Only Ann shares Mom with Pat.
    await ann.reload();
    await ann.waitSynced();
    await ann.addShift({ date: "2026-11-02", start: "09:00", end: "12:00", patient: "Mom" });
    await ann.share("Mom", "pat@example.com");
    await ann.waitSynced();
    const pat = await openApp();
    await pat.signIn("pat@example.com");
    await expect(pat.weekTotal()).toHaveText("3h 00m");
    await pat.openPatients();
    await expect(pat.$(".pcard")).toHaveCount(1);
    await expect(row(pat, "Mom")).toContainText("Cynda B.'s card");
    await expect(pat.$("#patientsBody")).not.toContainText("hasn't set up a card");
    // Cynda shares too: still one card.
    await cynda.share("Mom", "pat@example.com");
    await pat.reload();
    await pat.openPatients();
    await expect(pat.$(".pcard")).toHaveCount(1);
  });

  test("an added caregiver can leave, and the caregiver who set it up can remove them", async ({ openApp, db }) => {
    const { cynda, ann } = await cyndaAndAnn(openApp);
    await cynda.openCard("Mom");
    await invite(cynda, "ann@example.com");
    await expect(cynda.$("#pcMemberOk")).toBeVisible();
    await ann.reload();
    await ann.openCard("Mom");
    await ann.page.getByRole("button", { name: "Leave this card" }).click();
    await expect(ann.$("#pcDetails")).toContainText("Leave Cynda B.'s card for Mom?");
    await ann.page.getByRole("button", { name: "Leave", exact: true }).click();
    await expect(ann.$(".pcard")).toHaveCount(0);
    expect(db.rows("patient_members")).toHaveLength(0);

    await cynda.reload();
    await cynda.openCard("Mom");
    await expect(cynda.$("#pcCaregivers li")).toHaveCount(1);
    await invite(cynda, "ann@example.com");
    await expect(cynda.$("#pcCaregivers li")).toHaveCount(2);
    await cynda.$('[data-pc-unmember="ann@example.com"]').click();
    await cynda.$('[data-pc-unmember-yes="ann@example.com"]').click();
    await expect(cynda.$("#pcCaregivers li")).toHaveCount(1);
    expect(db.rows("patient_members")).toHaveLength(0);
  });

  test("a caregiver who already had their own card is told about the shared one", async ({ openApp }) => {
    const { cynda, ann } = await cyndaAndAnn(openApp);
    await ann.addPatient({ name: "mom", notes: "Ann's own notes" });
    await ann.waitSynced();
    await cynda.openCard("Mom");
    await invite(cynda, "ann@example.com");
    await expect(cynda.$("#pcMemberOk")).toBeVisible();

    await ann.reload();
    await ann.openPatients();
    await expect(ann.$(".pcard")).toHaveCount(2);
    await expect(ann.$("#personIn option")).toHaveText(["Choose a patient", "mom"]);   // one entry per patient
    await expect(ann.$(".pcard").first()).toContainText("also on Cynda B.'s card");
    await ann.$(".pcard").first().locator(".prow").click();
    await expect(ann.$("#pcDetails")).toContainText("Cynda B. also added you to their card for Mom. To keep just one card, remove yours");
    await ann.page.getByRole("button", { name: "Remove patient" }).click();
    await ann.page.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(ann.$(".pcard")).toHaveCount(1);
    await expect(ann.$(".pcard")).toContainText("Cynda B.'s card");
    await expect(ann.$("#personIn option")).toHaveText(["Choose a patient", "Mom"]);

    // Adding Mom again is caught.
    await ann.$("#addPatient").click();
    await ann.$("#pcName").fill("Mom");
    await ann.$("#pcSave").click();
    await expect(ann.$("#pcErr")).toHaveText("Cynda B. already shares a card for Mom with you.");
  });

  test("a caregiver on the card adds another caregiver; only the one who set it up removes them", async ({ openApp, db }) => {
    const { cynda, ann } = await cyndaAndAnn(openApp);
    await cynda.openCard("Mom");
    await invite(cynda, "ann@example.com");
    await expect(cynda.$("#pcMemberOk")).toBeVisible();
    await ann.reload();
    await ann.openCard("Mom");
    await invite(ann, "ben@example.com");
    await expect(ann.$("#pcMemberOk")).toHaveText("ben@example.com can now see and edit Mom's card.");
    await expect(ann.$("#pcCaregivers li")).toHaveText([/Cynda B\.\s*set up this card/, "You", "ben@example.com"]);

    const ben = await openApp();
    await ben.signIn("ben@example.com");
    await ben.openPatients();
    await expect(row(ben, "Mom")).toContainText("Cynda B.'s card · shared with you");

    await cynda.reload();
    await cynda.openCard("Mom");
    await cynda.$('[data-pc-unmember="ben@example.com"]').click();
    await cynda.$('[data-pc-unmember-yes="ben@example.com"]').click();
    await expect(cynda.$("#pcCaregivers li")).toHaveCount(2);
    expect(db.rows("patient_members").map(m => m.member_email)).toEqual(["ann@example.com"]);
  });

  test("the payer adds and removes caregivers, and added caregivers share their shifts with the payer", async ({ openApp, db }) => {
    const cynda = await openApp();
    await cynda.signIn("cynda@example.com");
    await cynda.setName("Cynda B.");
    await cynda.addPatient(MOM);   // the payer, pat@example.com, gets Cynda's shifts for Mom
    await cynda.waitSynced();
    const pat = await openApp();
    await pat.signIn("pat@example.com");
    await pat.openCard("Mom");
    await expect(pat.$("#pcCaregivers li")).toHaveText([/Cynda B\.\s*set up this card/]);
    await invite(pat, "ann@example.com");
    await expect(pat.$("#pcMemberOk")).toHaveText("ann@example.com can now see and edit Mom's card.");

    // Ann signs in: the card is there, and her shifts for Mom go to Pat automatically.
    const ann = await openApp();
    await ann.signIn("ann@example.com");
    await ann.setName("Ann L.");
    await ann.openPatients();
    await expect(ann.$("#pcNotice")).toHaveText("Mom's payer, pat@example.com, can now see your shifts for Mom.");
    expect(db.rows("shares").filter(r => r.owner === db.userId("ann@example.com")).map(r => [r.viewer_email, r.person])).toEqual([["pat@example.com", "Mom"]]);
    await ann.addShift({ date: "2026-11-03", start: "08:00", end: "10:00", patient: "Mom" });
    await ann.waitSynced();
    await pat.reload();
    await expect(pat.weekTotal()).toHaveText("2h 00m");

    // Pat removes Ann. Cynda, who set up the card, can't be removed.
    await pat.openCard("Mom");
    await expect(pat.$("#pcCaregivers li").first().locator("[data-pc-unmember]")).toHaveCount(0);
    await pat.$('[data-pc-unmember="ann@example.com"]').click();
    await pat.$('[data-pc-unmember-yes="ann@example.com"]').click();
    await expect(pat.$("#pcCaregivers li")).toHaveCount(1);
    expect(db.rows("patient_members")).toHaveLength(0);
  });

  test("the database keeps the caregivers list to the card's people", async ({ openApp, db }) => {
    const { cynda, ann } = await cyndaAndAnn(openApp);
    await cynda.openCard("Mom");
    await invite(cynda, "ann@example.com");
    await expect(cynda.$("#pcMemberOk")).toBeVisible();
    const cyndaId = db.userId("cynda@example.com");
    const asAnn = await ann.page.evaluate(async owner => {
      const c = window.supabase.createClient("x", "y", { auth: { storageKey: "care-hours-auth" } });
      return {
        addOther: await c.from("patient_members").insert({ owner, id: "p-mom", member_email: "ben@example.com" }),
        rename: await c.from("patients").update({ person: "Grandma" }).eq("owner", owner),
        removeCynda: await c.from("patients").update({ deleted: true }).eq("owner", owner),
      };
    }, cyndaId);
    expect(asAnn.addOther.error).toBeNull();          // a caregiver on the card can add another one
    expect(asAnn.rename.error.code).toBe("42501");
    expect(asAnn.removeCynda.error.code).toBe("42501");
    const stranger = await openApp();
    await stranger.signIn("stranger@example.com");
    const seen = await stranger.page.evaluate(async owner => {
      const c = window.supabase.createClient("x", "y", { auth: { storageKey: "care-hours-auth" } });
      return {
        members: (await c.from("patient_members").select("*")).data, cards: (await c.from("patients").select("*")).data,
        addSelf: await c.from("patient_members").insert({ owner, id: "p-mom", member_email: "friend@example.com" }),
      };
    }, cyndaId);
    expect(seen.members).toEqual([]);
    expect(seen.cards).toEqual([]);
    expect(seen.addSelf.error.code).toBe("42501");   // nobody outside the card can add anyone

    // Ann can't remove Ben (only Cynda or the payer can); she can only leave herself.
    await ann.page.evaluate(async owner => {
      const c = window.supabase.createClient("x", "y", { auth: { storageKey: "care-hours-auth" } });
      await c.from("patient_members").delete().eq("owner", owner).eq("member_email", "ben@example.com");
    }, cyndaId);
    expect(db.rows("patient_members").map(m => m.member_email).sort()).toEqual(["ann@example.com", "ben@example.com"]);
  });

  test("before running the new setup.sql, adding a caregiver explains what's needed", async ({ openApp, db }) => {
    db.version = 6;
    const cynda = await openApp();
    await cynda.signIn("cynda@example.com");
    await cynda.addPatient({ name: "Mom" });
    await cynda.waitSynced();
    await cynda.openCard("Mom");
    await invite(cynda, "ann@example.com");
    await expect(cynda.$("#pcMemberErr")).toHaveText("Adding caregivers to a card needs the latest setup.sql. Run it in Supabase, then try again.");
  });
});

test.describe("Adding a patient who's already in Care Hours", () => {
  async function cyndaWithMom(openApp) {
    const cynda = await openApp();
    await cynda.signIn("cynda@example.com");
    await cynda.setName("Cynda B.");
    await cynda.addPatient(MOM);
    await cynda.waitSynced();
    return cynda;
  }

  test("the payer on a new card automatically gets the caregiver's shifts for that patient", async ({ openApp, db }) => {
    const cynda = await cyndaWithMom(openApp);
    await expect(cynda.$("#pcNotice")).toHaveText("Mom's payer, pat@example.com, can now see your shifts for Mom.");
    expect(db.rows("shares").map(r => [r.viewer_email, r.person])).toEqual([["pat@example.com", "Mom"]]);
    await cynda.addShift({ date: "2026-11-02", start: "09:00", end: "12:00", patient: "Mom" });
    await cynda.waitSynced();
    const pat = await openApp();
    await pat.signIn("pat@example.com");
    await expect(pat.weekTotal()).toHaveText("3h 00m");

    // Changing the payer's email shares with the new payer; saving again doesn't add it twice.
    await cynda.openCard("Mom");
    await cynda.$("#pcDetails").getByRole("button", { name: "Edit" }).click();
    await cynda.$("#pcPayerEmail").fill("joe@example.com");
    await cynda.$("#pcSave").click();
    await expect(cynda.$("#pcNotice")).toContainText("Mom's payer, joe@example.com, can now see your shifts for Mom.");
    await cynda.$("#pcDetails").getByRole("button", { name: "Edit" }).click();
    await cynda.$("#pcSave").click();
    expect(db.rows("shares").map(r => r.viewer_email).sort()).toEqual(["joe@example.com", "pat@example.com"]);
  });

  test("a matching name, date of birth and phone isn't added again; the caregiver is told who can add them", async ({ openApp, db }) => {
    await cyndaWithMom(openApp);
    const ann = await openApp();
    await ann.signIn("ann@example.com");
    await ann.setName("Ann L.");
    await ann.addPatient({ name: " mom ", dob: "1944-03-03", phone: "(317) 555-0100", notes: "typed by Ann" });
    // Said with the name as she typed it, so nothing about the other card is shown.
    await expect(ann.$("#pcErr")).toHaveText("mom is already in Care Hours. Ask mom's payer or one of mom's caregivers to add you to the card.");
    await ann.$("#pcCancel").click();
    await expect(ann.$(".pcard")).toHaveCount(0);   // no second card, and she doesn't get Cynda's card on her own
    expect(db.rows("patients")).toHaveLength(1);
    expect(db.rows("patient_members")).toHaveLength(0);
    expect(await ann.page.evaluate(() => pcards.length)).toBe(0);
  });

  test("a different date of birth or phone, or a missing one, makes a new card", async ({ openApp, db }) => {
    await cyndaWithMom(openApp);
    const ann = await openApp();
    await ann.signIn("ann@example.com");
    await ann.addPatient({ name: "Mom", dob: "1944-03-03", phone: "317-555-0199" });
    await expect(ann.$("#pcNotice")).toHaveCount(0);   // no match, no payer email: nothing to report
    await expect(row(ann, "Mom")).not.toContainText("Cynda B.'s card");
    expect(db.rows("patient_members")).toHaveLength(0);
    const ben = await openApp();
    await ben.signIn("ben@example.com");
    await ben.addPatient({ name: "Mom", phone: "317 555 0100" });   // no date of birth
    expect(db.rows("patient_members")).toHaveLength(0);
    await expect.poll(() => db.rows("patients").length).toBe(3);
  });
});
