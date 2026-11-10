// The Account Card: name, address, phone and email, Caregiver or Client, and a client's Patient Details.
const { test, expect } = require("../support/fixtures");

// Fills in the Account Card and saves it. role: "Caregiver" | "Client" (or leave it as it is).
async function saveAccount(app, { role, name, address, phone } = {}) {
  if (role) await app.$(`#acctRole${role}`).check();
  if (name !== undefined) await app.$("#dispName").fill(name);
  if (address !== undefined) await app.$("#acctAddress").fill(address);
  if (phone !== undefined) await app.$("#dispPhone").fill(phone);
  await app.$("#acctSave").click();
  await expect(app.$("#nameForm")).toContainText("Saved.");
}
async function addMyPatient(app, { name, dob, address, phone, email, notes }) {
  await app.$("#acctAddPatient").click();
  await app.$("#apName").fill(name);
  if (dob) await app.$("#apDob").fill(dob);
  if (address) await app.$("#apAddress").fill(address);
  if (phone) await app.$("#apPhone").fill(phone);
  if (email) await app.$("#apEmail").fill(email);
  if (notes) await app.$("#apNotes").fill(notes);
  await app.$("#apSave").click();
}
const myPatientRow = (app, name) => app.$("#acctPatients .apcard").filter({ hasText: name });

test.describe("Account Card", () => {
  test("shows only when signed in, with the sign-in email that can't be changed", async ({ openApp, db }) => {
    const app = await openApp();
    await expect(app.$("#account")).toBeHidden();
    await app.signIn("cynda@example.com");
    await expect(app.$("#account h2")).toHaveText("Your account");
    await expect(app.$("#acctEmail")).toHaveText("cynda@example.com");
    await expect(app.$("#account input[type=email]")).toHaveCount(0);
    await expect(app.$("#acctPatients h3")).toHaveText("Your patients");   // a caregiver's list; Patient Details are for clients

    await saveAccount(app, { role: "Caregiver", name: "Cynda B.", address: "1 Main St\nIndianapolis", phone: "(317) 555-0123" });
    expect(db.rows("profiles")[0]).toMatchObject({ display_name: "Cynda B.", address: "1 Main St\nIndianapolis", phone: "+13175550123", role: "caregiver" });
    await expect(app.$("#account")).toContainText("Signed in as cynda@example.com · Caregiver");
    await expect(app.$("#clock")).toBeVisible();

    // It's all there after reloading.
    await app.reload();
    await expect(app.$("#acctRoleCaregiver")).toBeChecked();
    await expect(app.$("#dispName")).toHaveValue("Cynda B.");
    await expect(app.$("#acctAddress")).toHaveValue("1 Main St\nIndianapolis");
    await expect(app.$("#dispPhone")).toHaveValue("317-555-0123");
  });

  test("a client gets the payer side right away, and adds Patient Details", async ({ openApp, db }) => {
    const pat = await openApp();
    await pat.signIn("pat@example.com");
    await expect(pat.$("#clock")).toBeVisible();   // nobody shares with Pat yet, and no role picked

    // A client needs a name.
    await pat.$("#acctRoleClient").check();
    await pat.$("#acctSave").click();
    await expect(pat.$("#nameForm .err")).toHaveText("Enter your name. Your caregivers see it on your patients' cards.");
    await saveAccount(pat, { name: "Pat P.", address: "9 Elm St", phone: "317-555-0177" });
    expect(db.rows("profiles")[0]).toMatchObject({ role: "client", address: "9 Elm St" });
    await expect(pat.page.getByRole("tab")).toHaveText(["Care Hours", "Caregivers"]);
    for (const id of ["#clock", "#addBtn", "#sync"]) await expect(pat.$(id)).toBeHidden();
    await expect(pat.$("#acctPatients")).toContainText("No patients yet.");

    // Pat adds Mom.
    await addMyPatient(pat, { name: "Mom", dob: "1944-03-03", address: "5 Oak Ln", phone: "(317) 555-0100", email: "Mom@Example.com", notes: "Door code 4321" });
    await expect(myPatientRow(pat, "Mom")).toContainText("Age 82 · 317-555-0100");
    await expect(pat.$("#apForm")).toHaveCount(0);

    // Pat's details are her client record, and Mom is linked to it.
    await expect.poll(() => db.rows("patients").length).toBe(1);
    const patId = db.userId("pat@example.com");
    const client = db.rows("clients")[0];
    expect(client).toMatchObject({ owner: patId, name: "Pat P.", address: "9 Elm St", email: "pat@example.com", phone: "+13175550177" });
    expect(db.rows("patients")[0]).toMatchObject({ owner: patId, person: "Mom", birth_date: "1944-03-03", address: "5 Oak Ln",
      phone: "+13175550100", email: "mom@example.com", notes: "Door code 4321", client_id: client.id });

    // Editing a patient keeps the name and changes the rest.
    await myPatientRow(pat, "Mom").getByRole("button", { name: "Edit" }).click();
    await expect(pat.$("#apName")).toHaveCount(0);
    await pat.$("#apNotes").fill("Door code 9876");
    await pat.$("#apSave").click();
    await expect.poll(() => db.rows("patients")[0].notes).toBe("Door code 9876");

    // Saving the account again updates the client record; no second one is made.
    await saveAccount(pat, { address: "10 Elm St" });
    await expect.poll(() => db.rows("clients")[0].address).toBe("10 Elm St");
    expect(db.rows("clients")).toHaveLength(1);

    // A patient can't be added twice, and needs a name.
    await pat.$("#acctAddPatient").click();
    await pat.$("#apSave").click();
    await expect(pat.$("#apErr")).toHaveText("Enter the patient's name.");
    await pat.$("#apName").fill(" mom ");
    await pat.$("#apSave").click();
    await expect(pat.$("#apErr")).toHaveText("You already have a patient named Mom.");
    await pat.$("#apCancel").click();

    // Removing asks first.
    await myPatientRow(pat, "Mom").getByRole("button", { name: "Remove" }).click();
    await myPatientRow(pat, "Mom").locator("[data-ap-delyes]").click();
    await expect(pat.$("#acctPatients .apcard")).toHaveCount(0);
    await expect.poll(() => db.rows("patients")[0].deleted).toBe(true);
  });

  test("a caregiver who adds a client's patient is added once the client approves", async ({ openApp, db }) => {
    const pat = await openApp();
    await pat.signIn("pat@example.com");
    await saveAccount(pat, { role: "Client", name: "Pat P.", phone: "317-555-0177" });
    await addMyPatient(pat, { name: "Mom", dob: "1944-03-03", phone: "317-555-0100" });
    await expect.poll(() => db.rows("patients").length).toBe(1);

    // Cynda adds the same patient: no second card, and Pat is asked.
    const cynda = await openApp();
    await cynda.signIn("cynda@example.com");
    await cynda.setName("Cynda B.");
    await cynda.addPatient({ name: "Mom", dob: "1944-03-03", phone: "(317) 555-0100" });
    await cynda.openPatients();
    await expect(cynda.$("#pcNotice")).toContainText("Mom's client has been asked to approve adding you");
    expect(db.rows("patients")).toHaveLength(1);

    // Pat approves on her Caregivers tab.
    await pat.reload();
    await pat.openPatients();
    await expect(pat.$("#pcRequests")).toContainText("Cynda B. (cynda@example.com) asked to be added as a caregiver for Mom");
    await pat.page.getByRole("button", { name: "Approve" }).click();
    await expect(pat.$("#pcNotice")).toHaveText("Cynda B. can now see and edit the card and log shifts.");

    // Cynda sees Pat's card for Mom and logs a shift; it reaches Pat.
    await cynda.reload();
    await cynda.openPatients();
    await expect(cynda.$(".pcard").filter({ hasText: "Mom" })).toContainText("Pat P.'s card · shared with you");
    await cynda.addShift({ date: "2026-11-03", start: "08:00", end: "10:00", patient: "Mom" });
    await cynda.waitSynced();
    await pat.reload();
    await expect(pat.weekTotal()).toHaveText("2h 00m");
    // Pat's Caregivers tab shows Cynda, caring for Mom, with Pat's own card.
    await pat.openPatients();
    const cg = pat.$(".cgcard").filter({ hasText: "Cynda B." });
    await expect(cg).toContainText("Caring for Mom");
    await expect(cg.locator(".pcard:not(.cgcard)")).toHaveCount(1);
  });

  test("picking Caregiver or Client switches between the time clock and the payer side", async ({ openApp }) => {
    const cynda = await openApp();
    await cynda.signIn("cynda@example.com");
    await cynda.addShift({ date: "2026-11-02", start: "09:00", end: "12:00", patient: "Mom" });
    await cynda.share("Mom", "pat@example.com");
    await cynda.waitSynced();
    const pat = await openApp();
    await pat.signIn("pat@example.com");
    await expect(pat.page.getByRole("tab")).toHaveText(["Care Hours", "Caregivers"]);   // worked out from what's shared

    await saveAccount(pat, { role: "Caregiver" });
    await expect(pat.$("#clock")).toBeVisible();
    await expect(pat.page.getByRole("tab")).toHaveText(["Care Hours", "Caregivers", "Patients"]);
    await expect(pat.$("#sync")).toBeVisible();

    await saveAccount(pat, { role: "Client", name: "Pat P." });
    await expect(pat.$("#clock")).toBeHidden();
    await expect(pat.page.getByRole("tab")).toHaveText(["Care Hours", "Caregivers"]);
    await expect(pat.weekTotal()).toHaveText("3h 00m");
  });

  test("a name being typed survives the card redrawing", async ({ openApp }) => {
    const app = await openApp();
    await app.signIn("cynda@example.com");
    await app.$("#dispName").fill("Cynda B.");
    await app.$("#acctAddress").fill("1 Main St");
    await app.page.evaluate(() => renderAll());
    await expect(app.$("#dispName")).toHaveValue("Cynda B.");
    await expect(app.$("#acctAddress")).toHaveValue("1 Main St");
  });
});

test.describe("Account Card before running the new setup.sql", () => {
  test("a name and phone still save; address and role ask for the latest setup.sql", async ({ openApp, db }) => {
    db.version = 8;
    const app = await openApp();
    await app.signIn("cynda@example.com");
    await saveAccount(app, { name: "Cynda B.", phone: "317-555-0123" });
    expect(db.rows("profiles")[0]).toMatchObject({ display_name: "Cynda B.", phone: "+13175550123" });
    await app.$("#acctRoleClient").check();
    await app.$("#acctSave").click();
    await expect(app.$("#nameForm .err")).toHaveText("Saving your address, and whether you're a caregiver or a client, needs the latest setup.sql. Run it in Supabase, then try again.");
  });
});

test.describe("Account Card: caregivers add patients", () => {
  // Cynda, a caregiver, fills in the new-patient form on her Account Card. same: true | false | undefined (not answered).
  async function cgAddPatient(app, { name, dob, phone, email, same, clientEmail }) {
    await app.$("#acctAddPatient").click();
    await app.$("#apName").fill(name);
    if (dob) await app.$("#apDob").fill(dob);
    if (phone) await app.$("#apPhone").fill(phone);
    if (email) await app.$("#apEmail").fill(email);
    if (same === true) await app.$("#apSameYes").check();
    if (same === false) await app.$("#apSameNo").check();
    if (clientEmail) await app.$("#apClientEmail").fill(clientEmail);
    await app.$("#apSave").click();
  }
  async function cynda(openApp) {
    const app = await openApp();
    await app.signIn("cynda@example.com");
    await saveAccount(app, { role: "Caregiver", name: "Cynda B." });
    return app;
  }

  test("a patient who is their own client gets an email to set up their client account", async ({ openApp, db }) => {
    const app = await cynda(openApp);
    // The form asks; the patient's email is needed to invite them.
    await cgAddPatient(app, { name: "Mom" });
    await expect(app.$("#apErr")).toHaveText("Is the patient also the client? Pick Yes or No.");
    await app.$("#apSameYes").check();
    await expect(app.$("#apSameHint")).toBeVisible();
    await expect(app.$("#apClientWrap")).toBeHidden();
    await app.$("#apSave").click();
    await expect(app.$("#apErr")).toHaveText("Enter the patient's email, so they can set up their client account.");
    await app.$("#apEmail").fill("Mom@Example.com");
    await app.$("#apSave").click();

    await expect(app.$("#acctNotice")).toHaveText("Mom is added. We emailed mom@example.com an invitation to set up their client account.");
    await expect(app.$("#acctPatients .apcard").filter({ hasText: "Mom" })).toContainText("Is their own client");
    expect(db.emails).toEqual([{ to: "mom@example.com", kind: "invite", person: "Mom" }]);
    expect(db.rows("shares")).toMatchObject([{ viewer_email: "mom@example.com", person: "Mom" }]);
    await expect.poll(() => db.rows("patients").length).toBe(1);
    expect(db.rows("patients")[0]).toMatchObject({ person: "Mom", payer_same: true, email: "mom@example.com" });
    // It's on the Patients tab too; Open goes there.
    await app.$("#acctPatients [data-ap-open]").click();
    await expect(app.$("#pcDetails")).toContainText("Same as the patient");
  });

  test("another client gets the email, and is set up as a client when they sign in", async ({ openApp, db }) => {
    const app = await cynda(openApp);
    await cgAddPatient(app, { name: "Mom", dob: "1944-03-03", phone: "317-555-0100", same: false });
    await expect(app.$("#apErr")).toHaveText("Enter the client's full email address, like name@example.com.");
    await app.$("#apClientEmail").fill("pat@example.com");
    await app.$("#apSave").click();
    await expect(app.$("#acctNotice")).toHaveText("Mom is added. We emailed pat@example.com an invitation to set up their client account.");
    await expect(app.$("#acctPatients .apcard").filter({ hasText: "Mom" })).toContainText("Client: pat@example.com");
    expect(db.emails).toEqual([{ to: "pat@example.com", kind: "invite", person: "Mom" }]);
    await app.addShift({ date: "2026-11-03", start: "08:00", end: "10:00", patient: "Mom" });
    await app.waitSynced();
    expect(db.rows("clients")).toMatchObject([{ email: "pat@example.com", phone: "" }]);

    // Pat signs in: Client is picked for her, with a note. Saving sets her up and fills in her client record.
    const pat = await openApp();
    await pat.signIn("pat@example.com");
    await expect(pat.$("#acctInvited")).toHaveText("A caregiver added you as a client in Care Hours. Check your details, then tap Save.");
    await expect(pat.$("#acctRoleClient")).toBeChecked();
    await saveAccount(pat, { name: "Pat P.", phone: "317-555-0177" });
    expect(db.rows("profiles").find(r => r.email === "pat@example.com").role).toBe("client");
    await expect(pat.$("#acctInvited")).toHaveCount(0);
    await expect.poll(() => db.rows("clients")[0]).toMatchObject({ name: "Pat P.", phone: "+13175550177" });
    expect(db.rows("clients")).toHaveLength(1);
    await expect(pat.weekTotal()).toHaveText("2h 00m");
  });

  test("a client who already uses Care Hours gets a short email instead of an invitation", async ({ openApp, db }) => {
    const pat = await openApp();
    await pat.signIn("pat@example.com");
    const app = await cynda(openApp);
    await cgAddPatient(app, { name: "Dad", same: false, clientEmail: "pat@example.com" });
    await expect(app.$("#acctNotice")).toHaveText("Dad is added. pat@example.com already uses Care Hours, so we emailed them that you added Dad.");
    expect(db.emails).toEqual([{ to: "pat@example.com", kind: "notice", person: "Dad" }]);
  });

  test("without the email function, the caregiver is told to ask the client to sign in", async ({ openApp, db }) => {
    db.functions = false;
    const app = await cynda(openApp);
    await cgAddPatient(app, { name: "Dad", same: false, clientEmail: "pat@example.com" });
    await expect(app.$("#acctNotice")).toHaveText("Dad is added. We couldn't email pat@example.com. Ask them to sign in to Care Hours with that email to set up their client account.");
    expect(db.rows("shares")).toHaveLength(1);   // Pat still gets the shifts
  });

  test("a patient who's already in Care Hours: their client is asked, emailed, and sees a badge", async ({ openApp, db }) => {
    const pat = await openApp();
    await pat.signIn("pat@example.com");
    await saveAccount(pat, { role: "Client", name: "Pat P." });
    await addMyPatient(pat, { name: "Mom", dob: "1944-03-03", phone: "317-555-0100" });
    await expect.poll(() => db.rows("patients").length).toBe(1);

    const app = await cynda(openApp);
    await cgAddPatient(app, { name: "Mom", dob: "1944-03-03", phone: "(317) 555-0100", same: false, clientEmail: "someone@example.com" });
    await expect(app.$("#acctNotice")).toHaveText("Mom is already in Care Hours, so Mom's client has been asked to approve adding you. We emailed them too.");
    expect(db.rows("patients")).toHaveLength(1);
    expect(db.emails).toEqual([{ to: "pat@example.com", kind: "request", person: "Mom" }]);

    // Pat sees a badge on her Caregivers tab, from any tab, and approves there.
    await pat.reload();
    await expect(pat.$("#peopleBadge")).toHaveText("1");
    await expect(pat.$("#tabPeople")).toHaveAttribute("aria-label", "Caregivers, 1 waiting for your approval");
    await pat.openPatients();
    await pat.page.getByRole("button", { name: "Approve" }).click();
    await expect(pat.$("#peopleBadge")).toBeHidden();
  });
});
