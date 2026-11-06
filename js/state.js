// Care Hours: What the app knows right now: your shifts and schedule, who's signed in, what's shared, and which screen is showing.
// All app files share one set of names (classic scripts), and load in the order listed in index.html.

// ================= state =================
// Each shift: {id, start, end|null, person, note, updatedAt, deleted, dirty, failed?}
//   start/end/updatedAt are milliseconds. "dirty" = changed here and not yet saved online.
//   Deleted shifts are kept as markers (deleted: true) so other devices learn about the delete.
let shifts = [];
let sched = [];              // schedule entries: {id, kind: weekly|once|off, person, days, onDate, untilDate, startTime, endTime, note, ...}
let view = "mine";           // "mine" (your own clock) | "plan" (your schedule) | "all" / "pplan" (payer's Shifts / Schedule) | "shared" (Caregivers tab) | "msgs" (Messages)
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
let nameSavedNow = null;   // the name saved during this sign-in, if any
let shareUi = { err: "", ok: "", confirm: null, busy: false, savedName: false, nameErr: "", person: "", email: "" };
let signoutConfirm = false;
let rangeMode = "week";       // the period shown: "week", "2weeks" (this week and the next) or "month"
let selDay = null;           // day opened from the week chart ("YYYY-MM-DD")
let myPatient = "all";       // caregiver's patient filter on Shifts and Schedule: "all", or a patient (samePerson form)
let syncOpen = true;
let listOpen = false;         // Shifts card open or collapsed (starts collapsed; remembered on this device)
let schedOpen = false;        // Schedule card open or collapsed (starts collapsed; remembered on this device)          // Sync & sharing card open or collapsed; remembered on this device

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
const LS_SYNC_OPEN = "care-hours-sync-open";
const LS_LIST_OPEN = "care-hours-list-open";
const LS_SCHED_OPEN = "care-hours-sched-open";
const LS_COLORS = "care-hours-patient-colors";
const LS_RANGE = "care-hours-range";
const LS_CG_COLORS = "care-hours-caregiver-colors";

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
// Payer views ("all" = payer's Shifts, "pplan" = payer's Schedule, "shared" = Caregivers tab) follow the caregiver picker.
const data = () => readOnly() ? sharedAll.filter(s => sharedCaregiver === "all" || s.owner === sharedCaregiver)
  : mine().filter(forMyPatient);
const readOnly = () => view === "all" || view === "pplan" || view === "shared";
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
// The caregiver's patient filter. Time off isn't for one patient, so it always shows.
const forMyPatient = x => myPatient === "all" || x.kind === "off" || samePerson(x.person) === myPatient;
const myPatientName = () => patients().find(p => samePerson(p) === myPatient) || myPatient;
// ---------- colors: patients on caregiver screens, caregivers on payer screens ----------
// Each patient (or caregiver) keeps the same color on this device. Newcomers get the first unused color.
const PALETTE = 8;
function colorBook(lsKey) {
  let map = null;
  return key => {
    if (!key) return -1;
    if (!map) { try { map = JSON.parse(getLS(lsKey) || "{}") || {}; } catch (e) { map = {}; } }
    if (!(key in map)) {
      const used = new Set(Object.values(map));
      let i = 0;
      while (used.has(i) && i < PALETTE) i++;
      map[key] = i < PALETTE ? i : Object.keys(map).length % PALETTE;
      setLS(lsKey, JSON.stringify(map));
    }
    return map[key];
  };
}
const patientColorOf = colorBook(LS_COLORS);
const caregiverColorOf = colorBook(LS_CG_COLORS);
const patientColor = name => patientColorOf(samePerson(name));
// Hand out colors alphabetically the first time, so devices with the same people start out alike.
const seedColors = () => {
  [...patients()].sort((a, b) => a.localeCompare(b)).forEach(patientColor);
  sharedCaregivers().forEach(caregiverColorOf);
};
const pc = name => { const i = patientColor(name); return i < 0 ? "" : ` pc${i}`; };   // patient color class
const cc = id => { const i = caregiverColorOf(id); return i < 0 ? "" : ` pc${i}`; };   // caregiver color class
// The color for one shift or schedule entry: its caregiver for payers, its patient for caregivers.
const tint = x => readOnly() ? cc(x.owner) : pc(x.person);
const colorsOn = () => !readOnly();

const cgName = id => (caregiverNames[id] && caregiverNames[id].name) || "A caregiver";
