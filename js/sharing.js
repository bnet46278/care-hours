// Care Hours: Signing in, sharing patients with payers, loading what's shared with you, and the account card.
// All app files share one set of names (classic scripts), and load in the order listed in index.html.

async function loadShares() {
  if (!sb || !me) return;
  const [s, p, w] = await Promise.all([
    sb.from("shares").select("viewer_email, person").eq("owner", me.id).order("created_at"),
    sb.from("profiles").select("*").eq("id", me.id).maybeSingle(),
    sb.from("shared_weeks").select("person, shared_through").eq("owner", me.id),
  ]);
  if (!s.error) shares = s.data.map(r => ({ email: r.viewer_email, person: r.person }));
  if (!w.error) { weeksTable = true; myWeeks = {}; for (const r of w.data) myWeeks[samePerson(r.person)] = new Date(r.shared_through); }
  else if (missingTable(w.error)) { weeksTable = false; myWeeks = {}; }
  if (!p.error) {
    profile = p.data || { display_name: "", email: "", phone: "" };
    if (nameSavedNow !== null) profile.display_name = nameSavedNow;   // a name saved while this was loading wins
  }
  renderSync();
  return !p.error;
}

async function loadSharedWithMe() {
  if (!sb || !me) return;
  const { data: rows, error } = await sb.from("shares").select("owner, person").eq("viewer_email", (me.email || "").toLowerCase()).neq("owner", me.id);
  if (error) return;
  sharedPairs = rows.map(r => ({ owner: r.owner, person: r.person.trim() }));
  const ids = [...new Set(rows.map(r => r.owner))];
  caregiverNames = {}; cgWeeks = {};
  if (ids.length) {
    const [pr, sw] = await Promise.all([sb.from("profiles").select("*").in("id", ids),
      sb.from("shared_weeks").select("owner, person, shared_through").in("owner", ids)]);
    cgWeeks = {};
    if (!sw.error) for (const r of sw.data) (cgWeeks[r.owner] = cgWeeks[r.owner] || {})[samePerson(r.person)] = new Date(r.shared_through);
    if (!pr.error) for (const p of pr.data) caregiverNames[p.id] = {
      name: p.display_name || p.email || "A caregiver", email: p.email || "",
      // Holding weeks: payers see this caregiver's shifts only before this time.
      sharedThrough: p.hold_weeks ? (p.shared_through ? new Date(p.shared_through) : new Date(0)) : null,
    };
  }
  // The same patient is often shared by several caregivers: combine them by name.
  const byPatient = new Map();
  for (const r of sharedPairs) {
    const k = samePerson(r.person);
    if (!byPatient.has(k)) byPatient.set(k, { key: k, person: r.person, caregivers: [] });
    const g = byPatient.get(k);
    if (!g.caregivers.includes(r.owner)) g.caregivers.push(r.owner);
  }
  sharedPatients = [...byPatient.values()].sort((a, b) => a.person.localeCompare(b.person));
  for (const g of sharedPatients) g.caregivers.sort((a, b) => cgName(a).localeCompare(cgName(b)));
  if (sharedCaregiver !== "all" && !sharedPairs.some(r => r.owner === sharedCaregiver)) sharedCaregiver = "all";
  fitView();
  await loadSharedShifts();
  renderAll();
}
// Payers (and clients) land on the payer side of the tab they're on; caregivers on their own side.
// Only leave a shared view that has nothing left; never move someone off the tab they chose.
function fitView() {
  if (payerMode()) {
    view = { mine: "all", people: "ppeople", shared: "all" }[view] || view;
  } else if (readOnly() && !(view === "shared" && sharedPatients.length)) {
    view = { ppeople: "people" }[view] || "mine";
  }
}

async function loadSharedShifts() {
  sharedErr = "";
  const ids = [...new Set(sharedPairs.map(r => r.owner))];
  if (!sb || !ids.length) { sharedAll = []; return; }
  try {
    const rows = await fetchAll(() => sb.from("shifts").select("*").in("owner", ids).eq("deleted", false).order("id"));
    // The database only returns shared patients; this double-checks each shift against its share.
    const allowed = new Set(sharedPairs.map(r => r.owner + "|" + samePerson(r.person)));
    sharedAll = rows.map(r => ({ ...fromRow(r), owner: r.owner }))
      .filter(x => allowed.has(x.owner + "|" + samePerson(x.person)));
    const srows = await fetchAll(() => sb.from("schedule").select("*").in("owner", ids).eq("deleted", false).order("id"));
    sharedSched = srows.map(r => ({ ...schedFromRow(r), owner: r.owner }))
      .filter(x => x.kind === "off" ? ids.includes(x.owner) : allowed.has(x.owner + "|" + samePerson(x.person)));
    sharedLoadedAt = Date.now();
  } catch (e) {
    sharedErr = "Couldn't load the latest hours. Check your connection and tap Refresh.";
  }
}

async function onSignedIn(session) {
  const u = session.user;
  if (me && me.id === u.id) return;
  me = { id: u.id, email: u.email || "" };
  signin = { step: "email", email: "", busy: false, err: "", info: "" };
  renderSync();
  // Make sure people you share with see a name, defaulting to your email.
  await pull();
  const profileLoaded = await loadShares();
  if (profileLoaded && profile.email !== me.email) {
    // Only fill in the email; never touch the name here, so it can't undo a name saved a moment ago.
    await sb.from("profiles").upsert({ id: me.id, email: me.email });
  }
  await loadSharedWithMe();
  await loadCardSharing();
  renderAll();
  startMessaging();
}
function onSignedOut() {
  stopMessaging();
  holdUi = { confirm: null, busy: false, err: "" };
  me = null; nameSavedNow = null; shares = []; profile = { display_name: "" }; sharedPairs = []; sharedPatients = []; sharedAll = []; sharedSched = []; sharedCaregiver = "all"; caregiverNames = {}; myWeeks = {}; cgWeeks = {}; view = "mine";
  memberCards = []; sharedCards = []; cardMembers = {}; cardOwnerNames = {}; setLS(LS_MEMBER_CARDS, null);
  sharedClients = {}; patientRequests = [];
  acctUi = acctUiStart();
  pcUi = { ...pcUi, open: null, edit: false, isNew: false };
  setSync("off"); renderAll();
}

function initSync() {
  if (!configured) return;
  if (!window.supabase || !window.supabase.createClient) {
    libFailed = true;
    $("sync").hidden = false;
    $("sync").innerHTML = `<h2>Online sync</h2><p class="muted">Online sync couldn't load. Check your internet connection and reopen Care Hours. Your shifts are still saved on this device.</p>`;
    return;
  }
  sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "care-hours-auth" },
  });
  sb.auth.onAuthStateChange((event, session) => {
    // Run outside the auth callback so Supabase calls inside it don't wait on each other.
    setTimeout(() => { if (session && session.user) onSignedIn(session); else if (event === "SIGNED_OUT") onSignedOut(); }, 0);
  });
  renderSync();
  window.addEventListener("online", () => { pull(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && me) { pull(); if (sharedPatients.length) refreshShared(); }
  });
}
async function refreshShared() { await loadSharedShifts(); await loadCardSharing(); renderAll(); }

// ================= render: sync & sharing card =================
function syncLine() {
  const pending = STORES.filter(st => !noTable.has(st.table)).reduce((n, st) => n + st.get().filter(s => s.dirty && !s.failed).length, 0);
  if (sync.state === "syncing") return { cls: "wait", text: "Syncing…" };
  if (sync.state === "bad") return { cls: "bad", text: sync.msg };
  if (sync.state === "wait") return { cls: "wait", text: sync.msg + (pending ? ` (${pending} waiting)` : "") };
  if (pending) return { cls: "wait", text: `${pending} change${pending === 1 ? "" : "s"} waiting to upload` };
  return { cls: "ok", text: `All shifts saved online${sync.last ? " · " + tFmt.format(new Date(sync.last)) : ""}` };
}
function renderSyncState() {
  const el = $("syncState"); if (!el) { renderFoot(); return; }
  const l = syncLine();
  el.className = "syncstate " + l.cls;
  el.innerHTML = `<span class="dot"></span><span>${esc(l.text)}</span>`;
  renderFoot();
}
// Payers have nothing to sync or share: on their screens the Account Card is all there is.
const payerScreen = () => readOnly() || (view === "msgs" && payerMode());
function renderFoot() {
  if (view === "msgs") { $("foot").textContent = "Only you and the person you're writing to can read your messages."; return; }
  $("foot").textContent = readOnly()
    ? "You're viewing hours someone shared with you. Only they can change them, and they can stop sharing at any time."
    : me
    ? "Your shifts are saved on this device and in your online account. Only you and the people you share with can see them."
    : "Your shifts are saved on this device only. Nobody else can see them. Download a CSV now and then to keep a backup.";
}

function renderSync() {
  const el = $("sync");
  if (libFailed) { el.hidden = readOnly(); renderFoot(); return; }
  renderAccount();
  if (!configured || !sb) { el.hidden = true; renderFoot(); return; }
  el.hidden = !!me && payerScreen();
  if (el.hidden) { el.innerHTML = ""; renderFoot(); return; }
  const focusId = document.activeElement && el.contains(document.activeElement) ? document.activeElement.id : null;

  if (!me) {
    if (signin.step === "email") {
      el.innerHTML = `
        <h2>Back up, sync and share</h2>
        <p class="muted">Sign in with your email to save your shifts online, use them on more than one device, and let the people who pay you see your hours.</p>
        <form id="emailForm" class="field" novalidate>
          <label class="label" for="siEmail">Email</label>
          <div class="inline"><input id="siEmail" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com" value="${esc(signin.email)}">
          <button class="btn" type="submit" ${signin.busy ? "disabled" : ""}>${signin.busy ? "Sending…" : "Email me a code"}</button></div>
        </form>
        <div class="err" role="alert">${esc(signin.err)}</div>
        <p class="hint">No password needed. Already have someone's hours shared with you? Sign in with the email they shared with.</p>`;
      $("emailForm").addEventListener("submit", sendCode);
    } else {
      el.innerHTML = `
        <h2>Check your email</h2>
        <p class="muted">We sent a sign-in code to <b>${esc(signin.email)}</b>. Enter it here. It can take a minute to arrive, so check your spam folder too.</p>
        <form id="codeForm" class="field" novalidate>
          <label class="label" for="siCode">Code</label>
          <div class="inline"><input id="siCode" class="code" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="123456">
          <button class="btn" type="submit" ${signin.busy ? "disabled" : ""}>${signin.busy ? "Checking…" : "Sign in"}</button></div>
        </form>
        <div class="err" role="alert">${esc(signin.err)}</div>
        <div class="ok-msg">${esc(signin.info)}</div>
        <div class="inline"><button class="link" id="resend">Send a new code</button><button class="link" id="changeEmail">Use a different email</button></div>`;
      $("codeForm").addEventListener("submit", verifyCode);
      $("resend").addEventListener("click", e => { e.preventDefault(); sendCode(null, true); });
      $("changeEmail").addEventListener("click", e => { e.preventDefault(); signin = { step: "email", email: signin.email, busy: false, err: "", info: "" }; renderSync(); });
    }
  } else {
    el.innerHTML = `
      <button type="button" class="collapse" id="syncToggle" aria-expanded="${syncOpen}" aria-controls="syncBody">
        <h2>Sync &amp; sharing</h2><span class="chev" aria-hidden="true"></span></button>
      <div class="syncstate" id="syncState"></div>
      <div class="syncbody" id="syncBody"${syncOpen ? "" : " hidden"}>
      <div class="field">
        <span class="label">Who can see each patient's shifts</span>
        ${shares.length ? sharedGroups().map(g => `<div class="field"><b>${esc(g.person)}</b><ul class="people">${g.items.map(x => {
          const k = shareKey(x);
          return `<li><span>${esc(x.email)}</span>${shareUi.confirm === k
            ? `<span class="inline"><button class="link danger" data-unshare-yes="${esc(k)}">Stop sharing</button><button class="link" data-unshare-no="1">Cancel</button></span>`
            : `<button class="link danger" data-unshare="${esc(k)}">Remove</button>`}</li>`;
        }).join("")}</ul></div>`).join("")
          : `<p class="hint">Nobody yet. Share a patient with the person who pays for their care.</p>`}
      </div>
      ${holdSection()}
      <form id="shareForm" class="field" novalidate>
        <span class="label">Share a patient</span>
        <div class="field"><label class="label" for="sharePerson">Patient</label>
          ${patientSelect("sharePerson", shareUi.person || "")}</div>
        <div class="field"><label class="label" for="shareEmail">Payer's email</label>
          <div class="inline"><input id="shareEmail" type="email" inputmode="email" placeholder="payer@example.com" value="${esc(shareUi.email || "")}">
          <button class="btn" type="submit" ${shareUi.busy ? "disabled" : ""}>Share</button></div></div>
        <div class="err" role="alert">${esc(shareUi.err)}</div>
        <div class="ok-msg">${esc(shareUi.ok || "")}</div>
        <p class="hint">They sign in to Care Hours with that email and see only that patient's shifts, including notes. They can't change anything, and you can remove them any time.</p>
      </form>
      </div>`;
    renderSyncState();
    $("syncToggle").addEventListener("click", () => {
      syncOpen = !syncOpen; setLS(LS_SYNC_OPEN, syncOpen ? "1" : "0");
      $("syncBody").hidden = !syncOpen; $("syncToggle").setAttribute("aria-expanded", String(syncOpen));
    });
    $("shareForm").addEventListener("submit", addShare);
    wireHold();
    $("sharePerson").addEventListener("change", e => { shareUi.person = e.target.value; });
    $("shareEmail").addEventListener("input", e => { shareUi.email = e.target.value; });
    el.querySelectorAll("[data-unshare]").forEach(b => b.addEventListener("click", () => { shareUi.confirm = b.dataset.unshare; renderSync(); }));
    el.querySelectorAll("[data-unshare-no]").forEach(b => b.addEventListener("click", () => { shareUi.confirm = null; renderSync(); }));
    el.querySelectorAll("[data-unshare-yes]").forEach(b => b.addEventListener("click", () => removeShare(b.dataset.unshareYes)));
  }
  if (focusId && $(focusId)) $(focusId).focus();
  renderFoot();
}

// ---------- holding each week until it's shared ----------
// With "Hold each week" on, each patient's weeks are shared on their own, oldest first. Payers see a patient's
// shifts up to the later of profile.shared_through (where holding started) and that patient's row in shared_weeks.
// Sharing only moves forward; the database never lets it move back.
let holdUi = { confirm: null, busy: false, err: "" };   // confirm: "off", or { person, to } for a week to share
const holding = () => !!(profile && profile.hold_weeks);
const sharedThrough = () => (profile && profile.shared_through ? new Date(profile.shared_through) : null);
const lastDayBefore = d => dayFmt.format(addDays(d, -1));          // "Sunday, Nov 8"
const weekWords = (from, to) => `${shortFmt.format(from)} – ${shortFmt.format(addDays(to, -1))}`;
// The new shared-through time is never earlier than the old one.
const later = (a, b) => (!a ? b : !b ? a : a > b ? a : b);
// How far one of my patients is shared.
const patientThrough = person => later(sharedThrough(), myWeeks[samePerson(person)] || null);
// The patients I share with someone, by name, in order.
function heldPatients() {
  const seen = new Map();
  for (const x of shares) if (samePerson(x.person) && !seen.has(samePerson(x.person))) seen.set(samePerson(x.person), x.person);
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
// Each week of a patient's not shared yet, oldest first, through this week (empty weeks too).
function heldWeeks(person) {
  const we = addDays(weekStart(new Date()), 7);
  const thru = patientThrough(person) || weekStart(new Date());
  const out = [];
  for (let w = weekStart(thru); w < we; w = addDays(w, 7)) {
    const from = w < thru ? thru : w, to = addDays(w, 7);
    const ms = mine().filter(x => samePerson(x.person) === samePerson(person) && x.start >= +from && x.start < +to)
      .reduce((t, x) => t + ((x.end || Date.now()) - x.start), 0);
    out.push({ from, to, ms });
  }
  return out;
}

function holdSection() {
  const on = holding(), we = addDays(weekStart(new Date()), 7);
  let body = "";
  if (on) {
    const pats = heldPatients();
    const conf = holdUi.confirm && holdUi.confirm !== "off" ? holdUi.confirm : null;
    const patient = person => {
      const weeks = heldWeeks(person), thru = patientThrough(person);
      const said = thru && thru > new Date(0) ? `Shared through ${esc(lastDayBefore(thru))}.` : "Nothing shared yet.";
      if (!weeks.length) return `<li class="holdpat"><div class="holdhead"><b>${esc(person)}</b><span class="hint">${said} Next week (${esc(weekWords(we, addDays(we, 7)))}) is held until you share it.</span></div></li>`;
      const lines = weeks.map((w, n) => {
        const iso = w.to.toISOString(), asking = conf && samePerson(conf.person) === samePerson(person) && conf.to === iso;
        const btn = n === 0 ? `<button type="button" class="btn" data-share-person="${esc(person)}" data-share-through="${iso}"${holdUi.busy ? " disabled" : ""}
            aria-label="Share ${esc(person)}, ${esc(weekWords(w.from, w.to))}">Share</button>` : "";
        return `<li class="holdweek"><span class="holdrange">${esc(weekWords(w.from, w.to))}${+w.to === +we ? " (this week)" : ""}</span>
          <span class="holdhours">${esc(dur(w.ms))}</span>${btn}
          ${asking ? `<div class="confirm" id="holdConfirm"><span>Payers will see ${esc(person)}'s shifts through ${esc(lastDayBefore(w.to))}. You can't take this back.</span>
            <button class="link" id="holdYes">Share</button><button class="link" id="holdNo">Cancel</button></div>` : ""}</li>`;
      }).join("");
      return `<li class="holdpat"><div class="holdhead"><b>${esc(person)}</b><span class="hint">${said}</span></div>
        <ul class="holdweeks">${lines}</ul></li>`;
    };
    body = `<p class="hint" id="holdStatus">${pats.length
        ? "Each patient's weeks are shared on their own, oldest week first. Payers see a week once you share it."
        : "When you share a patient with someone, their weeks show here to share."}</p>
      ${pats.length ? `<ul class="holdlist">${pats.map(patient).join("")}</ul>` : ""}`;
  }
  const offConfirm = holdUi.confirm === "off" ? `<div class="confirm" id="holdConfirm"><span>Turning this off shares all your shifts now, including this week. You can't take that back.</span>
    <button class="link danger" id="holdYes">Turn off and share</button><button class="link" id="holdNo">Keep holding</button></div>` : "";
  return `<div class="field holdbox" id="holdBox">
      <span class="label">Weekly sharing</span>
      <label class="checkline"><input type="checkbox" id="holdWeeks"${on ? " checked" : ""}${holdUi.busy ? " disabled" : ""}> Hold each week until I share it</label>
      ${on ? "" : `<p class="hint">Off: payers see your shifts as soon as you save them. Turn this on to keep the current week private until you're ready.</p>`}
      ${offConfirm}${body}
      <div class="err" role="alert">${esc(holdUi.err)}</div>
    </div>`;
}
function wireHold() {
  const box = $("holdBox");
  if (!box) return;
  $("holdWeeks").addEventListener("change", e => {
    holdUi.err = "";
    if (e.target.checked) { setHold(true); return; }
    e.target.checked = true;            // stays on until they confirm
    holdUi.confirm = "off"; renderSync();
  });
  box.querySelectorAll("[data-share-through]").forEach(b => b.addEventListener("click", () => {
    holdUi.err = ""; holdUi.confirm = { person: b.dataset.sharePerson, to: b.dataset.shareThrough }; renderSync();
    if ($("holdYes")) $("holdYes").focus();
  }));
  if ($("holdNo")) $("holdNo").addEventListener("click", () => { holdUi.confirm = null; renderSync(); });
  if ($("holdYes")) $("holdYes").addEventListener("click", () => {
    const c = holdUi.confirm; holdUi.confirm = null;
    if (c === "off") setHold(false); else sharePatient(c.person, new Date(c.to));
  });
}
const needsSetup = "Holding weeks needs the latest setup.sql. Run it in Supabase, then try again.";
async function saveHold(fields) {
  holdUi.busy = true; holdUi.err = ""; renderSync();
  const { error } = await sb.from("profiles").upsert({ id: me.id, email: me.email, ...fields });
  holdUi.busy = false;
  if (error) {
    holdUi.err = /hold_weeks|shared_through/i.test(error.message || "") ? needsSetup
      : /unshared/i.test(error.message || "") ? "That week is already shared."
      : "That didn't save. Check your connection and try again.";
  } else Object.assign(profile, fields);
  renderAll();
}
function setHold(on) {
  const ws = weekStart(new Date()), we = addDays(ws, 7), old = sharedThrough();
  // First time on: hold this week. Back on after being off: this week was already visible, so hold from next week.
  if (on) return saveHold({ hold_weeks: true, shared_through: later(old, old ? we : ws).toISOString() });
  return saveHold({ hold_weeks: false, shared_through: later(old, we).toISOString() });
}
// Shares one patient through the end of a week (and every week before it).
async function sharePatient(person, to) {
  const key = samePerson(person), thru = later(patientThrough(person), to);
  holdUi.busy = true; holdUi.err = ""; renderSync();
  const { error } = await sb.from("shared_weeks").upsert({ owner: me.id, person: key, shared_through: thru.toISOString() });
  holdUi.busy = false;
  if (error) {
    holdUi.err = missingTable(error) ? "Sharing each patient's weeks needs the latest setup.sql (version 11). Run it in Supabase, then try again."
      : /unshared/i.test(error.message || "") ? "That week is already shared."
      : "That didn't save. Check your connection and try again.";
    if (missingTable(error)) weeksTable = false;
  } else myWeeks[key] = thru;
  renderAll();
}

// A line on the week card about what payers can't see yet.
function renderHeldNote() {
  const el = $("heldNote");
  if (!el) return;
  let text = "";
  const R = viewRange();
  if (view === "mine" && me && holding() && shares.length) {
    // The patients on screen (one, if a patient is picked) and how far each is shared.
    const pats = heldPatients().filter(p => myPatient === "all" || samePerson(p) === myPatient);
    const thrus = pats.map(p => patientThrough(p) || new Date(0));
    const held = thrus.filter(t => R.end > t);
    if (held.length) text = thrus.every(t => R.start >= t)
      ? "Not shared yet. Payers can't see these shifts until you share them in Sync & sharing."
      : thrus.every(t => +t === +thrus[0])
        ? `Payers can see your shifts through ${lastDayBefore(thrus[0])}. Share the rest in Sync & sharing when you're ready.`
        : "Some of these shifts aren't shared yet. Share them in Sync & sharing when you're ready.";
  } else if (view === "all") {
    const ids = [...new Set(sharedPairs.map(r => r.owner))].filter(id => sharedCaregiver === "all" || id === sharedCaregiver);
    // For each caregiver, the patient they've shared the least of.
    const thruOf = id => {
      const base = caregiverNames[id] && caregiverNames[id].sharedThrough;
      if (!base) return null;
      const ts = sharedPairs.filter(r => r.owner === id).map(r => later(base, (cgWeeks[id] || {})[samePerson(r.person)] || null));
      return ts.length ? new Date(Math.min(...ts.map(Number))) : base;
    };
    text = ids.map(id => ({ id, t: thruOf(id) })).filter(x => x.t && R.end > x.t)
      .map(({ id, t }) => t > new Date(0) ? `${cgName(id)} has shared shifts through ${lastDayBefore(t)}. Later shifts appear when they share them.`
          : `${cgName(id)} hasn't shared any shifts yet.`).join(" ");
  }
  el.textContent = text;
  el.hidden = !text;
}

const emailOk = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
async function sendCode(ev, resend) {
  if (ev) ev.preventDefault();
  const email = resend ? signin.email : ($("siEmail").value || "").trim().toLowerCase();
  if (!emailOk(email)) { signin.err = "Enter your full email address, like name@example.com."; signin.email = email; renderSync(); return; }
  signin = { ...signin, email, busy: true, err: "", info: "" }; renderSync();
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: location.origin + location.pathname } });
  signin.busy = false;
  if (error) {
    signin.err = /rate|too many|seconds/i.test(error.message) ? "Too many codes requested. Wait a minute, then try again."
      : /not authorized/i.test(error.message) ? "This app can't email that address yet. Ask the person who set up Care Hours to finish the email setup."
      : "The code couldn't be sent. Check the address and your connection, then try again.";
    renderSync(); return;
  }
  signin.step = "code"; signin.info = resend ? "A new code is on its way." : "";
  renderSync();
  const c = $("siCode"); if (c) c.focus();
}
async function verifyCode(ev) {
  ev.preventDefault();
  const token = ($("siCode").value || "").replace(/\D/g, "");
  if (token.length < 6) { signin.err = "Enter the code from the email. It's at least 6 digits."; renderSync(); return; }
  signin = { ...signin, busy: true, err: "", info: "" }; renderSync();
  let { error } = await sb.auth.verifyOtp({ email: signin.email, token, type: "email" });
  if (error) { const r2 = await sb.auth.verifyOtp({ email: signin.email, token, type: "signup" }); if (!r2.error) error = null; }
  signin.busy = false;
  if (error) { signin.err = "That code didn't work. It may have expired or been mistyped. Check it, or send a new code."; renderSync(); }
  // On success, onAuthStateChange takes over.
}
async function signOut() {
  signoutConfirm = false;
  await sb.auth.signOut().catch(() => {});
  // The shifts stay safe in the online account; remove them from this device.
  shifts = []; sched = []; pcards = []; pclients = [];
  setLS(LS_OWNER, null); saveLocal();
  onSignedOut();
  renderSync();
}
const shareKey = x => samePerson(x.person) + "|" + x.email;
function sharedGroups() {
  const g = new Map();
  for (const x of shares) {
    const k = samePerson(x.person);
    if (!g.has(k)) g.set(k, { person: x.person, items: [] });
    g.get(k).items.push(x);
  }
  return [...g.values()].sort((a, b) => a.person.localeCompare(b.person));
}
async function addShare(ev) {
  ev.preventDefault();
  const person = ($("sharePerson").value || "").trim();
  const email = ($("shareEmail").value || "").trim().toLowerCase();
  shareUi.err = ""; shareUi.ok = "";
  if (!person) { shareUi.err = "Choose the patient whose shifts you want to share."; renderSync(); $("sharePerson").focus(); return; }
  if (!emailOk(email)) { shareUi.err = "Enter the payer's full email address, like name@example.com."; renderSync(); $("shareEmail").focus(); return; }
  if (email === (me.email || "").toLowerCase()) { shareUi.err = "That's your own email. Enter the email of the person who pays you."; renderSync(); return; }
  const dup = shares.find(x => x.email === email && samePerson(x.person) === samePerson(person));
  if (dup) { shareUi.err = `${email} can already see ${dup.person}'s shifts.`; renderSync(); return; }
  shareUi.busy = true; renderSync();
  const { error } = await sb.from("shares").insert({ owner: me.id, viewer_email: email, person });
  shareUi.busy = false;
  if (error) { shareUi.err = "Sharing didn't save. Check your connection and try again."; renderSync(); return; }
  shares.push({ email, person });
  // Warn when nothing is recorded for this patient yet (shares alone don't count).
  const known = [...mine(), ...liveSched().filter(e => e.kind !== "off")].some(x => samePerson(x.person) === samePerson(person));
  shareUi.ok = known ? `${email} can now see ${person}'s shifts.`
    : `Shared. You don't have any shifts for "${person}" yet; ${email} will see them as you log them.`;
  shareUi.email = ""; shareUi.person = "";
  renderSync();
  loadContacts().then(renderAll);
}
async function removeShare(key) {
  const x = shares.find(x => shareKey(x) === key);
  shareUi.confirm = null; shareUi.ok = "";
  if (!x) { renderSync(); return; }
  const { error } = await sb.from("shares").delete().eq("owner", me.id).eq("viewer_email", x.email).eq("person", x.person);
  if (error) shareUi.err = "That person wasn't removed. Check your connection and try again.";
  else shares = shares.filter(y => y !== x);
  renderSync();
  loadContacts().then(renderAll);
}
