// Signing in and keeping shifts in sync across devices.
const { test, expect } = require("../support/fixtures");

test.describe("Sign in and sync", () => {
  test("sign in with an emailed code", async ({ openApp }) => {
    const app = await openApp();
    await app.$("#siEmail").fill("not-an-email");
    await app.$("#emailForm button").click();
    await expect(app.$("#sync .err")).toHaveText("Enter your full email address, like name@example.com.");

    await app.$("#siEmail").fill("Cynda@Example.com");
    await app.$("#emailForm button").click();
    await app.$("#siCode").fill("999999");
    await app.$("#codeForm button").click();
    await expect(app.$("#sync .err")).toContainText("That code didn't work");

    await app.$("#siCode").fill("123456");
    await app.$("#codeForm button").click();
    await expect(app.$("#sync")).toContainText("Signed in as cynda@example.com");
  });

  test("shifts recorded before signing in are uploaded", async ({ openApp, db }) => {
    const app = await openApp();
    await app.addShift({ date: "2026-11-02", start: "09:00", end: "12:00", patient: "Mom" });
    await app.signIn("cynda@example.com");
    await app.waitSynced();
    expect(db.rows("shifts")).toHaveLength(1);
    expect(db.rows("shifts")[0]).toMatchObject({ person: "Mom", deleted: false });
  });

  test("a second device sees the same shifts, and deletes reach every device", async ({ openApp, db }) => {
    const phone = await openApp();
    await phone.signIn("cynda@example.com");
    await phone.addShift({ date: "2026-11-02", start: "09:00", end: "12:00", patient: "Mom" });
    await phone.addShift({ date: "2026-11-03", start: "22:00", end: "06:30", patient: "Mom" });
    await phone.waitSynced();

    const laptop = await openApp();
    await laptop.signIn("cynda@example.com");
    await expect(laptop.weekTotal()).toHaveText("11h 30m");

    await laptop.$("[data-act=del]").first().click();
    await laptop.$("[data-act=del-yes]").click();
    await laptop.waitSynced();
    expect(db.rows("shifts").filter(r => r.deleted)).toHaveLength(1);

    await phone.reload();
    await expect(phone.shiftRows()).toHaveCount(1);
  });

  test("changes made offline upload when back online", async ({ openApp, db }) => {
    const app = await openApp();
    await app.signIn("cynda@example.com");
    await app.goOffline();
    await app.addShift({ date: "2026-11-02", start: "09:00", end: "12:00", patient: "Mom" });
    await expect(app.$("#syncState")).toContainText("You're offline");
    expect(db.rows("shifts")).toHaveLength(0);

    await app.goOnline();
    await app.waitSynced();
    expect(db.rows("shifts")).toHaveLength(1);
  });

  test("the Sync & sharing section collapses, and stays that way", async ({ openApp }) => {
    const app = await openApp();
    await app.signIn("cynda@example.com");
    await app.waitSynced();
    const toggle = app.page.getByRole("button", { name: "Sync & sharing" });
    await expect(toggle).toHaveAttribute("aria-expanded", "true");   // open the first time
    await expect(app.$("#shareForm")).toBeVisible();

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(app.$("#shareForm")).toBeHidden();
    await expect(app.$("#signOut")).toBeHidden();
    await expect(app.$("#syncState")).toContainText("All shifts saved online");   // status still shows

    await app.reload();
    await expect(app.page.getByRole("button", { name: "Sync & sharing" })).toHaveAttribute("aria-expanded", "false");
    await app.page.getByRole("button", { name: "Sync & sharing" }).click();
    await expect(app.$("#shareForm")).toBeVisible();
  });

  test("signing out removes shifts from the device but keeps them online", async ({ openApp, db }) => {
    const app = await openApp();
    await app.signIn("cynda@example.com");
    await app.addShift({ date: "2026-11-02", start: "09:00", end: "12:00", patient: "Mom" });
    await app.waitSynced();
    await app.$("#signOut").click();
    await expect(app.$("#sync .confirm")).toContainText("They stay safe in your online account.");
    await app.$("#signOutYes").click();
    await expect(app.shiftRows()).toHaveCount(0);
    expect(db.rows("shifts")).toHaveLength(1);
  });
});
