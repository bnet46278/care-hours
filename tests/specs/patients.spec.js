// The Patients tab (Caregivers, for payers): Client Details and Patient Details, picking patients from the list, clients as their
// own records, requests to be added to a patient who's already in Care Hours, and several caregivers on one card.
// "Today" is Wednesday, Nov 4, 2026.
const { test, expect } = require("../support/fixtures");

const MOM = {
  name: "Mom", dob: "1944-03-03", address: "12 Elm St\nIndianapolis, IN 46278", email: "mom@example.com", phone: "317 555 0100",
  client: { name: "Pat P.", rel: "Son", address: "9 Oak Ave", email: "pat@example.com", phone: "317-555-0111" },
  notes: "Allergic to penicillin. Door code 4321.",
};
const row = (app, name) => app.$(".pcard").filter({ hasText: name });
const lineIn = (section, label) => section.locator(".pcline").filter({ hasText: label });

test.describe("Patients tab", () => {
  test("a caregiver sets up a client and patient, with notes", async ({ openApp }) => {
    const app = await openApp({ sync: false });
    await expect(app.page.getByRole("tab")).toHaveText(["Shifts", "Schedule", "Patients"]);
    await app.openPatients();
    await expect(app.$("#weekCard")).toBeHidden();   // the tab shows only the cards
    await expect(app.$("#clock")).toBeHidden();
    await app.$("#addPatient").click();
    await expect(app.$("#pcForm legend")).toHaveText(["Client Details", "Patient Details"]);
    await app.$("#pcDob").fill("1944-03-03");
    await expect(app.$("#pcAge")).toHaveText("Age 82");   // worked out as you type
    await app.$("#pcCancel").click();

    await app.addPatient(MOM);
    await expect(row(app, "Mom")).toContainText("Age 82 · Client: Pat P. (Son)");
    const d = app.$("#pcDetails");
    await expect(d.locator("h3")).toHaveText(["Client Details", "Patient Details", "Caregivers"]);
    await expect(lineIn(d, "Relationship to patient")).toContainText("Son");
    await expect(d.getByRole("link", { name: "pat@example.com" })).toHaveAttribute("href", "mailto:pat@example.com");
    await expect(d.getByRole("link", { name: "317-555-0111" })).toHaveAttribute("href", "tel:+13175550111");
    await expect(lineIn(d, "Date of birth")).toContainText("Mar 3, 1944 (age 82)");
    await expect(d).toContainText("12 Elm St\nIndianapolis, IN 46278");
    await expect(d.getByRole("link", { name: "317-555-0100" })).toHaveAttribute("href", "tel:+13175550100");
    await expect(d.getByRole("link", { name: "mom@example.com" })).toBeVisible();
    await expect(lineIn(d, "Notes")).toContainText("Allergic to penicillin. Door code 4321.");

    // Edit; the patient's name can't be changed here.
    await d.getByRole("button", { name: "Edit" }).click();
    await expect(app.$("#pcName")).toHaveCount(0);
    await expect(app.$("#pcClientName")).toHaveValue("Pat P.");
    await app.$("#pcNotes").fill("Allergic to penicillin.");
    await app.$("#pcClientAddress").fill("10 Oak Ave");
    await app.$("#pcSave").click();
    await expect(app.$("#pcDetails")).toContainText("10 Oak Ave");
    await expect(app.$("#pcDetails")).not.toContainText("Door code");

    // Kept on this device.
    await app.reload();
    await app.openCard("Mom");
    await expect(app.$("#pcDetails")).toContainText("Allergic to penicillin.");
    await expect(app.$("#pcDetails")).toContainText("10 Oak Ave");
    expect(await app.page.evaluate(() => pclients.length)).toBe(1);
  });

  test("“the patient is the client” fills Client Details with the patient's", async ({ openApp }) => {
    const app = await openApp({ sync: false });
    await app.openPatients();
    await app.$("#addPatient").click();
    await app.$("#pcClientName").fill("Someone else");
    await app.$("#pcName").fill("Dad");
    await app.$("#pcAddress").fill("5 Pine Rd");
    await app.$("#pcEmail").fill("dad@example.com");
    await app.$("#pcSame").check();
    await expect(app.$("#pcClientName")).toHaveValue("Dad");
    await expect(app.$("#pcClientRel")).toHaveValue("Self");
    await expect(app.$("#pcClientAddress")).toHaveValue("5 Pine Rd");
    await expect(app.$("#pcClientEmail")).toHaveValue("dad@example.com");
    await expect(app.$("#pcClientAddress")).toBeDisabled();
    await app.$("#pcAddress").fill("7 Pine Rd");                       // stays the same as the patient
    await expect(app.$("#pcClientAddress")).toHaveValue("7 Pine Rd");
    await app.$("#pcSame").uncheck();                                   // what was typed before comes back
    await expect(app.$("#pcClientName")).toHaveValue("Someone else");
    await expect(app.$("#pcClientAddress")).toBeEnabled();
    await app.$("#pcSame").check();
    await app.$("#pcSave").click();
    await expect(row(app, "Dad")).toContainText("Client: Dad (Self)");
    const d = app.$("#pcDetails");
    await expect(d).toContainText("Same as the patient");
    await expect(d.getByRole("link", { name: "dad@example.com" })).toHaveCount(2);   // in both sections
    const cl = await app.page.evaluate(() => pclients[0]);
    expect(cl).toMatchObject({ name: "Dad", address: "7 Pine Rd", email: "dad@example.com" });
  });

  test("the form explains what's missing", async ({ openApp }) => {
    const app = await openApp({ sync: false });
    await app.addPatient({ name: "Mom" });
    await app.openPatients();
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
    await tryAdd({ "#pcName": "Dad", "#pcClientEmail": "pat@" }, "Enter the client's full email address, like name@example.com.");
    await tryAdd({ "#pcName": "Dad", "#pcEmail": "dad@" }, "Enter the patient's full email address, like name@example.com.");
    await tryAdd({ "#pcName": "Dad", "#pcClientPhone": "555" }, "Enter the client's phone number with its area code, like 317-555-0123.");
    await expect(app.$(".pcard")).toHaveCount(1);
  });

  test("removing a patient takes them off the list, and their shifts stay", async ({ openApp }) => {
    const app = await openApp({ sync: false });
    await app.addShift({ date: "2026-11-02", start: "09:00", end: "12:00", patient: "Mom" });
    await app.openCard("Mom");
    await app.page.getByRole("button", { name: "Remove patient" }).click();
    await app.page.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(app.$(".pcard")).toHaveCount(0);
    await app.tab("Shifts");
    await expect(app.$("#personIn option")).toHaveText(["No patients yet. Add one first."]);
    await expect(app.shiftRows()).toContainText(["Mom"]);
    await app.shiftRows().first().locator("[data-act=edit]").click();
    await expect(app.$("#fPerson")).toHaveValue("Mom");   // an old shift still shows its patient
    await app.reload();
    await expect(app.$("#personIn option")).toHaveCount(1);   // a removed patient doesn't come back on their own
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
    await expect(app.$("#fPerson option")).toHaveText(["Choose a patient", "Dad", "Mom"]);
    await app.tab("Schedule");
    await app.$("[data-new=once]").click();
    await expect(app.$("#pPerson option")).toHaveText(["Choose a patient", "Dad", "Mom"]);
  });

  test("+ New patient from a form adds the patient right there and picks them", async ({ openApp }) => {
    const app = await openApp({ sync: false });
    await app.$("#addBtn").click();
    await app.$("#fDate").fill("2026-11-03");
    await app.$("#fStart").fill("09:00");
    await app.$("#fEnd").fill("11:00");
    await app.$('[data-add-patient="fPerson"]').click();
    await expect(app.page.getByRole("tab", { name: "Shifts" })).toHaveAttribute("aria-selected", "true");   // still on Shifts
    await app.$("#pcName").fill("Aunt Jo");
    await app.$("#pcSave").click();
    await expect(app.$("#pcForm")).toHaveCount(0);
    await expect(app.$("#fPerson")).toHaveValue("Aunt Jo");
    await expect(app.$("#fDate")).toHaveValue("2026-11-03");   // what was entered stays
    await app.$("#shiftForm button[type=submit]").click();
    await expect(app.shiftRows()).toContainText(["Aunt Jo"]);
  });

  test("patients already on shifts get a card, so they stay on the list", async ({ openApp }) => {
    const app = await openApp({ sync: false });
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

  test("cards saved before clients were their own records still show who pays", async ({ openApp }) => {
    const app = await openApp({ sync: false });
    await app.page.evaluate(() => localStorage.setItem("care-hours-patients-v1", JSON.stringify([
      { id: "p-mom", person: "Mom", payerName: "Pat P.", payerRel: "Son", payerEmail: "pat@example.com", payerPhone: "+13175550111", updatedAt: 1 },
    ])));
    await app.reload();
    await app.openCard("Mom");
    await expect(row(app, "Mom")).toContainText("Client: Pat P. (Son)");
    await expect(app.$("#pcDetails").getByRole("link", { name: "pat@example.com" })).toBeVisible();
    // Saving it once makes a proper client record.
    await app.$("#pcDetails").getByRole("button", { name: "Edit" }).click();
    await expect(app.$("#pcClientName")).toHaveValue("Pat P.");
    await app.$("#pcSave").click();
    expect(await app.page.evaluate(() => ({ n: pclients.length, linked: pcards[0].clientId === pclients[0].id }))).toEqual({ n: 1, linked: true });
  });
});

test.describe("Patients online", () => {
  async function cyndaWithMom(openApp) {
    const cynda = await openApp();
    await cynda.signIn("cynda@example.com");
    await cynda.setName("Cynda B.");
    await cynda.addPatient(MOM);
    await cynda.addShift({ date: "2026-11-02", start: "09:00", end: "12:00", patient: "Mom" });
    await cynda.waitSynced();
    return cynda;
  }

  test("cards and clients sync to the caregiver's other devices", async ({ openApp, db }) => {
    await cyndaWithMom(openApp);
    expect(db.rows("clients")).toHaveLength(1);
    expect(db.rows("clients")[0]).toMatchObject({ name: "Pat P.", email: "pat@example.com", phone: "+13175550111" });
    expect(db.rows("patients")[0]).toMatchObject({ person: "Mom", birth_date: "1944-03-03", phone: "+13175550100",
      payer_relationship: "Son", client_id: db.rows("clients")[0].id });
    const laptop = await openApp();
    await laptop.signIn("cynda@example.com");
    await laptop.waitSynced();
    await laptop.openPatients();
    await expect(row(laptop, "Mom")).toContainText("Age 82 · Client: Pat P. (Son)");
    expect(db.rows("patients")).toHaveLength(1);
    expect(db.rows("clients")).toHaveLength(1);
  });

  test("the client automatically gets the caregiver's shifts for that patient", async ({ openApp, db }) => {
    const cynda = await cyndaWithMom(openApp);
    expect(db.rows("shares").map(r => [r.viewer_email, r.person])).toEqual([["pat@example.com", "Mom"]]);
    const pat = await openApp();
    await pat.signIn("pat@example.com");
    await expect(pat.weekTotal()).toHaveText("3h 00m");

    // A new client email shares with them too; saving again doesn't add it twice.
    await cynda.openCard("Mom");
    await cynda.$("#pcDetails").getByRole("button", { name: "Edit" }).click();
    await cynda.$("#pcClientEmail").fill("joe@example.com");
    await cynda.$("#pcSave").click();
    await expect(cynda.$("#pcNotice")).toContainText("Mom's client, joe@example.com, can now see your shifts for Mom.");
    await cynda.$("#pcDetails").getByRole("button", { name: "Edit" }).click();
    await cynda.$("#pcSave").click();
    expect(db.rows("shares").map(r => r.viewer_email).sort()).toEqual(["joe@example.com", "pat@example.com"]);
  });

  test("the client sees and edits the card, and the caregiver gets the changes", async ({ openApp, db }) => {
    const cynda = await cyndaWithMom(openApp);
    const pat = await openApp();
    await pat.signIn("pat@example.com");
    await expect(pat.weekTotal()).toHaveText("3h 00m");
    // A client who pays (and logs no shifts) sees their caregivers, with each one's patients inside.
    await expect(pat.page.getByRole("tab")).toHaveText(["Shifts", "Schedule", "Caregivers"]);
    await pat.openPatients();
    await expect(pat.$("#patientsCard h2").first()).toHaveText("Caregivers");
    await expect(pat.$("#addPatient")).toHaveCount(0);   // clients don't add patients
    await expect(pat.$(".pcard:not(.cgcard)").filter({ hasText: "Mom" })).toContainText("Cynda B.'s card");
    await pat.openCard("Mom");
    await expect(pat.$("#pcDetails")).toContainText("Door code 4321");
    await expect(pat.page.getByRole("button", { name: "Remove patient" })).toHaveCount(0);

    await pat.$("#pcDetails").getByRole("button", { name: "Edit" }).click();
    await expect(pat.$("#pcName")).toHaveCount(0);
    await pat.$("#pcNotes").fill("Door code changed to 9876.");
    await pat.$("#pcClientAddress").fill("22 New St");
    await pat.$("#pcSave").click();
    await expect(pat.$("#pcDetails")).toContainText("Door code changed to 9876.");
    await expect(pat.$("#pcDetails")).toContainText("22 New St");
    expect(db.rows("patients")[0].notes).toBe("Door code changed to 9876.");
    expect(db.rows("clients")[0].address).toBe("22 New St");

    await cynda.reload();
    await cynda.waitSynced();
    await cynda.openCard("Mom");
    await expect(cynda.$("#pcDetails")).toContainText("Door code changed to 9876.");
    await expect(cynda.$("#pcDetails")).toContainText("22 New St");
  });

  test("a payer's Caregivers tab lists each caregiver with their details and patients", async ({ openApp }) => {
    const cynda = await cyndaWithMom(openApp);
    await cynda.$("#dispPhone").fill("317-555-0123");
    await cynda.$("#nameForm button").click();
    await expect(cynda.$("#nameForm")).toContainText("Saved.");
    const ann = await openApp();
    await ann.signIn("ann@example.com");
    await ann.setName("Ann L.");
    await ann.addPatient({ name: "Dad", dob: "1940-05-06", client: { name: "Pat P.", rel: "Son", email: "pat@example.com", phone: "317-555-0111" } });
    await ann.waitSynced();
    // Caregivers see the Patients tab.
    await expect(ann.page.getByRole("tab", { name: "Patients" })).toBeVisible();

    const pat = await openApp();
    await pat.signIn("pat@example.com");
    await expect(pat.weekTotal()).toHaveText("3h 00m");
    await pat.openPatients();
    const cgs = pat.$(".cgcard");
    await expect(cgs.locator(":scope > .prow")).toHaveText([/Ann L\.\s*Caring for Dad/, /Cynda B\.\s*Caring for Mom/]);
    await expect(pat.$(".cgdetails")).toHaveCount(0);   // closed until tapped

    const cyndaRow = cgs.filter({ hasText: "Cynda B." });
    await cyndaRow.locator(":scope > .prow").click();
    const details = cyndaRow.locator(".cgdetails");
    await expect(lineIn(details, "Email")).toContainText("cynda@example.com");
    await expect(lineIn(details, "Phone")).toContainText("317-555-0123");
    await expect(details.locator(".pcard")).toHaveText([/Mom/]);
    await details.locator(".pcard .prow").click();
    await expect(pat.$("#pcDetails")).toContainText("Allergic to penicillin.");

    // Opening another caregiver closes the first.
    await cgs.filter({ hasText: "Ann L." }).locator(":scope > .prow").click();
    await expect(pat.$(".cgdetails")).toHaveCount(1);
    await expect(pat.$(".cgdetails .pcard")).toHaveText([/Dad/]);
  });

  test("the database keeps cards and clients to the people on them", async ({ openApp, db }) => {
    await cyndaWithMom(openApp);
    const cyndaId = db.userId("cynda@example.com");
    const pat = await openApp();
    await pat.signIn("pat@example.com");
    const asPat = await pat.page.evaluate(async ({ owner, cid }) => {
      const c = window.supabase.createClient("x", "y", { auth: { storageKey: "care-hours-auth" } });
      return {
        rename: await c.from("patients").update({ person: "Someone else" }).eq("owner", owner),
        remove: await c.from("patients").update({ deleted: true }).eq("owner", owner),
        add: await c.from("patients").upsert({ owner, id: "p-new", person: "New" }),
        removeClient: await c.from("clients").update({ deleted: true }).eq("id", cid),
      };
    }, { owner: cyndaId, cid: db.rows("clients")[0].id });
    expect(asPat.rename.error.code).toBe("42501");
    expect(asPat.remove.error.code).toBe("42501");
    expect(asPat.add.error.code).toBe("42501");
    expect(asPat.removeClient.error.code).toBe("42501");

    const stranger = await openApp();
    await stranger.signIn("stranger@example.com");
    const seen = await stranger.page.evaluate(async () => {
      const c = window.supabase.createClient("x", "y", { auth: { storageKey: "care-hours-auth" } });
      return { patients: (await c.from("patients").select("*")).data, clients: (await c.from("clients").select("*")).data };
    });
    expect(seen).toEqual({ patients: [], clients: [] });
  });

  test("with an older setup.sql, cards still sync (and before version 6 they stay on the device)", async ({ openApp, db }) => {
    db.version = 7;   // no clients yet
    const cynda = await openApp();
    await cynda.signIn("cynda@example.com");
    await cynda.addPatient({ name: "Mom", client: { name: "Pat P.", email: "pat@example.com", phone: "317-555-0111" } });
    await cynda.waitSynced();
    await expect(cynda.$("#syncState")).not.toContainText("couldn't");
    expect(db.rows("patients")[0]).toMatchObject({ person: "Mom", payer_name: "Pat P.", payer_email: "pat@example.com" });

    db.version = 5;
    const old = await openApp();
    await old.signIn("ben@example.com");
    await old.addPatient({ name: "Dad", notes: "kept here" });
    await old.addShift({ date: "2026-11-02", start: "09:00", end: "12:00", patient: "Dad" });
    await old.waitSynced();
    await expect(old.$("#syncState")).not.toContainText("couldn't");
  });
});

test.describe("Clients already in Care Hours", () => {
  async function cyndaWithMom(openApp) {
    const cynda = await openApp();
    await cynda.signIn("cynda@example.com");
    await cynda.setName("Cynda B.");
    await cynda.addPatient(MOM);
    await cynda.waitSynced();
    return cynda;
  }

  test("a client with the same email and phone is linked, not added again", async ({ openApp, db }) => {
    await cyndaWithMom(openApp);
    const ann = await openApp();
    await ann.signIn("ann@example.com");
    await ann.addPatient({ name: "Grandpa", client: { name: "Patrick", rel: "Grandson", email: "PAT@example.com", phone: "(317) 555-0111" } });
    await ann.openPatients();
    await expect(ann.$("#pcNotice")).toContainText("Pat P. is already a client in Care Hours, so this patient is linked to that client.");
    await ann.waitSynced();
    expect(db.rows("clients")).toHaveLength(1);
    expect(db.rows("patients").map(p => p.client_id)).toEqual([db.rows("clients")[0].id, db.rows("clients")[0].id]);
    await expect(row(ann, "Grandpa")).toContainText("Client: Pat P. (Grandson)");   // the existing client's name, her relationship

    // Pat now has two patients, from two caregivers.
    const pat = await openApp();
    await pat.signIn("pat@example.com");
    await pat.openPatients();
    await expect(pat.$(".pcard")).toHaveCount(2);
  });

  test("the same caregiver's second patient for that client uses the same client", async ({ openApp, db }) => {
    const cynda = await cyndaWithMom(openApp);
    await cynda.addPatient({ name: "Dad", client: { name: "Pat P.", rel: "Son", email: "pat@example.com", phone: "317-555-0111" } });
    await cynda.waitSynced();
    expect(db.rows("clients")).toHaveLength(1);
    expect(new Set(db.rows("patients").map(p => p.client_id)).size).toBe(1);
  });

  test("a different phone or email makes a new client", async ({ openApp, db }) => {
    const cynda = await cyndaWithMom(openApp);
    await cynda.addPatient({ name: "Dad", client: { name: "Pat P.", email: "pat@example.com", phone: "317-555-0199" } });
    await cynda.addPatient({ name: "Jo", client: { name: "Pat P.", email: "pat2@example.com", phone: "317-555-0111" } });
    await cynda.waitSynced();
    expect(db.rows("clients")).toHaveLength(3);
  });
});

test.describe("Adding a patient who's already in Care Hours", () => {
  async function cyndaAndAnn(openApp) {
    const cynda = await openApp();
    await cynda.signIn("cynda@example.com");
    await cynda.setName("Cynda B.");
    await cynda.addPatient(MOM);
    await cynda.waitSynced();
    const ann = await openApp();
    await ann.signIn("ann@example.com");
    await ann.setName("Ann L.");
    return { cynda, ann };
  }

  test("the patient's client is asked, and the caregiver is added once they approve", async ({ openApp, db }) => {
    const { ann } = await cyndaAndAnn(openApp);
    await ann.addPatient({ name: " mom ", dob: "1944-03-03", phone: "(317) 555-0100", notes: "typed by Ann" });
    await ann.openPatients();
    await expect(ann.$("#pcNotice")).toHaveText("mom is already in Care Hours, so mom's client has been asked to approve adding you. You'll see mom here once they do.");
    await expect(ann.$(".pcard")).toHaveCount(0);   // no second card, and no access yet
    expect(db.rows("patients")).toHaveLength(1);
    expect(await ann.page.evaluate(() => pcards.length)).toBe(0);
    await expect(ann.$("#pcRequests")).toContainText("Waiting for the client to approve");
    await expect(ann.$("#pcRequests")).toContainText("mom · asked Nov 4");

    // Asking again doesn't send a second request.
    await ann.addPatient({ name: "Mom", dob: "1944-03-03", phone: "317-555-0100" });
    await ann.openPatients();
    await expect(ann.$("#pcNotice")).toHaveText("You've already asked to be added to Mom. You'll see Mom here once Mom's client approves.");
    expect(db.rows("patient_requests")).toHaveLength(1);

    // Pat, the client, approves.
    const pat = await openApp();
    await pat.signIn("pat@example.com");
    await pat.openPatients();
    await expect(pat.$("#pcRequests")).toContainText("Ann L. (ann@example.com) asked to be added as a caregiver for Mom");
    await pat.page.getByRole("button", { name: "Approve" }).click();
    await expect(pat.$("#pcNotice")).toHaveText("Ann L. can now see and edit the card and log shifts.");
    await expect(pat.$("#pcRequests")).toHaveCount(0);
    expect(db.rows("patient_members").map(m => m.member_email)).toEqual(["ann@example.com"]);

    // Ann sees Mom, can log shifts for her, and her shifts go to Pat automatically.
    await ann.reload();
    await ann.openPatients();
    await expect(row(ann, "Mom")).toContainText("Cynda B.'s card · shared with you");
    await expect(ann.$("#pcNotice")).toHaveText("Mom's client, pat@example.com, can now see your shifts for Mom.");
    await ann.addShift({ date: "2026-11-03", start: "08:00", end: "10:00", patient: "Mom" });
    await ann.waitSynced();
    await pat.reload();
    await expect(pat.weekTotal()).toHaveText("2h 00m");
  });

  test("the client can decline, and the caregiver can cancel", async ({ openApp, db }) => {
    const { ann } = await cyndaAndAnn(openApp);
    await ann.addPatient({ name: "Mom", dob: "1944-03-03", phone: "317-555-0100" });
    await ann.openPatients();
    await ann.page.getByRole("button", { name: "Cancel request" }).click();
    await expect(ann.$("#pcRequests")).toHaveCount(0);
    expect(db.rows("patient_requests")).toHaveLength(0);

    await ann.addPatient({ name: "Mom", dob: "1944-03-03", phone: "317-555-0100" });
    const pat = await openApp();
    await pat.signIn("pat@example.com");
    await pat.openPatients();
    await pat.$("[data-req-decline]").click();
    await expect(pat.$("#pcRequests")).toHaveCount(0);
    expect(db.rows("patient_requests")).toHaveLength(0);
    expect(db.rows("patient_members")).toHaveLength(0);
  });

  test("a different date of birth or phone makes a new patient", async ({ openApp, db }) => {
    const { ann } = await cyndaAndAnn(openApp);
    await ann.addPatient({ name: "Mom", dob: "1944-03-03", phone: "317-555-0199" });
    await ann.openPatients();
    await expect(row(ann, "Mom")).not.toContainText("Cynda B.'s card");
    expect(db.rows("patient_requests")).toHaveLength(0);
    await expect.poll(() => db.rows("patients").length).toBe(2);
  });

  test("only the patient's client can approve; others can't see requests", async ({ openApp, db }) => {
    const { ann } = await cyndaAndAnn(openApp);
    await ann.addPatient({ name: "Mom", dob: "1944-03-03", phone: "317-555-0100" });
    const cyndaId = db.userId("cynda@example.com"), annId = db.userId("ann@example.com");
    const self = await ann.page.evaluate(async ({ owner, me }) => {
      const c = window.supabase.createClient("x", "y", { auth: { storageKey: "care-hours-auth" } });
      return c.rpc("approve_patient_request", { the_owner: owner, the_id: "p-mom", the_requester: me });
    }, { owner: cyndaId, me: annId });
    expect(self.error.code).toBe("42501");
    const stranger = await openApp();
    await stranger.signIn("stranger@example.com");
    const seen = await stranger.page.evaluate(async () => {
      const c = window.supabase.createClient("x", "y", { auth: { storageKey: "care-hours-auth" } });
      return (await c.from("patient_requests").select("*")).data;
    });
    expect(seen).toEqual([]);
    expect(db.rows("patient_members")).toHaveLength(0);
  });
});

test.describe("Several caregivers on one card", () => {
  async function cyndaAndAnn(openApp) {
    const cynda = await openApp();
    await cynda.signIn("cynda@example.com");
    await cynda.setName("Cynda B.");
    await cynda.addPatient({ ...MOM, client: { name: "Pat P.", rel: "Son" } });   // no client email, so nothing is shared yet
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
    await invite(cynda, "ann@example.com");
    await expect(cynda.$("#pcMemberErr")).toHaveText("ann@example.com is already on this card.");

    await ann.reload();
    await ann.waitSynced();
    await ann.openPatients();
    await expect(row(ann, "Mom")).toContainText("Cynda B.'s card · shared with you");
    await ann.tab("Shifts");
    await expect(ann.$("#personIn option")).toHaveText(["Choose a patient", "Mom"]);
    await ann.clockIn("Mom");
    await expect(ann.$("#clock .status")).toHaveText("On the clock · Mom");
    await ann.clockOut();
    await ann.waitSynced();
    expect(await ann.page.evaluate(() => pcards.length)).toBe(0);

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
  });

  test("an added caregiver can leave, and the caregiver who set it up can remove them", async ({ openApp, db }) => {
    const { cynda, ann } = await cyndaAndAnn(openApp);
    await cynda.openCard("Mom");
    await invite(cynda, "ann@example.com");
    await expect(cynda.$("#pcMemberOk")).toBeVisible();
    await ann.reload();
    await ann.openCard("Mom");
    await ann.page.getByRole("button", { name: "Leave this card" }).click();
    await ann.page.getByRole("button", { name: "Leave", exact: true }).click();
    await expect(ann.$(".pcard")).toHaveCount(0);
    expect(db.rows("patient_members")).toHaveLength(0);

    await cynda.reload();
    await cynda.openCard("Mom");
    await invite(cynda, "ann@example.com");
    await expect(cynda.$("#pcCaregivers li")).toHaveCount(2);
    await cynda.$('[data-pc-unmember="ann@example.com"]').click();
    await cynda.$('[data-pc-unmember-yes="ann@example.com"]').click();
    await expect(cynda.$("#pcCaregivers li")).toHaveCount(1);
    expect(db.rows("patient_members")).toHaveLength(0);
  });

  test("a caregiver on the card adds another one; the client adds and removes them", async ({ openApp, db }) => {
    const cynda = await openApp();
    await cynda.signIn("cynda@example.com");
    await cynda.setName("Cynda B.");
    await cynda.addPatient(MOM);
    await cynda.waitSynced();
    const pat = await openApp();
    await pat.signIn("pat@example.com");
    await pat.openCard("Mom");
    await invite(pat, "ann@example.com");
    await expect(pat.$("#pcMemberOk")).toHaveText("ann@example.com can now see and edit Mom's card.");

    const ann = await openApp();
    await ann.signIn("ann@example.com");
    await ann.openCard("Mom");
    await invite(ann, "ben@example.com");
    await expect(ann.$("#pcCaregivers li")).toHaveText([/Cynda B\.\s*set up this card/, "You", "ben@example.com"]);

    await pat.reload();
    await pat.openCard("Mom");
    await expect(pat.$("#pcCaregivers li").first().locator("[data-pc-unmember]")).toHaveCount(0);   // not Cynda
    await pat.$('[data-pc-unmember="ben@example.com"]').click();
    await pat.$('[data-pc-unmember-yes="ben@example.com"]').click();
    await expect(pat.$("#pcCaregivers li")).toHaveCount(2);
    expect(db.rows("patient_members").map(m => m.member_email)).toEqual(["ann@example.com"]);
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
    await expect(ann.$(".pcard").first()).toContainText("also on Cynda B.'s card");
    await ann.$(".pcard").first().locator(".prow").click();
    await expect(ann.$("#pcDetails")).toContainText("Cynda B. also added you to their card for Mom. To keep just one card, remove yours");
    await ann.page.getByRole("button", { name: "Remove patient" }).click();
    await ann.page.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(ann.$(".pcard")).toHaveCount(1);
    await ann.tab("Shifts");
    await expect(ann.$("#personIn option")).toHaveText(["Choose a patient", "Mom"]);
  });

  test("the database keeps the caregivers list to the card's people", async ({ openApp, db }) => {
    const { cynda, ann } = await cyndaAndAnn(openApp);
    await cynda.openCard("Mom");
    await invite(cynda, "ann@example.com");
    await expect(cynda.$("#pcMemberOk")).toBeVisible();
    const cyndaId = db.userId("cynda@example.com");
    const asAnn = await ann.page.evaluate(async owner => {
      const c = window.supabase.createClient("x", "y", { auth: { storageKey: "care-hours-auth" } });
      const addOther = await c.from("patient_members").insert({ owner, id: "p-mom", member_email: "ben@example.com" });
      await c.from("patient_members").delete().eq("owner", owner).eq("member_email", "ben@example.com");   // not allowed
      return { addOther, rename: await c.from("patients").update({ person: "Grandma" }).eq("owner", owner) };
    }, cyndaId);
    expect(asAnn.addOther.error).toBeNull();
    expect(asAnn.rename.error.code).toBe("42501");
    expect(db.rows("patient_members").map(m => m.member_email).sort()).toEqual(["ann@example.com", "ben@example.com"]);
    const stranger = await openApp();
    await stranger.signIn("stranger@example.com");
    const seen = await stranger.page.evaluate(async owner => {
      const c = window.supabase.createClient("x", "y", { auth: { storageKey: "care-hours-auth" } });
      return {
        members: (await c.from("patient_members").select("*")).data,
        add: await c.from("patient_members").insert({ owner, id: "p-mom", member_email: "friend@example.com" }),
      };
    }, cyndaId);
    expect(seen.members).toEqual([]);
    expect(seen.add.error.code).toBe("42501");
  });

  test("before setup.sql version 7, adding a caregiver explains what's needed", async ({ openApp, db }) => {
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
