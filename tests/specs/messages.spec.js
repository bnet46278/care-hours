// Messages between caregivers and payers, and the Text button.
// There's no Messages tab: caregivers open a conversation from the patient's card (Patients tab),
// and payers from the caregiver's card (Caregivers tab). Either tab shows the unread count.
const { test, expect } = require("../support/fixtures");

// Cynda cares for Mom and shares her with Pat, who pays.
async function cyndaAndPat(openApp) {
  const cynda = await openApp();
  await cynda.signIn("cynda@example.com");
  await cynda.setName("Cynda B.");
  await cynda.addShift({ date: "2026-11-02", start: "09:00", end: "12:00", patient: "Mom" });
  await cynda.share("Mom", "pat@example.com");
  await cynda.waitSynced();
  const pat = await openApp();
  await pat.signIn("pat@example.com");
  await pat.setName("Pat P.");
  await expect(pat.weekTotal()).toHaveText("3h 00m");
  return { cynda, pat };
}
// Caregivers: one person's row in the Messages section of the open patient card.
const msgRowOn = (app, name) => app.$("#pcDetails .cgmsg").filter({ hasText: name });
async function openChat(app, name, patient = "Mom") {
  await app.openCard(patient);
  await msgRowOn(app, name).locator("[data-msg-open]").click();
  await expect(app.$(".chathead h2")).toHaveText(name);
}
// Payers: the Message button on the caregiver's card.
async function openCgChat(app, name) {
  await app.openPatients();
  await app.$(".cgcard").filter({ hasText: name }).locator("[data-msg-open]").click();
  await expect(app.$(".chathead h2")).toHaveText(name);
}
async function send(app, text) {
  await app.$("#msgBody").fill(text);
  await app.$("#msgSend").click();
}
const noMessagesTab = app => expect(app.page.getByRole("tab", { name: /Messages/ })).toHaveCount(0);

test.describe("Messages", () => {
  test("a payer and a caregiver message each other, and new messages show up right away", async ({ openApp, db }) => {
    const { cynda, pat } = await cyndaAndPat(openApp);

    // Pat writes first.
    await openCgChat(pat, "Cynda B.");
    await expect(pat.$(".chathead")).toContainText("Caring for Mom");
    await expect(pat.$("#msgThread")).toContainText("No messages with Cynda B. yet");
    await send(pat, "Can you stay until 6 on Friday?");
    await expect(pat.$(".bubble.mine")).toHaveText(/Can you stay until 6 on Friday\?/);
    await expect(pat.$("#msgBody")).toHaveValue("");

    // Cynda is on her Shifts tab and sees the unread count on the Patients tab without reloading.
    await expect(cynda.$("#tabPeople")).toHaveAttribute("aria-label", "Patients, 1 unread");
    await expect(cynda.$("#peopleBadge")).toHaveText("1");
    await cynda.openCard("Mom");
    const row = msgRowOn(cynda, "Pat P.");
    await expect(row).toContainText("Can you stay until 6 on Friday?");
    await expect(row.locator(".badge")).toHaveText("1");

    // Opening the conversation marks it read, for Cynda and in the database.
    await row.locator("[data-msg-open]").click();
    await expect(cynda.$(".bubble.theirs")).toContainText("Can you stay until 6 on Friday?");
    await expect(cynda.$("#peopleBadge")).toBeHidden();
    await expect(cynda.$("#tabPeople")).toHaveAttribute("aria-label", "Patients");
    await expect.poll(() => db.rows("messages")[0].read_at).not.toBeNull();

    // Cynda answers; Pat's open conversation updates, and shows her message was read.
    await send(cynda, "Yes, I can.");
    await expect(pat.$(".bubble.theirs")).toContainText("Yes, I can.");
    await expect(pat.$(".bubble.mine .meta")).toContainText("Read");
    await expect(pat.$("#peopleBadge")).toBeHidden();   // read right away, because the conversation is open

    const rows = db.rows("messages");
    expect(rows.map(r => r.body)).toEqual(["Can you stay until 6 on Friday?", "Yes, I can."]);
    expect(rows[0].sender).toBe(db.userId("pat@example.com"));
    expect(rows[0].recipient).toBe(db.userId("cynda@example.com"));
  });

  test("a caregiver can start the conversation with a payer from the patient's card", async ({ openApp }) => {
    const { cynda, pat } = await cyndaAndPat(openApp);
    await cynda.openCard("Mom");
    await expect(cynda.$("#pcDetails")).toContainText("Messages");
    await expect(msgRowOn(cynda, "Pat P.")).toContainText("No messages with Pat P. yet.");
    await openChat(cynda, "Pat P.");
    await expect(cynda.$(".chathead")).toContainText("Sees Mom");
    await send(cynda, "Mom had a good day today.");
    await expect(cynda.$(".bubble.mine")).toContainText("Mom had a good day today.");
    await expect(pat.$("#peopleBadge")).toHaveText("1");
    await openCgChat(pat, "Cynda B.");
    await expect(pat.$(".bubble.theirs")).toContainText("Mom had a good day today.");
  });

  test("a payer sees and opens a caregiver's messages from the Caregivers tab", async ({ openApp }) => {
    const { cynda, pat } = await cyndaAndPat(openApp);
    await pat.openPatients();
    const card = pat.$(".cgcard").filter({ hasText: "Cynda B." });   // the only caregiver, so it's open
    await expect(card.locator(".cgmsg")).toContainText("No messages with Cynda B. yet.");

    // Cynda writes while Pat is on the Caregivers tab: the card shows it, unread.
    await openChat(cynda, "Pat P.");
    await send(cynda, "Mom napped after lunch.");
    await expect(card.locator(".cgmsg")).toContainText("Mom napped after lunch.");
    const btn = card.locator("[data-msg-open]");
    await expect(btn).toHaveAttribute("aria-label", "Message Cynda B., 1 unread");
    // The unread count is on the Caregivers tab, since there's no Messages tab.
    await expect(pat.page.getByRole("tab")).toHaveText(["Shifts", "Schedule", "Caregivers1"]);
    await expect(pat.$("#peopleBadge")).toHaveText("1");
    await expect(pat.$("#tabPeople")).toHaveAttribute("aria-label", "Caregivers, 1 unread");

    // Message opens the conversation with Cynda (Caregivers stays the selected tab) and marks it read.
    await btn.click();
    await expect(pat.$("#msgs")).toBeVisible();
    await expect(pat.$("#tabPeople")).toHaveAttribute("aria-selected", "true");
    await expect(pat.$(".chathead h2")).toHaveText("Cynda B.");
    await expect(pat.$(".bubble.theirs")).toContainText("Mom napped after lunch.");
    await expect(pat.$("#peopleBadge")).toBeHidden();
    await expect(pat.$("#tabPeople")).toHaveAttribute("aria-label", "Caregivers");

    // Back returns to the Caregivers tab, with Cynda's card still open.
    await expect(pat.$("#msgBack")).toHaveText("‹ Caregivers");
    await pat.$("#msgBack").click();
    await expect(pat.$("#msgs")).toBeHidden();
    await expect(card.locator(".cgmsg")).toContainText("Mom napped after lunch.");
  });

  test("there's no Messages tab; a conversation hides the hours, and the other tabs bring them back", async ({ openApp }) => {
    const { cynda, pat } = await cyndaAndPat(openApp);
    await expect(cynda.page.getByRole("tab")).toHaveText(["Shifts", "Schedule", "Patients"]);
    await expect(pat.page.getByRole("tab")).toHaveText(["Shifts", "Schedule", "Caregivers"]);
    await openChat(cynda, "Pat P.");
    await expect(cynda.$("#msgs")).toBeVisible();
    await expect(cynda.$("#tabPeople")).toHaveAttribute("aria-selected", "true");
    for (const id of ["#weekCard", "#clock", "#logSection", "#byCaregiver", "#patientsCard"]) await expect(cynda.$(id)).toBeHidden();
    await expect(cynda.$("#foot")).toHaveText("Only you and the person you're writing to can read your messages.");

    // Back returns to the Patients tab, with Mom's card still open.
    await expect(cynda.$("#msgBack")).toHaveText("‹ Patients");
    await cynda.$("#msgBack").click();
    await expect(cynda.$("#msgs")).toBeHidden();
    await expect(msgRowOn(cynda, "Pat P.")).toBeVisible();

    await openChat(cynda, "Pat P.");
    await cynda.tab("Shifts");
    await expect(cynda.$("#weekCard")).toBeVisible();
    await expect(cynda.$("#msgs")).toBeHidden();
  });

  test("a message that can't be sent stays in the box", async ({ openApp, db }) => {
    const { pat } = await cyndaAndPat(openApp);
    await openCgChat(pat, "Cynda B.");
    await pat.$("#msgSend").click();
    await expect(pat.$("#msgErr")).toHaveText("Type a message first.");

    await pat.goOffline();
    await send(pat, "Running late, sorry");
    await expect(pat.$("#msgErr")).toContainText("Not sent.");
    await expect(pat.$("#msgBody")).toHaveValue("Running late, sorry");
    expect(db.rows("messages")).toHaveLength(0);

    await pat.goOnline();
    await pat.$("#msgSend").click();
    await expect(pat.$(".bubble.mine")).toContainText("Running late, sorry");
    await expect(pat.$("#msgErr")).toHaveText("");
  });

  test("a half-written message is kept while switching tabs", async ({ openApp }) => {
    const { pat } = await cyndaAndPat(openApp);
    await openCgChat(pat, "Cynda B.");
    await pat.$("#msgBody").fill("About next week");
    await pat.tab("Shifts");
    await openCgChat(pat, "Cynda B.");
    await expect(pat.$("#msgBody")).toHaveValue("About next week");
    await pat.$("#msgBack").click();
    await expect(pat.$(".cgcard")).toHaveCount(1);
  });

  test("a payer who hasn't signed in yet is listed on the card, but can't get messages yet", async ({ openApp }) => {
    const cynda = await openApp();
    await cynda.signIn("cynda@example.com");
    await cynda.share("Mom", "new-payer@example.com");
    await cynda.openCard("Mom");
    const row = msgRowOn(cynda, "new-payer@example.com");
    await expect(row).toContainText("Hasn't signed in to Care Hours yet");
    await expect(row.locator("[data-msg-open]")).toHaveCount(0);
  });

  test("a patient shared with nobody has no Messages section", async ({ openApp }) => {
    const { cynda } = await cyndaAndPat(openApp);
    await cynda.addPatient({ name: "Dad" });
    await cynda.openCard("Dad");
    await expect(cynda.$("#pcDetails .cgmsg")).toHaveCount(0);
    await cynda.openCard("Mom");
    await expect(msgRowOn(cynda, "Pat P.")).toHaveCount(1);
    const stranger = await openApp();
    await stranger.signIn("stranger@example.com");
    await stranger.settle();
    await noMessagesTab(stranger);
    await expect(stranger.$("#peopleBadge")).toBeHidden();
  });

  test("removing the share removes the conversation", async ({ openApp }) => {
    const { cynda, pat } = await cyndaAndPat(openApp);
    await cynda.openCard("Mom");
    await expect(msgRowOn(cynda, "Pat P.")).toHaveCount(1);
    await cynda.tab("Shifts");
    await cynda.$('[data-unshare="mom|pat@example.com"]').click();
    await cynda.$("[data-unshare-yes]").click();
    await cynda.settle();
    await cynda.openCard("Mom");
    await expect(cynda.$("#pcDetails .cgmsg")).toHaveCount(0);
    await pat.reload();
    await expect(pat.$("#account")).toContainText("Signed in as");
    await pat.settle();
    await expect(pat.$("[data-msg-open]")).toHaveCount(0);
  });

  test("the database keeps messages private and unchangeable", async ({ openApp, db }) => {
    const { cynda, pat } = await cyndaAndPat(openApp);
    await openCgChat(pat, "Cynda B.");
    await send(pat, "Private note");
    await expect(pat.$(".bubble.mine")).toBeVisible();
    const cyndaId = db.userId("cynda@example.com"), patId = db.userId("pat@example.com");

    // Someone with no share can't read it or send to Cynda.
    const stranger = await openApp();
    await stranger.signIn("stranger@example.com");
    const asStranger = await stranger.page.evaluate(async to => {
      const c = window.supabase.createClient("x", "y", { auth: { storageKey: "care-hours-auth" } });
      return { read: await c.from("messages").select("*"), send: await c.from("messages").insert({ recipient: to, body: "hi" }) };
    }, cyndaId);
    expect(asStranger.read.data).toEqual([]);
    expect(asStranger.send.error.code).toBe("42501");

    // Pat can't pretend to be someone else, rewrite a message, or delete one.
    const asPat = await pat.page.evaluate(async ({ to, from }) => {
      const c = window.supabase.createClient("x", "y", { auth: { storageKey: "care-hours-auth" } });
      return {
        forged: await c.from("messages").insert({ recipient: to, body: "forged", sender: from }),
        edit: await c.from("messages").update({ body: "changed" }).eq("recipient", to),
        del: await c.from("messages").delete().eq("recipient", to),
      };
    }, { to: cyndaId, from: cyndaId });
    expect(asPat.forged.error.code).toBe("42501");
    expect(asPat.edit.error.code).toBe("42501");
    expect(asPat.del.error.code).toBe("42501");
    expect(db.rows("messages").map(r => r.body)).toEqual(["Private note"]);
    expect(db.rows("messages")[0].sender).toBe(patId);
  });
});

test.describe("Text button", () => {
  test("a saved mobile number gives the other person a Text button", async ({ openApp, db }) => {
    const { cynda, pat } = await cyndaAndPat(openApp);
    await cynda.$("#dispPhone").fill("555");
    await cynda.$("#nameForm button").click();
    await expect(cynda.$("#nameForm .err")).toHaveText("Enter a phone number with its area code, like 317-555-0123.");
    await cynda.$("#dispPhone").fill("(317) 555-0123");
    await cynda.$("#nameForm button").click();
    await expect(cynda.$("#nameForm")).toContainText("Saved.");
    await expect(cynda.$("#dispPhone")).toHaveValue("317-555-0123");
    expect(db.rows("profiles").find(r => r.email === "cynda@example.com").phone).toBe("+13175550123");

    // Pat sees the Text button on Cynda's card and in the conversation; it opens the phone's Messages app.
    await pat.reload();
    await pat.openPatients();
    const text = pat.$(".cgcard").filter({ hasText: "Cynda B." }).getByRole("link", { name: /Text Cynda B\./ });
    await expect(text).toHaveAttribute("href", "sms:+13175550123");
    await pat.$("[data-msg-open]").click();
    const textIt = pat.page.getByRole("link", { name: "Send as a text to Cynda B." });
    await expect(textIt).toHaveAttribute("href", "sms:+13175550123");

    // What's typed in the box goes along, so Text opens Messages with it filled in.
    await pat.$("#msgBody").fill("Running 10 min late & sorry!");
    await expect(textIt).toHaveAttribute("href", "sms:+13175550123?&body=Running%2010%20min%20late%20%26%20sorry!");
    await expect(pat.$("#msgCompose")).toContainText("tap Send there");
    await pat.$("#msgSend").click();   // sending in the app clears the box, and the Text link with it
    await expect(pat.$(".bubble.mine")).toContainText("Running 10 min late & sorry!");
    await expect(textIt).toHaveAttribute("href", "sms:+13175550123");

    // Pat hasn't added a number, so Cynda has nothing to tap yet, and the conversation says why.
    await openChat(cynda, "Pat P.");
    await expect(cynda.$("#msgText")).toHaveCount(0);
    await expect(cynda.$("#msgCompose")).toContainText("To text Pat P. instead, they need to add their mobile number");
    await cynda.$("#msgBack").click();
    await expect(msgRowOn(cynda, "Pat P.").locator("a.textbtn")).toHaveCount(0);
    // Payers can add their number on the account card.
    await pat.$("#dispPhone").fill("317 555 0199");
    await pat.$("#nameForm button").click();
    await expect(pat.$("#nameForm")).toContainText("Saved.");
    await cynda.reload();
    await cynda.openCard("Mom");
    await expect(msgRowOn(cynda, "Pat P.").locator("a.textbtn")).toHaveAttribute("href", "sms:+13175550199");
  });
});

test.describe("Before running the new setup.sql", () => {
  test("the app works as before, with no messages", async ({ openApp, db }) => {
    db.version = 3;   // a database set up with the previous setup.sql
    const cynda = await openApp();
    await cynda.signIn("cynda@example.com");
    await cynda.setName("Cynda B.");   // the name still saves
    expect(db.rows("profiles")[0].display_name).toBe("Cynda B.");
    await cynda.share("Mom", "pat@example.com");
    await cynda.settle();
    await noMessagesTab(cynda);
    await cynda.openCard("Mom");
    await expect(cynda.$("#pcDetails .cgmsg")).toHaveCount(0);
    await cynda.tab("Shifts");
    await cynda.$("#dispPhone").fill("317-555-0123");
    await cynda.$("#nameForm button").click();
    await expect(cynda.$("#nameForm .err")).toHaveText("Saving a mobile number needs the latest setup.sql. Run it in Supabase, then try again.");
  });
});
