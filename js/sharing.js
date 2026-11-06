// Care Hours: Signing in, sharing patients with payers, loading what's shared with you, and the account card.
// All app files share one set of names (classic scripts), and load in the order listed in index.html.

async function loadShares() {
  if (!sb || !me) return;
  const [s, p] = await Promise.all([
    sb.from("shares").select("viewer_email, person").eq("owner", me.id).order("created_at"),
    sb.from("profiles").select("*").eq("id", me.id).maybeSingle(),
  ]);
  if (!s.error) shares = s.data.map(r => ({ email: r.viewer_email, person: r.person }));
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
  caregiverNames = {};
  if (ids.length) {
    const pr = await sb.from("profiles").select("id, display_name, email").in("id", ids);
    if (!pr.error) for (const p of pr.data) caregiverNames[p.id] = { name: p.display_name || p.email || "A caregiver", email: p.email || "" };
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
  // Only leave a shared view that has nothing left; never move someone off the tab they chose.
  if (!sharedPatients.length && readOnly()) view = "mine";
  else if (payerMode() && view === "mine") view = "all";   // payers land on all their shared shifts
  else if (payerMode() && view === "plan") view = "pplan";
  await loadSharedShifts();
  renderAll();
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
  startMessaging();
}
function onSignedOut() {
  stopMessaging();
  me = null; nameSavedNow = null; shares = []; profile = { display_name: "" }; sharedPairs = []; sharedPatients = []; sharedAll = []; sharedSched = []; sharedCaregiver = "all"; caregiverNames = {}; view = "mine";
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
async function refreshShared() { await loadSharedShifts(); renderAll(); }

// ================= render: sync & sharing card =================
function syncLine() {
  const pending = allLocal().filter(s => s.dirty && !s.failed).length;
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
// Payers see the short account card on every tab they use, Messages included.
const payerScreen = () => readOnly() || (view === "msgs" && payerMode());
// Your name and mobile number, as the people you share with (or who share with you) see them.
function profileForm(who) {
  return `<form id="nameForm" class="field" novalidate>
        <div class="field"><label class="label" for="dispName">Your name, as ${esc(who)} see it</label>
        <input id="dispName" autocomplete="name" placeholder="${esc(me.email)}" value="${esc(profile.display_name)}"></div>
        <div class="field"><label class="label" for="dispPhone">Your mobile number (optional)</label>
        <input id="dispPhone" type="tel" inputmode="tel" autocomplete="tel" placeholder="317-555-0123" value="${esc(showPhone(profile.phone))}">
        <span class="hint">Lets ${esc(who)} text you with the Text button in Messages.</span></div>
        <div class="rowline"><button class="ghost" type="submit">Save</button>
        <span class="ok-msg">${shareUi.savedName ? "Saved." : ""}</span></div>
        <div class="err" role="alert">${esc(shareUi.nameErr)}</div>
      </form>`;
}
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
  if (!configured || !sb) { el.hidden = true; renderFoot(); return; }
  el.hidden = false;
  const focusId = document.activeElement && el.contains(document.activeElement) ? document.activeElement.id : null;
  // Keep a name that's being typed when the card redraws (it redraws while sign-in finishes loading).
  const nameBox = $("dispName");
  const typedName = nameBox && nameBox.value !== nameBox.defaultValue ? nameBox.value : null;
  const phoneBox = $("dispPhone");
  const typedPhone = phoneBox && phoneBox.value !== phoneBox.defaultValue ? phoneBox.value : null;

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
  } else if (payerScreen()) {
    // Payers only need to know who they're signed in as, their name and number, and a way out.
    el.innerHTML = `
      <div class="rowline"><h2>Your account</h2><button class="link" id="signOut">Sign out</button></div>
      ${signoutConfirm ? `<div class="confirm"><span>Sign out of Care Hours on this device?</span>
        <button class="link danger" id="signOutYes">Sign out</button><button class="link" id="signOutNo">Stay signed in</button></div>` : ""}
      <p class="muted">Signed in as <b>${esc(me.email)}</b></p>
      ${profileForm("the caregivers who share with you")}`;
    $("signOut").addEventListener("click", () => { signoutConfirm = true; renderSync(); });
    if (signoutConfirm) {
      $("signOutNo").addEventListener("click", () => { signoutConfirm = false; renderSync(); });
      $("signOutYes").addEventListener("click", signOut);
    }
    $("nameForm").addEventListener("submit", saveName);
  } else {
    const unsynced = allLocal().filter(s => s.dirty).length;
    el.innerHTML = `
      <button type="button" class="collapse" id="syncToggle" aria-expanded="${syncOpen}" aria-controls="syncBody">
        <h2>Sync &amp; sharing</h2><span class="chev" aria-hidden="true"></span></button>
      <div class="syncstate" id="syncState"></div>
      <div class="syncbody" id="syncBody"${syncOpen ? "" : " hidden"}>
      <div class="rowline"><p class="muted">Signed in as <b>${esc(me.email)}</b></p><button class="link" id="signOut">Sign out</button></div>
      ${signoutConfirm ? `<div class="confirm"><span>${unsynced
        ? `${unsynced} change${unsynced === 1 ? " hasn't" : "s haven't"} uploaded yet and will be lost if you sign out now.`
        : "Signing out removes your shifts from this device. They stay safe in your online account."}</span>
        <button class="link danger" id="signOutYes">Sign out</button><button class="link" id="signOutNo">Stay signed in</button></div>` : ""}
      <hr class="divider">
      ${profileForm("the people you share with")}
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
      <form id="shareForm" class="field" novalidate>
        <span class="label">Share a patient</span>
        <div class="field"><label class="label" for="sharePerson">Patient</label>
          <input id="sharePerson" list="people" autocomplete="off" placeholder="Patient's name" value="${esc(shareUi.person || "")}"></div>
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
    $("signOut").addEventListener("click", () => { signoutConfirm = true; renderSync(); });
    if (signoutConfirm) {
      $("signOutNo").addEventListener("click", () => { signoutConfirm = false; renderSync(); });
      $("signOutYes").addEventListener("click", signOut);
    }
    $("nameForm").addEventListener("submit", saveName);
    $("shareForm").addEventListener("submit", addShare);
    $("sharePerson").addEventListener("input", e => { shareUi.person = e.target.value; });
    $("shareEmail").addEventListener("input", e => { shareUi.email = e.target.value; });
    el.querySelectorAll("[data-unshare]").forEach(b => b.addEventListener("click", () => { shareUi.confirm = b.dataset.unshare; renderSync(); }));
    el.querySelectorAll("[data-unshare-no]").forEach(b => b.addEventListener("click", () => { shareUi.confirm = null; renderSync(); }));
    el.querySelectorAll("[data-unshare-yes]").forEach(b => b.addEventListener("click", () => removeShare(b.dataset.unshareYes)));
  }
  if (typedName !== null && $("dispName")) $("dispName").value = typedName;
  if (typedPhone !== null && $("dispPhone")) $("dispPhone").value = typedPhone;
  if (focusId && $(focusId)) $(focusId).focus();
  renderFoot();
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
  shifts = []; sched = [];
  setLS(LS_OWNER, null); saveLocal();
  onSignedOut();
  renderSync();
}
async function saveName(ev) {
  ev.preventDefault();
  const name = ($("dispName").value || "").trim().slice(0, 100);
  const phone = normPhone($("dispPhone") ? $("dispPhone").value : profile.phone);
  shareUi.nameErr = "";
  if (phone === null) { shareUi.nameErr = "Enter a mobile number with its area code, like 317-555-0123."; renderSync(); $("dispPhone").focus(); return; }
  let { error } = await sb.from("profiles").upsert({ id: me.id, email: me.email, display_name: name, phone });
  // A database set up before version 4 of setup.sql has no phone column: save the name anyway.
  if (error && /phone/i.test(error.message || "")) {
    if (phone) { shareUi.nameErr = "Saving a mobile number needs the latest setup.sql. Run it in Supabase, then try again."; renderSync(); return; }
    ({ error } = await sb.from("profiles").upsert({ id: me.id, email: me.email, display_name: name }));
  }
  if (error) { shareUi.nameErr = "That didn't save. Check your connection and try again."; renderSync(); return; }
  profile.display_name = name; profile.phone = phone; nameSavedNow = name;
  if ($("dispName")) $("dispName").defaultValue = name;   // saved, so it's no longer "being typed"
  if ($("dispPhone")) { $("dispPhone").value = showPhone(phone); $("dispPhone").defaultValue = showPhone(phone); }
  shareUi.savedName = true; renderSync(); setTimeout(() => { shareUi.savedName = false; renderSync(); }, 2500);
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
  const person = matchPatient(($("sharePerson").value || "").replace(/\s+/g, " ").trim());
  const email = ($("shareEmail").value || "").trim().toLowerCase();
  shareUi.err = ""; shareUi.ok = "";
  if (!person) { shareUi.err = "Enter the patient whose shifts you want to share."; renderSync(); $("sharePerson").focus(); return; }
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
    : `Shared. You don't have any shifts for "${person}" yet, so they'll see shifts once you clock in with that exact patient name.`;
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
