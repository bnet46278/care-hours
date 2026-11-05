// Care Hours: Small helpers used everywhere: page lookups, dates and times, formatting.
// All app files share one set of names (classic scripts), and load in the order listed in index.html.

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 9);

// ================= time helpers =================
const HOUR = 3600000;
function weekStart(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // Monday
  return x;
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function dur(ms) {
  const mins = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}
function clockText(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}
const tFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" });
const shortFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const wdFmt = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const pad = n => String(n).padStart(2, "0");
const dateVal = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeVal = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const endOf = s => s.end ?? Date.now();

// Same rule as the database: "Mom", "mom" and " Mom " are one patient.
const samePerson = p => String(p || "").replace(/\s+/g, " ").trim().toLowerCase();

const DAY = 24 * HOUR;
const parseDate = d => { const [y, m, dd] = d.split("-").map(Number); return new Date(y, m - 1, dd); };
const atTime = (d, hm) => { const x = new Date(d); const [h, mi] = hm.split(":").map(Number); x.setHours(h, mi, 0, 0); return x.getTime(); };
const timeLabel = hm => tFmt.format(new Date(atTime(new Date(2000, 0, 1), hm)));
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];   // Monday first, like the week view
const dayShort = n => wdFmt.format(new Date(2026, 1, 1 + n));   // Feb 1 2026 was a Sunday
const daysLabel = days => { const d = WEEK_ORDER.filter(x => days.includes(x)); return d.length === 7 ? "Every day" : d.map(dayShort).join(", "); };

const hrs = ms => `${dur(ms)} [${(ms / HOUR).toFixed(2)}]`;
