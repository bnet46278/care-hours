// Unit tests for the schedule math in js/schedule.js. These run in Node, without a browser.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { test, expect } = require("@playwright/test");

// Load js/util.js and js/schedule.js the way the browser does, and pull out the functions under test.
function loadScheduleMath() {
  const read = f => fs.readFileSync(path.join(__dirname, "..", "..", "js", f), "utf8");
  const ctx = vm.createContext({ console, Intl, document: {} });
  return vm.runInContext(read("util.js") + "\n" + read("schedule.js") +
    "\n;({ occurrences, schedHours, parseDate, atTime, daysLabel, dur, HOUR })", ctx);
}
const m = loadScheduleMath();
const H = 3600000;
const week = (from = "2026-11-02") => [m.parseDate(from).getTime(), m.parseDate(from).getTime() + 7 * 24 * H];
const weekly = (o = {}) => ({ id: "w", owner: "me", kind: "weekly", person: "Mom", days: [1, 3, 5], onDate: "2026-11-02", untilDate: null, startTime: "09:00", endTime: "13:00", note: "", ...o });
const once = (o = {}) => ({ id: "o", owner: "me", kind: "once", person: "Dad", days: [], onDate: "2026-11-07", untilDate: null, startTime: "08:00", endTime: "12:00", note: "", ...o });
const off = (o = {}) => ({ id: "t", owner: "me", kind: "off", person: "", days: [], onDate: "2026-11-06", untilDate: "2026-11-06", startTime: null, endTime: null, note: "", ...o });

test.describe("schedule math", () => {
  test("a repeating shift happens on its weekdays", () => {
    const occ = m.occurrences([weekly()], ...week());
    expect(occ.map(o => new Date(o.start).getDay())).toEqual([1, 3, 5]);
    expect(m.schedHours(occ)).toBe(12 * H);
  });

  test("a repeating shift respects its start and end dates", () => {
    expect(m.occurrences([weekly({ onDate: "2026-11-04" })], ...week())).toHaveLength(2);           // Wed, Fri
    expect(m.occurrences([weekly({ untilDate: "2026-11-04" })], ...week())).toHaveLength(2);        // Mon, Wed
    expect(m.occurrences([weekly({ onDate: "2026-11-09" })], ...week())).toHaveLength(0);           // starts next week
  });

  test("an overnight shift ends the next day", () => {
    const [o] = m.occurrences([once({ startTime: "22:00", endTime: "06:30" })], ...week());
    expect(o.end - o.start).toBe(8.5 * H);
    expect(new Date(o.end).getDate()).toBe(8);
  });

  test("all-day time off cancels the shift that day only", () => {
    const occ = m.occurrences([weekly(), off()], ...week());
    expect(occ.filter(o => o.cancelled).map(o => new Date(o.start).getDay())).toEqual([5]);
    expect(m.schedHours(occ)).toBe(8 * H);
  });

  test("time off for part of a day cancels only overlapping shifts", () => {
    const occ = m.occurrences([weekly(), off({ onDate: "2026-11-06", untilDate: "2026-11-06", startTime: "14:00", endTime: "18:00" })], ...week());
    expect(occ.some(o => o.cancelled)).toBe(false);
  });

  test("multi-day time off from an evening to a morning", () => {
    const t = off({ onDate: "2026-11-02", untilDate: "2026-11-04", startTime: "18:00", endTime: "10:00" });
    const occ = m.occurrences([weekly(), t], ...week());
    // Mon 9-1 is before it starts; Wed 9-1 overlaps the end (back at 10:00); Fri is after.
    expect(occ.filter(o => o.kind !== "off").map(o => o.cancelled)).toEqual([false, true, false]);
  });

  test("one caregiver's time off doesn't cancel another caregiver's shift", () => {
    const occ = m.occurrences([weekly({ owner: "ann" }), off({ owner: "cynda" })], ...week());
    expect(occ.some(o => o.cancelled)).toBe(false);
  });

  test("deleted entries are ignored", () => {
    expect(m.occurrences([weekly({ deleted: true })], ...week())).toHaveLength(0);
  });

  test("the overnight shift when clocks fall back counts the extra hour", () => {
    test.skip(Intl.DateTimeFormat().resolvedOptions().timeZone !== "America/New_York", "needs New York time");
    // US clocks fell back at 2:00 AM on Sunday, Nov 1, 2026. 10 PM to 6 AM that night is 9 real hours.
    const [o] = m.occurrences([once({ onDate: "2026-10-31", startTime: "22:00", endTime: "06:00" })], ...week("2026-10-26"));
    expect(o.end - o.start).toBe(9 * H);
  });

  test("days are listed Monday first", () => {
    expect(m.daysLabel([5, 1, 3])).toBe("Mon, Wed, Fri");
    expect(m.daysLabel([0, 1, 2, 3, 4, 5, 6])).toBe("Every day");
  });
});
