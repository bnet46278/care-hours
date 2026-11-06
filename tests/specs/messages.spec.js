// Messages between caregivers and payers, and the Text button.
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
const msgTab = app => app.page.getByRole("tab", { name: /^Messages/ });
async function openChat(app, name) {
  await msgTab(app).click();
  await app.$(".contact").filter({ hasText: name }).locator("[data-chat]").click();
  await expect(app.$(".chathead h2")).toHaveText(name);
}
async function send(app, text) {
  await app.$("#msgBody").fill(text);
  await app.$("#msgSend").click();
}

test.describe("Messages", () => {
  test("a payer and a caregiver message each other, and new messages show up right away", async ({ openApp, db }) => {
    const { cynda, pat } = await cyndaAndPat(openApp);

    // Pat writes first.
    await openChat(pat, "Cynda B.");
    await expect(pat.$(".chathead")).toContainText("Caring for Mom");
    await expect(pat.$("#msgThread")).toContainText("No messages with Cynda B. yet");
    await send(pat, "Can you stay until 6 on Friday?");
    await expect(pat.$(".bubble.mine")).toHaveText(/Can you stay until 6 on Friday\?/);
    await expect(pat.$("#msgBody")).toHaveValue("");

    // Cynda is on her Shifts tab and sees the unread count without reloading.
    await expect(msgTab(cynda)).toHaveAttribute("aria-label", "Messages, 1 unread");
    await expect(cynda.$("#msgBadge")).toHaveText("1");
    await msgTab(cynda).click();
    const row = cynda.$(".contact").filter({ hasText: "Pat P." });
    await expect(row).toContainText("Sees Mom");
    await expect(row).toContainText("Can you stay until 6 on Friday?");
    await expect(row.locator(".badge")).toHaveText("1");

    // Opening the conversation marks it read, for Cynda and in the database.
    await row.locator("[data-chat]").click();
    await expect(cynda.$(".bubble.theirs")).toContainText("Can you stay until 6 on Friday?");
    await expect(cynda.$("#msgBadge")).toBeHidden();
    await expect(msgTab(cynda)).toHaveAttribute("aria-label", "Messages");
    await expect.poll(() => db.rows("messages")[0].read_at).not.toBeNull();

    // Cynda answers; Pat's open conversation updates, and shows her message was read.
    await send(cynda, "Yes, I can.");
    await expect(pat.$(".bubble.theirs")).toContainText("Yes, I can.");
    await expect(pat.$(".bubble.mine .meta")).toContainText("Read");
    await expect(pat.$("#msgBadge")).toBeHidden();   // read right away, because the conversation is open

    const rows = db.rows("messages");
    expect(rows.map(r => r.body)).toEqual(["Can you stay until 6 on Friday?", "Yes, I can."]);
    expect(rows[0].sender).toBe(db.userId("pat@example.com"));
    expect(rows[0].recipient).toBe(db.userId("cynda@example.com"));
  });

  test("a caregiver can start the conversation with a payer", async ({ openApp }) => {
    const { cynda, pat } = await cyndaAndPat(openApp);
    await openChat(cynda, "Pat P.");
    await expect(cynda.$(".chathead")).toContainText("Sees Mom");
    await send(cynda, "Mom had a good day today.");
    await expect(cynda.$(".bubble.mine")).toContainText("Mom had a good day today.");
    await expect(pat.$("#msgBadge")).toHaveText("1");
    await openChat(pat, "Cynda B.");
    await expect(pat.$(".bubble.theirs")).toContainText("Mom had a good day today.");
  });

  test("the Messages tab hides the hours, and the other tabs bring them back", async ({ openApp }) => {
    const { cynda } = await cyndaAndPat(openApp);
    await expect(cynda.page.getByRole("tab")).toHaveText(["Shifts", "Schedule", "Messages"]);
    await msgTab(cynda).click();
    await expect(cynda.$("#msgs")).toBeVisible();
    for (const id of ["#weekCard", "#clock", "#logSection", "#byCaregiver"]) await expect(cynda.$(id)).toBeHidden();
    await expect(cynda.$("#foot")).toHaveText("Only you and the person you're writing to can read your messages.");
    await cynda.tab("Shifts");
    await expect(cynda.$("#weekCard")).toBeVisible();
    await expect(cynda.$("#msgs")).toBeHidden();
  });

  test("a message that can't be sent stays in the box", async ({ openApp, db }) => {
    const { pat } = await cyndaAndPat(openApp);
    await openChat(pat, "Cynda B.");
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
    await openChat(pat, "Cynda B.");
    await pat.$("#msgBody").fill("About next week");
    await pat.tab("Shifts");
    await msgTab(pat).click();
    await expect(pat.$("#msgBody")).toHaveValue("About next week");
    await pat.$("#msgBack").click();
    await expect(pat.$(".contact")).toHaveCount(1);
  });

  test("a payer who hasn't signed in yet is listed, but can't get messages yet", async ({ openApp }) => {
    const cynda = await openApp();
    await cynda.signIn("cynda@example.com");
    await cynda.share("Mom", "new-payer@example.com");
    await msgTab(cynda).click();
    const row = cynda.$(".contact").filter({ hasText: "new-payer@example.com" });
    await expect(row).toContainText("Hasn't signed in to Care Hours yet");
    await expect(row.locator("[data-chat]")).toHaveCount(0);
  });

  test("people with no share between them get no Messages tab", async ({ openApp }) => {
    await cyndaAndPat(openApp);
    const stranger = await openApp();
    await stranger.signIn("stranger@example.com");
    await stranger.settle();
    await expect(stranger.$("#tabMsgs")).toBeHidden();
    const solo = await openApp({ sync: false });
    await expect(solo.$("#tabMsgs")).toBeHidden();
  });

  test("removing the share removes the conversation", async ({ openApp }) => {
    const { cynda, pat } = await cyndaAndPat(openApp);
    await msgTab(cynda).click();
    await expect(cynda.$(".contact")).toHaveCount(1);
    await cynda.$('[data-unshare="mom|pat@example.com"]').click();
    await cynda.$("[data-unshare-yes]").click();
    await expect(cynda.$("#tabMsgs")).toBeHidden();
    await expect(cynda.$("#weekCard")).toBeVisible();   // back on Shifts
    await pat.reload();
    await expect(pat.$("#sync")).toContainText("Signed in as");
    await pat.settle();
    await expect(pat.$("#tabMsgs")).toBeHidden();
  });

  test("the database keeps messages private and unchangeable", async ({ openApp, db }) => {
    const { cynda, pat } = await cyndaAndPat(openApp);
    await openChat(pat, "Cynda B.");
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
    await expect(cynda.$("#nameForm .err")).toHaveText("Enter a mobile number with its area code, like 317-555-0123.");
    await cynda.$("#dispPhone").fill("(317) 555-0123");
    await cynda.$("#nameForm button").click();
    await expect(cynda.$("#nameForm")).toContainText("Saved.");
    await expect(cynda.$("#dispPhone")).toHaveValue("317-555-0123");
    expect(db.rows("profiles").find(r => r.email === "cynda@example.com").phone).toBe("+13175550123");

    // Pat sees the Text button on the list and in the conversation; it opens the phone's Messages app.
    await pat.reload();
    await msgTab(pat).click();
    const text = pat.$(".contact").filter({ hasText: "Cynda B." }).getByRole("link", { name: /Text Cynda B\./ });
    await expect(text).toHaveAttribute("href", "sms:+13175550123");
    await pat.$("[data-chat]").click();
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
    // Payers can add their number on the account card.
    await msgTab(cynda).click();
    await expect(cynda.$(".contact a.textbtn")).toHaveCount(0);
    await pat.$("#dispPhone").fill("317 555 0199");
    await pat.$("#nameForm button").click();
    await expect(pat.$("#nameForm")).toContainText("Saved.");
    await cynda.reload();
    await msgTab(cynda).click();
    await expect(cynda.$(".contact a.textbtn")).toHaveAttribute("href", "sms:+13175550199");
  });
});

test.describe("Before running the new setup.sql", () => {
  test("the app works as before, with no Messages tab", async ({ openApp, db }) => {
    db.version = 3;   // a database set up with the previous setup.sql
    const cynda = await openApp();
    await cynda.signIn("cynda@example.com");
    await cynda.setName("Cynda B.");   // the name still saves
    expect(db.rows("profiles")[0].display_name).toBe("Cynda B.");
    await cynda.share("Mom", "pat@example.com");
    await cynda.settle();
    await expect(cynda.$("#tabMsgs")).toBeHidden();
    await cynda.$("#dispPhone").fill("317-555-0123");
    await cynda.$("#nameForm button").click();
    await expect(cynda.$("#nameForm .err")).toHaveText("Saving a mobile number needs the latest setup.sql. Run it in Supabase, then try again.");
  });
});
