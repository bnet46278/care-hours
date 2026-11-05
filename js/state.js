// Care Hours: What the app knows right now: your shifts and schedule, who's signed in, what's shared, and which screen is showing.
// All app files share one set of names (classic scripts), and load in the order listed in index.html.

// ================= state =================
// Each shift: {id, start, end|null, person, note, updatedAt, deleted, dirty, failed?}
//   start/end/updatedAt are milliseconds. "dirty" = changed here and not yet saved online.
//   Deleted shifts are kept as markers (deleted: true) so other devices learn about the delete.
let shifts = [];
let sched = [];              // schedule entries: {id, kind: weekly|once|off, person, days, onDate, untilDate, startTime, endTime, note, ...}
let view = "mine";           // "mine" (your own clock) | "plan" (your schedule) | "all" (every shift shared with you) | "shared" (one patient)
let planForm = null;         // the schedule entry being added or edited
let planConfirm = null;      // schedule entry id waiting for "Delete?"
let sharedSched = [];        // schedule entries shared with me (read only), each with .owner
let weekOffset = 0;          // 0 = this week, -1 = last week
let confirmId = null;
let draftPerson = "";
let draftNote = "";
let noteForId = null;
let formOpen = null;

// online sync
const CFG = window.CARE_HOURS_CONFIG || {};
const configured = !!(CFG.supabaseUrl && CFG.supabaseAnonKey);
let sb = null;               // Supabase client
let libFailed = false;       // the Supabase library didn't load (usually offline)
let me = null;               // {id, email}
let sync = { state: "off", last: null, msg: "" };   // off | syncing | ok | wait | bad
let signin = { step: "email", email: "", busy: false, err: "", info: "" };
let shares = [];             // [{email, person}]: who sees which of my patients
let profile = { display_name: "" };
let shareUi = { err: "", ok: "", confirm: null, busy: false, savedName: false, person: "", email: "" };
let signoutConfirm = false;

// patients other caregivers shared with me
let sharedPairs = [];        // [{owner, person}] exactly as shared
let sharedPatients = [];     // [{key, person, caregivers: [owner ids]}], one per patient across caregivers
let sharedCaregiver = "all"; // the caregiver shown on the payer's Caregivers tab: "all", or their id
let caregiverNames = {};     // owner id -> {name, email}
let sharedAll = [];          // every shift shared with me (read only), each with .owner
let sharedLoadedAt = null;
let sharedErr = "";

const LS_KEY = "care-hours-shifts-v1";
const LS_OWNER = "care-hours-synced-owner";
const LS_SCHED = "care-hours-schedule-v1";

// Your patients, spelled the way you most recently entered them.
function patients() {
  const m = new Map();
  // Shares, schedule entries and shifts all name patients; the most recent spelling wins.
  const named = [...shares.map(x => ({ person: x.person, at: 0 })), ...sched.filter(e => !e.deleted && e.kind !== "off").map(e => ({ person: e.person, at: e.updatedAt })),
    ...mine().map(s => ({ person: s.person, at: s.start }))].sort((a, b) => a.at - b.at);
  for (const x of named) if (samePerson(x.person)) m.set(samePerson(x.person), x.person.trim());
  return [...m.values()].sort((a, b) => a.localeCompare(b));
}
// "mom" typed again becomes "Mom" if that's how the patient already appears.
function matchPatient(name) {
  const hit = patients().find(p => samePerson(p) === samePerson(name));
  return hit || name;
}

const mine = () => shifts.filter(s => !s.deleted);
const active = () => mine().filter(s => !s.end).sort((a, b) => b.start - a.start)[0];
const data = () => view === "all" ? sharedAll
  : view === "shared" ? sharedAll.filter(s => sharedCaregiver === "all" || s.owner === sharedCaregiver)
  : mine();
const readOnly = () => view === "all" || view === "shared";
// A payer is someone with shared patients who doesn't record shifts of their own.
const payerMode = () => !!me && sharedPatients.length > 0 && mine().length === 0 && liveSched().length === 0;
// On the payer side, show each patient's name one way, whoever typed it.
const patientName = s => {
  if (!readOnly()) return s.person;
  const g = sharedPatients.find(g => g.key === samePerson(s.person));
  return g ? g.person : s.person;
};

// Caregivers who share with you, by name, and the patients each one shares.
const sharedCaregivers = () => [...new Set(sharedPairs.map(r => r.owner))].sort((a, b) => cgName(a).localeCompare(cgName(b)));
const patientsOf = id => sharedPatients.filter(g => g.caregivers.includes(id)).map(g => g.person);
const cgName = id => (caregiverNames[id] && caregiverNames[id].name) || "A caregiver";
