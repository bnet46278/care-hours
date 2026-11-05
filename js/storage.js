// Care Hours: Saving on this device, and syncing shifts and the schedule with the online database.
// All app files share one set of names (classic scripts), and load in the order listed in index.html.

// ================= local storage =================
// Two kinds of records are kept on the device and synced the same way: shifts and the schedule.
function normShift(s) {
  return { id: String(s.id), start: s.start, end: s.end ?? null, person: s.person || "", note: s.note || "",
    updatedAt: s.updatedAt || s.end || s.start, deleted: !!s.deleted, dirty: s.dirty !== false, failed: !!s.failed };
}
function normSched(e) {
  return { id: String(e.id), kind: e.kind, person: e.person || "", days: Array.isArray(e.days) ? e.days.map(Number) : [],
    onDate: e.onDate, untilDate: e.untilDate || null, startTime: e.startTime || null, endTime: e.endTime || null,
    note: e.note || "", updatedAt: e.updatedAt || Date.now(), deleted: !!e.deleted, dirty: e.dirty !== false, failed: !!e.failed };
}
function readLS(key, ok, norm) {
  let v = [];
  try { v = JSON.parse(localStorage.getItem(key) || "[]"); } catch (e) {}
  return Array.isArray(v) ? v.filter(x => x && x.id && ok(x)).map(norm) : [];
}
// Shifts saved by the first version of the app have no sync fields yet; normShift fills them in.
function loadLocal() { return readLS(LS_KEY, x => typeof x.start === "number", normShift); }
function loadSched() { return readLS(LS_SCHED, x => ["weekly", "once", "off"].includes(x.kind) && /^\d{4}-\d\d-\d\d$/.test(x.onDate || ""), normSched); }
function saveLocal() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(shifts)); localStorage.setItem(LS_SCHED, JSON.stringify(sched)); } catch (e) {}
}
function getLS(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function setLS(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} }

// Every change goes through here: save on this device first, then upload if signed in.
function upsertLocal(list, rec) {
  const i = list.findIndex(x => x.id === rec.id);
  if (i >= 0) list[i] = rec; else list.push(rec);
  saveLocal(); renderAll(); push();
}
const bump = prev => Math.max(Date.now(), (prev || 0) + 1);
function put(shift) {
  upsertLocal(shifts, { ...normShift(shift), updatedAt: bump(shift.updatedAt), dirty: true, failed: false });
}
function remove(id) {
  const s = shifts.find(x => x.id === id);
  // Keep a marker so other devices learn about the delete, but drop the note.
  if (s) put({ ...s, deleted: true, note: "" });
}
function putSched(e) {
  upsertLocal(sched, { ...normSched(e), updatedAt: bump(e.updatedAt), dirty: true, failed: false });
}
function removeSched(id) {
  const e = sched.find(x => x.id === id);
  if (e) putSched({ ...e, deleted: true, note: "" });
}

// ================= online sync =================
const iso = ms => new Date(ms).toISOString();
const toRow = s => ({
  owner: me.id, id: s.id, start_at: iso(s.start), end_at: s.end ? iso(s.end) : null,
  person: s.person, note: s.note, deleted: s.deleted, updated_at: iso(s.updatedAt),
});
const fromRow = r => ({
  id: r.id, start: Date.parse(r.start_at), end: r.end_at ? Date.parse(r.end_at) : null,
  person: r.person || "", note: r.note || "", updatedAt: Date.parse(r.updated_at), deleted: !!r.deleted, dirty: false, failed: false,
});
const hhmm = t => t ? String(t).slice(0, 5) : null;
const schedToRow = e => ({
  owner: me.id, id: e.id, kind: e.kind, person: e.kind === "off" ? "" : e.person, days: e.kind === "weekly" ? e.days : [],
  on_date: e.onDate, until_date: e.untilDate, start_time: e.startTime, end_time: e.endTime,
  note: e.kind === "off" ? "" : e.note, deleted: e.deleted, updated_at: iso(e.updatedAt),
});
const schedFromRow = r => ({
  id: r.id, kind: r.kind, person: r.person || "", days: (r.days || []).map(Number), onDate: r.on_date, untilDate: r.until_date || null,
  startTime: hhmm(r.start_time), endTime: hhmm(r.end_time), note: r.note || "",
  updatedAt: Date.parse(r.updated_at), deleted: !!r.deleted, dirty: false, failed: false,
});
const STORES = [
  { table: "shifts", get: () => shifts, set: v => { shifts = v; }, toRow, fromRow },
  { table: "schedule", get: () => sched, set: v => { sched = v; }, toRow: schedToRow, fromRow: schedFromRow },
];
const allLocal = () => [...shifts, ...sched];
const isNetworkError = e => !e || !e.code || /fetch|network|load failed/i.test(e.message || "");

async function fetchAll(build) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data: rows, error } = await build().range(from, from + 999);
    if (error) throw error;
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

let pushing = false, pushAgain = false, retryTimer = null;
async function push() {
  if (!sb || !me) return;
  if (pushing) { pushAgain = true; return; }
  pushing = true;
  try {
    do {
      pushAgain = false;
      for (const st of STORES) {
        const batch = st.get().filter(x => x.dirty && !x.failed);
        if (!batch.length) continue;
        setSync("syncing");
        const sent = new Map(batch.map(x => [x.id, x.updatedAt]));
        let { error } = await sb.from(st.table).upsert(batch.map(st.toRow), { onConflict: "owner,id" });
        if (error && isNetworkError(error)) throw error;
        if (error) {
          // One bad record shouldn't block the rest: try them one at a time.
          for (const x of batch) {
            const r = await sb.from(st.table).upsert([st.toRow(x)], { onConflict: "owner,id" });
            if (r.error && isNetworkError(r.error)) throw r.error;
            if (r.error) { const cur = st.get().find(y => y.id === x.id); if (cur && cur.updatedAt === x.updatedAt) cur.failed = true; sent.delete(x.id); }
          }
        }
        for (const [id, at] of sent) {
          const cur = st.get().find(y => y.id === id);
          if (cur && cur.updatedAt === at) cur.dirty = false;
        }
        saveLocal();
      }
    } while (pushAgain);
    const bad = allLocal().some(x => x.failed);
    setSync(bad ? "bad" : "ok", bad ? "Some changes couldn't be saved online. Edit them to try again." : "");
  } catch (e) {
    setSync("wait", "You're offline. Changes are saved on this device and will upload when you're back online.");
    clearTimeout(retryTimer); retryTimer = setTimeout(push, 30000);
  } finally {
    pushing = false;
    if (pushAgain) push();
  }
}

async function pull() {
  if (!sb || !me) return;
  try {
    setSync("syncing");
    for (const st of STORES) {
      const rows = await fetchAll(() => sb.from(st.table).select("*").eq("owner", me.id).order("id"));
      const byId = new Map(st.get().map(x => [x.id, x]));
      const seen = new Set();
      for (const r of rows) {
        const rem = st.fromRow(r); seen.add(rem.id);
        const loc = byId.get(rem.id);
        if (!loc || !loc.dirty || rem.updatedAt > loc.updatedAt) byId.set(rem.id, rem);
      }
      // A synced record that isn't online any more belongs to another account; drop it.
      for (const [id, x] of byId) if (!seen.has(id) && !x.dirty) byId.delete(id);
      st.set([...byId.values()]);
    }
    setLS(LS_OWNER, me.id);
    saveLocal(); renderAll();
    sync.last = Date.now();
    await push();
    if (!allLocal().some(x => x.dirty)) setSync("ok");
  } catch (e) {
    setSync("wait", "Can't reach the online database right now. Your shifts are safe on this device.");
  }
}

function setSync(state, msg = "") { sync.state = state; sync.msg = msg; if (state === "ok") sync.last = Date.now(); renderSyncState(); }
