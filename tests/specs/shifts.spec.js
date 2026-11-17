// Logging shifts on one device, with online sync turned off.
const { test, expect } = require("../support/fixtures");
// The text drawn in a PDF made by the app (its pages aren't compressed): every "(...) Tj", joined by new lines.
const pdfText = bytes => [...bytes.toString("latin1").matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)]
  .map(m => m[1].replace(/\\([()\\])/g, "$1")).filter(t => t.trim()).join("\n");

test.describe("Shifts on this device only", () => {
  test("a patient is required to clock in or add a shift", async ({ openApp }) => {
    const app = await openApp({ sync: false });
    await app.clockIn("");
    await expect(app.$("#clockErr")).toHaveText("Choose a patient to clock in.");
    await expect(app.$("#clock .status")).toHaveText("Off the clock");

    await app.addShift({ date: "2026-11-02", start: "09:00", end: "10:00", patient: "" });
    await expect(app.$("#fErr")).toHaveText("Choose a patient.");
  });

  test("clocking in and out records a shift for the patient", async ({ openApp }) => {
    const app = await openApp({ sync: false });
    await app.clockIn("Mom");
    await expect(app.$("#clock .status")).toHaveText("On the clock · Mom");
    await app.$("#noteIn").fill("Lunch, meds at noon");
    await app.clockOut();
    await expect(app.$("#clock .status")).toHaveText("Off the clock");
    await expect(app.shiftRows()).toHaveCount(1);
    await expect(app.shiftRows().first()).toContainText("Mom · Lunch, meds at noon");
  });

  test("an overnight missed shift counts on the day it started", async ({ openApp }) => {
    const app = await openApp({ sync: false });
    await app.ensurePatient("Mom");
    await app.$("#addBtn").click();
    await app.$("#fDate").fill("2026-11-03");
    await app.$("#fStart").fill("22:00");
    await app.$("#fEnd").fill("06:30");
    await expect(app.$("#fHint")).toHaveText("Ends the next day · 8h 30m");
    await app.$("#fPerson").selectOption("Mom");
    await app.$("#shiftForm button[type=submit]").click();

    await expect(app.weekTotal()).toHaveText("8h 30m");
    await expect(app.$("#bars .day").nth(1)).toContainText("8.5");   // Tuesday
    await expect(app.shiftRows().first()).toContainText("10:00 PM – 6:30 AM (next day)");
  });

  test("rejects shifts that end in the future or run over 24 hours", async ({ openApp }) => {
    const app = await openApp({ sync: false });
    await app.addShift({ date: "2026-11-05", start: "09:00", end: "10:00", patient: "Mom" });
    await expect(app.$("#fErr")).toContainText("ends in the future");
  });

  test("a new spelling of a known patient is saved the known way", async ({ openApp }) => {
    const app = await openApp({ sync: false });
    await app.addShift({ date: "2026-11-02", start: "09:00", end: "12:00", patient: "Mom" });
    await app.addShift({ date: "2026-11-03", start: "09:00", end: "10:00", patient: "  mom " });
    await expect(app.$("#list")).not.toContainText("mom ·");
    await expect(app.$("#list .meta b")).toHaveText(["Mom", "Mom"]);
  });

  test("edit and delete a shift, and it stays gone after reloading", async ({ openApp }) => {
    const app = await openApp({ sync: false });
    await app.addShift({ date: "2026-11-02", start: "09:00", end: "12:00", patient: "Mom" });
    await app.$("[data-act=edit]").click();
    await app.$("#fEnd").fill("13:00");
    await app.$("#shiftForm button[type=submit]").click();
    await expect(app.weekTotal()).toHaveText("4h 00m");

    await app.$("[data-act=del]").click();
    await app.$("[data-act=del-yes]").click();
    await expect(app.shiftRows()).toHaveCount(0);
    await app.reload();
    await expect(app.weekTotal()).toHaveText("0h");
  });

  test("the CSV has one row per shift and a total", async ({ openApp }) => {
    const app = await openApp({ sync: false });
    await app.addShift({ date: "2026-11-02", start: "09:00", end: "12:00", patient: "Mom", note: "walk, then lunch" });
    await app.addShift({ date: "2026-11-03", start: "22:00", end: "06:30", patient: "Mom" });
    const csv = await app.downloadCsv();
    expect(csv.name).toBe("care-hours-week-of-2026-11-02.csv");
    expect(csv.text.split("\r\n")).toEqual([
      "Date,Start,End,Hours,Patient,Notes",
      '2026-11-02,9:00 AM,12:00 PM,3.00,Mom,"walk, then lunch"',
      "2026-11-03,10:00 PM,6:30 AM,8.50,Mom,",
      "Total,,,11.50,,",
    ]);
  });

  test("Download asks for CSV or PDF, and can be cancelled", async ({ openApp }) => {
    const app = await openApp({ sync: false });
    await expect(app.$("#csvBtn")).toHaveText("Download");
    await expect(app.$("#dlPick")).toBeHidden();
    await app.$("#csvBtn").click();
    await expect(app.$("#dlPick")).toBeVisible();
    await expect(app.$("#dlPick button")).toHaveText(["CSV", "PDF", "Cancel"]);
    await app.$("#dlCancel").click();
    await expect(app.$("#dlPick")).toBeHidden();
  });

  test("the PDF groups shifts by patient, with each one's date, time, hours and notes, a total for each patient, and the total", async ({ openApp }) => {
    const app = await openApp({ sync: false });
    await app.addShift({ date: "2026-11-02", start: "09:00", end: "12:00", patient: "Mom", note: "walk, then lunch" });
    await app.addShift({ date: "2026-11-03", start: "22:00", end: "06:30", patient: "Mom" });
    await app.addPatient({ name: "Dad", client: { name: "Pat P.", rel: "Son" } });   // Mom has no client
    await app.addShift({ date: "2026-11-04", start: "13:00", end: "15:15", patient: "Dad", note: "doctor visit" });
    const pdf = await app.downloadPdf();
    expect(pdf.name).toBe("care-hours-week-of-2026-11-02.pdf");
    expect(pdf.bytes.subarray(0, 5).toString()).toBe("%PDF-");
    // Grouped by patient (alphabetically), each with their total, then the total for everyone.
    const text = pdfText(pdf.bytes);
    expect(text.split("\n")).toEqual(["Care Hours timesheet", "Patient: All patients", "Dates: Mon, Nov 2, 2026 to Sun, Nov 8, 2026",
      "Date", "Time", "Hours", "Notes",
      "Dad   \xb7   Client: Pat P.",
      "Wed, Nov 4, 2026", "1:00 PM \x96 3:15 PM", "2.25", "doctor visit",
      "Total for Dad", "2.25",
      "Mom",
      "Mon, Nov 2, 2026", "9:00 AM \x96 12:00 PM", "3.00", "walk, then lunch",
      "Tue, Nov 3, 2026", "10:00 PM \x96 6:30 AM", "8.50",
      "Total for Mom", "11.50",
      "Total hours", "13.75"]);
    await expect(app.$("#dlPick")).toBeHidden();

    // Just one patient: their name at the top, and no per-patient totals.
    await app.page.locator("#myPatient").selectOption({ label: "Dad" });
    const one = pdfText((await app.downloadPdf()).bytes);
    expect(one).toContain("Patient: Dad\nClient: Pat P.\nDates:");
    expect(one).toContain("Total for Dad");
    expect(one).not.toContain("Mom");
    // Mom has no client: no client line.
    await app.page.locator("#myPatient").selectOption({ label: "Mom" });
    const mom = pdfText((await app.downloadPdf()).bytes);
    expect(mom).toContain("Patient: Mom\nDates:");
    expect(mom).not.toContain("Client");
  });

  test("without internet the first time, the PDF explains why it couldn't be made", async ({ openApp }) => {
    const app = await openApp({ sync: false });
    await app.page.route("https://cdn.jsdelivr.net/npm/jspdf@*/**", r => r.abort());
    await app.$("#csvBtn").click();
    await app.$("#dlPdf").click();
    await expect(app.$("#dlErr")).toHaveText("Couldn't make the PDF. Check your internet connection and try again.");
    await expect(app.$("#dlPdf")).toHaveText("PDF");
    await expect(app.$("#dlPdf")).toBeEnabled();
  });

  test("shifts saved by the first version of the app still load", async ({ openApp }) => {
    const app = await openApp({ sync: false });
    await app.page.evaluate(() => localStorage.setItem("care-hours-shifts-v1", JSON.stringify([
      { id: "old1", start: Date.now() - 3 * 3600e3, end: Date.now() - 3600e3, person: "Mom", note: "from v1" },
    ])));
    await app.reload();
    await expect(app.weekTotal()).toHaveText("2h 00m");
    await expect(app.$("#list")).toContainText("from v1");
  });
});
