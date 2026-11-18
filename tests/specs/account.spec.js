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
// A patient Pat added herself, as clients could before the Account Card lost its Patient Details.
async function addMyPatient(app, { name, dob, phone }) {
  await app.page.evaluate(async p => {
    const cl = await ensureMyClient();
    putCard({ id: freshCardId(p.name), person: p.name, birthDate: p.dob || null, phone: p.phone ? normPhone(p.phone) : "", clientId: cl.id, updatedAt: 0 });
  }, { name, dob, phone });
}

test.describe("Account Card", () => {
  test("shows only when signed in, with the sign-in email that can't be changed", async ({ openApp, db }) => {
    const app = await openApp();
    await expect(app.$("#account")).toBeHidden();
    await app.signIn("cynda@example.com");
    await expect(app.$("#account h2")).toHaveText("Your account");
    await expect(app.$("#acctEmail")).toHaveText("cynda@example.com");
    await expect(app.$("#account input[type=email]")).toHaveCount(0);
    await expect(app.$("#acctPatients")).toHaveCount(0);   // caregivers' patients are on the Patients tab; Patient Details are for clients

    await saveAccount(app, { role: "Caregiver", name: "Cynda B.", address: "1 Main St\nIndianapolis", phone: "(317) 555-0123" });
    expect(db.rows("profiles")[0]).toMatchObject({ display_name: "Cynda B.", address: "1 Main St\nIndianapolis", phone: "+13175550123", role: "caregiver" });
    await expect(app.$("#account")).toContainText("Signed in as cynda@example.com · Caregiver");
    await expect(app.$("#clock")).toBeVisible();

    // It's all there after reloading.
    await app.reload();
    await expect(app.$("#acctRoleFixed")).toHaveText("Caregiver");
    await expect(app.$("#account input[type=radio]")).toHaveCount(0);   // can't be changed once saved
    await expect(app.$("#dispName")).toHaveValue("Cynda B.");
    await expect(app.$("#acctAddress")).toHaveValue("1 Main St\nIndianapolis");
    await expect(app.$("#dispPhone")).toHaveValue("317-555-0123");
  });

  test("a client gets the payer side right away, and their details become their client record", async ({ openApp, db }) => {
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
    await expect(pat.$("#acctPatients")).toHaveCount(0);   // no patient list on the Account Card
    await expect(pat.$("#acctAddPatient")).toHaveCount(0);

    const patId = db.userId("pat@example.com");
    await expect.poll(() => db.rows("clients").length).toBe(1);
    expect(db.rows("clients")[0]).toMatchObject({ owner: patId, name: "Pat P.", address: "9 Elm St", email: "pat@example.com", phone: "+13175550177" });

    // Saving the account again updates the client record; no second one is made.
    await saveAccount(pat, { address: "10 Elm St" });
    await expect.poll(() => db.rows("clients")[0].address).toBe("10 Elm St");
    expect(db.rows("clients")).toHaveLength(1);
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

  test("Caregiver or Client is picked once: after saving it can't be changed", async ({ openApp, db }) => {
    const cynda = await openApp();
    await cynda.signIn("cynda@example.com");
    await cynda.addShift({ date: "2026-11-02", start: "09:00", end: "12:00", patient: "Mom" });
    await cynda.share("Mom", "pat@example.com");
    await cynda.waitSynced();
    const pat = await openApp();
    await pat.signIn("pat@example.com");
    await expect(pat.page.getByRole("tab")).toHaveText(["Care Hours", "Caregivers"]);   // worked out from what's shared
    await expect(pat.$("#account .rolepick")).toContainText("You can't change this after you save.");

    // Before saving, the pick can still change.
    await pat.$("#acctRoleCaregiver").check();
    await pat.$("#acctRoleClient").check();
    await saveAccount(pat, { name: "Pat P." });
    expect(db.rows("profiles").find(r => r.email === "pat@example.com").role).toBe("client");
    await expect(pat.$("#acctRoleFixed")).toHaveText("Client");
    await expect(pat.$("#account input[type=radio]")).toHaveCount(0);
    await expect(pat.$("#clock")).toBeHidden();
    await expect(pat.page.getByRole("tab")).toHaveText(["Care Hours", "Caregivers"]);
    await expect(pat.weekTotal()).toHaveText("3h 00m");

    // Saving again keeps it, and so does reloading.
    await saveAccount(pat, { address: "9 Elm St" });
    expect(db.rows("profiles").find(r => r.email === "pat@example.com")).toMatchObject({ role: "client", address: "9 Elm St" });
    await pat.reload();
    await expect(pat.$("#acctRoleFixed")).toHaveText("Client");
  });

  test("the Account Card is the last card on the page, for caregivers and clients", async ({ openApp }) => {
    const lastCard = app => app.page.evaluate(() => {
      const shown = [...document.querySelectorAll(".wrap > section, .wrap > aside, main > section, main > aside, body section, body aside")]
        .filter(el => el.offsetParent !== null && el.getBoundingClientRect().height > 0);
      return shown.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top).pop().id;
    });
    const cynda = await openApp();
    await cynda.signIn("cynda@example.com");
    await saveAccount(cynda, { role: "Caregiver", name: "Cynda B." });
    for (const tab of ["Care Hours", "Patients"]) {
      await cynda.tab(tab);
      expect(await lastCard(cynda)).toBe("account");
    }
    const pat = await openApp();
    await pat.signIn("pat@example.com");
    await saveAccount(pat, { role: "Client", name: "Pat P." });
    for (const tab of ["Care Hours", "Caregivers"]) {
      await pat.tab(tab);
      expect(await lastCard(pat)).toBe("account");
    }
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

test.describe("Caregivers add patients: the client is emailed", () => {
  // Cynda, a caregiver, adds patients on the Patients tab.
  async function cynda(openApp) {
    const app = await openApp();
    await app.signIn("cynda@example.com");
    await saveAccount(app, { role: "Caregiver", name: "Cynda B." });
    return app;
  }
  const notice = async app => { await app.openPatients(); return app.$("#pcNotice"); };

  test("a caregiver's Account Card has no patient list", async ({ openApp }) => {
    const app = await cynda(openApp);
    await app.addPatient({ name: "Mom" });
    await expect(app.$("#acctPatients")).toHaveCount(0);
    await expect(app.$("#acctAddPatient")).toHaveCount(0);
  });

  test("a patient who is their own client gets an email to set up their client account", async ({ openApp, db }) => {
    const app = await cynda(openApp);
    await app.addPatient({ name: "Mom", email: "Mom@Example.com", same: true });
    await expect(await notice(app)).toContainText("We emailed mom@example.com an invitation to set up their client account.");
    expect(db.emails).toEqual([{ to: "mom@example.com", kind: "invite", person: "Mom" }]);
    expect(db.rows("shares")).toMatchObject([{ viewer_email: "mom@example.com", person: "Mom" }]);
    await expect.poll(() => db.rows("patients").length).toBe(1);
    expect(db.rows("patients")[0]).toMatchObject({ person: "Mom", payer_same: true, email: "mom@example.com" });
  });

  test("another client gets the email, and is set up as a client when they sign in", async ({ openApp, db }) => {
    const app = await cynda(openApp);
    await app.addPatient({ name: "Mom", dob: "1944-03-03", phone: "317-555-0100", client: { email: "pat@example.com" } });
    await expect(await notice(app)).toContainText("We emailed pat@example.com an invitation to set up their client account.");
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
    await app.addPatient({ name: "Dad", client: { email: "pat@example.com" } });
    await expect(await notice(app)).toContainText("pat@example.com already uses Care Hours, so we emailed them that you added Dad.");
    expect(db.emails).toEqual([{ to: "pat@example.com", kind: "notice", person: "Dad" }]);
  });

  test("without the email function, the caregiver is told to ask the client to sign in", async ({ openApp, db }) => {
    db.functions = false;
    const app = await cynda(openApp);
    await app.addPatient({ name: "Dad", client: { email: "pat@example.com" } });
    await expect(await notice(app)).toContainText("We couldn't email pat@example.com. Ask them to sign in to Care Hours with that email to set up their client account.");
    expect(db.rows("shares")).toHaveLength(1);   // Pat still gets the shifts
  });

  test("a patient who's already in Care Hours: their client is asked, emailed, and sees a badge", async ({ openApp, db }) => {
    const pat = await openApp();
    await pat.signIn("pat@example.com");
    await saveAccount(pat, { role: "Client", name: "Pat P." });
    await addMyPatient(pat, { name: "Mom", dob: "1944-03-03", phone: "317-555-0100" });
    await expect.poll(() => db.rows("patients").length).toBe(1);

    const app = await cynda(openApp);
    await app.addPatient({ name: "Mom", dob: "1944-03-03", phone: "(317) 555-0100", client: { email: "someone@example.com" } });
    await expect(await notice(app)).toContainText("Mom is already in Care Hours, so Mom's client has been asked to approve adding you.");
    await expect(app.$("#pcNotice")).toContainText("We emailed them too.");
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
