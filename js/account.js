// Care Hours: the Account Card. Who you are (name, address, phone, the email you sign in with), whether you use
// Care Hours as a caregiver or a client, and, for clients, the patients they add (Patient Details).
// All app files share one set of names (classic scripts), and load in the order listed in index.html.
//
// Picking Client gives the payer side of the app (Shifts, Schedule and Caregivers, view only) even before any
// caregiver shares with you. A client's details are saved as their client record, and the patients they add
// are linked to it, so a caregiver who adds the same patient later (same name, date of birth and phone) has to
// be approved by the client (see setup.sql, version 8). Picking Caregiver gives the time clock.

// Caregivers add patients here too. They're asked whether the patient is also the client; the client (or the
// patient) then gets an email to set up their client account. A patient who's already in Care Hours isn't
// added again: their client is asked, in the app and by email, to approve adding the caregiver.
// The emails go out through the "notify" Edge Function (supabase/functions/notify).

const acctUiStart = () => ({ err: "", saved: false, busy: false, pat: null, patErr: "", patBusy: false, confirmDel: null, notice: "" });
let acctUi = acctUiStart();

const myRole = () => (profile && profile.role) || "";
const roleLabel = r => r === "client" ? "Client" : r === "caregiver" ? "Caregiver" : "";

function renderAccount(force) {
  const el = $("account");
  if (!el) return;
  el.hidden = !me || !configured || !sb;
  if (el.hidden) { el.innerHTML = ""; return; }
  // Leave the card alone while someone is typing in it (it redraws while sign-in finishes loading).
  const a = document.activeElement;
  if (!force && a && el.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== "radio") return;
  // Keep what's been typed but not saved yet.
  const typed = {};
  el.querySelectorAll("input, textarea").forEach(f => {
    if (f.type === "radio") { if (f.checked !== f.defaultChecked) typed[f.id] = f.checked; }
    else if (f.id && f.value !== f.defaultValue) typed[f.id] = f.value;
  });
  const role = myRole();
  // Someone a caregiver added as a client, who hasn't picked yet: Client is picked for them, and their client
  // record fills in what they haven't.
  const invited = !role && myClientRecord();
  const shown = role || (invited ? "client" : "");
  const pre = (k, ck) => profile[k] || (invited && invited[ck]) || "";
  const unsynced = allLocal().filter(s => s.dirty).length;
  const confirmText = payerMode() ? "Sign out of Care Hours on this device?" : unsynced
    ? `${unsynced} change${unsynced === 1 ? " hasn't" : "s haven't"} uploaded yet and will be lost if you sign out now.`
    : "Signing out removes your shifts from this device. They stay safe in your online account.";
  const radio = (v, label) => `<label class="checkline"><input type="radio" name="acctRole" id="acctRole${label}" value="${v}"${shown === v ? " checked" : ""}> ${label}</label>`;
  el.innerHTML = `
    <div class="rowline"><h2>Your account</h2><button class="link" id="signOut">Sign out</button></div>
    ${signoutConfirm ? `<div class="confirm"><span>${esc(confirmText)}</span>
      <button class="link danger" id="signOutYes">Sign out</button><button class="link" id="signOutNo">Stay signed in</button></div>` : ""}
    <p class="muted">Signed in as <b>${esc(me.email)}</b>${role ? ` · ${esc(roleLabel(role))}` : ""}</p>
    ${invited ? `<p class="ok-msg" id="acctInvited">A caregiver added you as a client in Care Hours. Check your details, then tap Save.</p>` : ""}
    <form id="nameForm" class="field acctform" novalidate>
      <fieldset class="rolepick"><legend class="label">I use Care Hours as a</legend>
        <div class="inline">${radio("caregiver", "Caregiver")}${radio("client", "Client")}</div>
        <span class="hint">Caregivers clock in and out and plan a schedule. Clients see the hours their caregivers share, and add their patients.</span>
      </fieldset>
      <div class="field"><label class="label" for="dispName">Name</label>
        <input id="dispName" autocomplete="name" maxlength="100" placeholder="${esc(me.email)}" value="${esc(pre("display_name", "name"))}">
        <span class="hint">What the people you share with see.</span></div>
      <div class="field"><label class="label" for="acctAddress">Address</label>
        <textarea id="acctAddress" rows="2" maxlength="500" autocomplete="street-address">${esc(pre("address", "address"))}</textarea></div>
      <div class="field"><label class="label" for="dispPhone">Phone</label>
        <input id="dispPhone" type="tel" inputmode="tel" autocomplete="tel" placeholder="317-555-0123" value="${esc(showPhone(pre("phone", "phone")))}">
        <span class="hint">A mobile number lets the people you share with text you with the Text button.</span></div>
      <div class="field"><span class="label">Email</span><span id="acctEmail">${esc(me.email)}</span>
        <span class="hint">The email you sign in with. It can't be changed here.</span></div>
      <div class="rowline"><button class="btn" type="submit" id="acctSave"${acctUi.busy ? " disabled" : ""}>${acctUi.busy ? "Saving…" : "Save"}</button>
        <span class="ok-msg">${acctUi.saved ? "Saved." : ""}</span></div>
      <div class="err" role="alert">${esc(acctUi.err)}</div>
    </form>
    ${role === "client" ? myPatientsSection() : role === "caregiver" || !payerMode() ? caregiverPatientsSection() : ""}`;
  for (const [id, v] of Object.entries(typed)) if ($(id)) { if (typeof v === "boolean") $(id).checked = v; else $(id).value = v; }
  $("signOut").addEventListener("click", () => { signoutConfirm = true; renderAccount(true); });
  if (signoutConfirm) {
    $("signOutNo").addEventListener("click", () => { signoutConfirm = false; renderAccount(true); });
    $("signOutYes").addEventListener("click", signOut);
  }
  $("nameForm").addEventListener("submit", saveAccount);
  wirePatients(el);
}

async function saveAccount(ev) {
  ev.preventDefault();
  const val = id => ($(id) ? $(id).value : "");
  const fail = m => { acctUi.err = m; acctUi.busy = false; renderAccount(true); };
  const name = val("dispName").replace(/\s+/g, " ").trim().slice(0, 100);
  const address = val("acctAddress").trim().slice(0, 500);
  const phone = normPhone(val("dispPhone"));
  const pick = document.querySelector('input[name="acctRole"]:checked');
  const role = pick ? pick.value : myRole();
  acctUi.err = "";
  if (phone === null) { fail("Enter a phone number with its area code, like 317-555-0123."); $("dispPhone").focus(); return; }
  if (role === "client" && !name) { fail("Enter your name. Your caregivers see it on your patients' cards."); $("dispName").focus(); return; }
  acctUi.busy = true; if ($("acctSave")) { $("acctSave").disabled = true; $("acctSave").textContent = "Saving…"; }
  // Address and role are sent only when they're filled in or the database already has them (version 9),
  // so an older database still saves a name and phone.
  const row = { id: me.id, email: me.email, display_name: name, phone };
  if (address || "address" in profile) row.address = address;
  if (role || "role" in profile) row.role = role;
  let { error } = await sb.from("profiles").upsert(row);
  if (error && /address|role/i.test(error.message || "")) return fail("Saving your address, and whether you're a caregiver or a client, needs the latest setup.sql. Run it in Supabase, then try again.");
  // A database set up before version 4 of setup.sql has no phone column: save the name anyway.
  if (error && /phone/i.test(error.message || "")) {
    if (phone) return fail("Saving a mobile number needs the latest setup.sql. Run it in Supabase, then try again.");
    ({ error } = await sb.from("profiles").upsert({ id: me.id, email: me.email, display_name: name }));
  }
  if (error) return fail("That didn't save. Check your connection and try again.");
  const was = payerMode();
  Object.assign(profile, row); nameSavedNow = name;
  // Saved, so nothing is "being typed" any more.
  document.querySelectorAll("#nameForm input, #nameForm textarea").forEach(f => { if (f.type === "radio") f.defaultChecked = f.checked; else f.defaultValue = f.value; });
  if (role === "client") {
    const cl = await ensureMyClient();
    if (cl.error) acctUi.err = "Your details saved, but your client record didn't. " + cl.error;
  }
  acctUi.busy = false; acctUi.saved = true;
  fitView();
  renderAll(); renderAccount(true);
  if (payerMode() !== was && payerMode()) refreshShared();
  // Clear "Saved." without redrawing the card, which may be in use by then.
  setTimeout(() => { acctUi.saved = false; const ok = document.querySelector("#nameForm .ok-msg"); if (ok) ok.textContent = ""; }, 2500);
}

// ---------- clients: your own client record ----------
// The client record that's you: one you made, or one a caregiver made with your email (and phone).
function myClientRecord() {
  const em = (me && me.email || "").toLowerCase();
  return pclients.find(x => !x.deleted && x.email === em) || Object.values(sharedClients).find(x => !x.deleted && x.email === em) || null;
}
// Makes your client record match your Account Card. Returns { id } or { error }.
async function ensureMyClient() {
  const em = (me.email || "").toLowerCase();
  const d = { name: profile.display_name || em, address: profile.address || "", email: em, phone: profile.phone || "" };
  const own = pclients.find(x => !x.deleted && x.email === em);
  if (own) { putClient({ ...own, ...d }); return { id: own.id }; }
  if (sb) {
    const { data, error } = await sb.from("clients").select("*").eq("email", em);
    if (error && !missingTable(error)) return { error: "Check your connection and try again." };
    const rows = (data || []).filter(r => !r.deleted);
    const hit = rows.find(r => r.phone === d.phone) || rows[0];
    if (hit) {
      // A caregiver already added you as a client: that record is yours too, so keep it up to date.
      const { error: e2 } = await sb.from("clients").update({ name: d.name, address: d.address, phone: d.phone, updated_at: new Date().toISOString() }).eq("id", hit.id);
      if (e2) return { error: e2.code === "23505" ? "Another client in Care Hours already has your email and phone." : "Check your connection and try again." };
      sharedClients[hit.id] = { ...hit, ...d, updatedAt: Date.now() };
      return { id: hit.id };
    }
  }
  const id = newClientId();
  putClient({ id, ...d, updatedAt: 0 });
  return { id };
}

// ---------- clients: Patient Details ----------
function myPatientsSection() {
  const cards = liveCards();
  const row = c => {
    if (acctUi.pat === c.id) return `<li class="apcard open">${patientForm(c)}</li>`;
    const age = ageOf(c.birthDate);
    const sub = [age !== null ? `Age ${age}` : "", c.phone ? showPhone(c.phone) : ""].filter(Boolean).join(" · ");
    return `<li class="apcard${pc(c.person)}"><div class="prow acctpat"><span class="dot"></span>
        <span class="pname"><b>${esc(c.person)}</b>${sub ? `<span class="hint">${esc(sub)}</span>` : ""}</span>
        <span class="inline">${acctUi.confirmDel === c.id
          ? `<span class="confirm">Remove ${esc(c.person)}? <button type="button" class="link danger" data-ap-delyes="${esc(c.id)}">Remove</button>
             <button type="button" class="link" data-ap-delno="1">Cancel</button></span>`
          : `<button type="button" class="link" data-ap-edit="${esc(c.id)}">Edit</button>
             <button type="button" class="link danger" data-ap-del="${esc(c.id)}">Remove</button>`}</span></div></li>`;
  };
  return `<div class="acctpatients" id="acctPatients">
    <div class="rowline"><h3>Patient Details</h3>${acctUi.pat ? "" : `<button type="button" class="ghost" id="acctAddPatient">+ Add patient</button>`}</div>
    ${acctUi.pat === "new" ? patientForm(null) : ""}
    ${cards.length ? `<ul class="pclist">${cards.map(row).join("")}</ul>`
      : acctUi.pat !== "new" ? `<p class="empty">No patients yet. Add the person you arrange care for.</p>` : ""}
    <p class="hint">Your caregivers see these details. A caregiver who adds one of your patients has to be approved by you first, on your Caregivers tab.</p>
  </div>`;
}
// ---------- caregivers: their patients ----------
// The list, with each patient's client, and Open to go to the full card on the Patients tab.
function caregiverPatientsSection() {
  const cards = [...liveCards(), ...memberCards].sort((a, b) => a.person.localeCompare(b.person));
  const row = c => {
    const cl = clientOf(c);
    const sub = c.payerSame ? "Is their own client" : cl && (cl.name || cl.email) ? `Client: ${cl.name || cl.email}` : "No client yet";
    return `<li class="apcard${pc(c.person)}"><div class="prow acctpat"><span class="dot"></span>
      <span class="pname"><b>${esc(c.person)}</b><span class="hint">${esc(sub)}${isMine(c) ? "" : ` · ${esc(ownerName(c.owner))}'s card`}</span></span>
      <button type="button" class="link" data-ap-open="${esc(cardKey(c))}">Open</button></div></li>`;
  };
  return `<div class="acctpatients" id="acctPatients">
    <div class="rowline"><h3>Your patients</h3>${acctUi.pat ? "" : `<button type="button" class="ghost" id="acctAddPatient">+ Add patient</button>`}</div>
    ${acctUi.notice ? `<p class="ok-msg" id="acctNotice">${esc(acctUi.notice)}</p>` : ""}
    ${acctUi.pat === "new" ? patientForm(null, true) : ""}
    ${cards.length ? `<ul class="pclist">${cards.map(row).join("")}</ul>`
      : acctUi.pat !== "new" ? `<p class="empty">No patients yet.</p>` : ""}
    <p class="hint">Each patient's client (the person who pays) gets an email to set up their client account, and sees your shifts for that patient.</p>
  </div>`;
}
function patientForm(c, cg) {
  const v = c || { person: "", birthDate: "", address: "", phone: "", email: "", notes: "" };
  const age = ageOf(v.birthDate);
  const f = (id, label, val, attrs = "") => `<div class="field"><label class="label" for="${id}">${label}</label><input id="${id}" value="${esc(val || "")}" ${attrs}></div>`;
  return `<form class="form pcform" id="apForm" novalidate>
    <h3>${c ? `Edit ${esc(c.person)}` : "New patient"}</h3>
    ${c ? "" : f("apName", "Name", v.person, 'autocomplete="off" maxlength="100"')}
    <div class="field"><label class="label" for="apDob">Date of birth</label>
      <div class="inline"><input id="apDob" type="date" value="${esc(v.birthDate || "")}" max="${dateVal(new Date())}"><span class="hint" id="apAge">${age !== null ? `Age ${age}` : ""}</span></div></div>
    <div class="field"><label class="label" for="apAddress">Address</label><textarea id="apAddress" rows="2" maxlength="500">${esc(v.address || "")}</textarea></div>
    ${f("apPhone", "Phone", v.phone ? showPhone(v.phone) : "", 'type="tel" inputmode="tel" placeholder="317-555-0123"')}
    ${f("apEmail", "Email", v.email, 'type="email" inputmode="email" autocomplete="off" placeholder="name@example.com"')}
    <div class="field"><label class="label" for="apNotes">Notes</label><textarea id="apNotes" rows="3" maxlength="5000" placeholder="Allergies, door code, what to know…">${esc(v.notes || "")}</textarea></div>
    ${cg ? `<fieldset class="rolepick"><legend class="label">Is the patient also the client (the person who pays)?</legend>
        <div class="inline"><label class="checkline"><input type="radio" name="apSame" id="apSameYes" value="yes"> Yes</label>
        <label class="checkline"><input type="radio" name="apSame" id="apSameNo" value="no"> No</label></div>
        <span class="hint" id="apSameHint" hidden>The patient gets an email to set up their client account, so add their email above.</span></fieldset>
      <div class="field" id="apClientWrap" hidden><label class="label" for="apClientEmail">Client's email</label>
        <input id="apClientEmail" type="email" inputmode="email" autocomplete="off" placeholder="client@example.com">
        <span class="hint">They get an email to set up their client account, and see your shifts for this patient.</span></div>` : ""}
    <div class="err" id="apErr" role="alert">${esc(acctUi.patErr)}</div>
    <div class="formacts"><button type="submit" class="btn" id="apSave"${acctUi.patBusy ? " disabled" : ""}>${acctUi.patBusy ? "Saving…" : "Save patient"}</button>
      <button type="button" class="link" id="apCancel">Cancel</button></div>
  </form>`;
}
function wirePatients(el) {
  if ($("acctAddPatient")) $("acctAddPatient").addEventListener("click", () => {
    acctUi = { ...acctUi, pat: "new", patErr: "", confirmDel: null }; renderAccount(true); $("apName").focus();
  });
  el.querySelectorAll("[data-ap-edit]").forEach(b => b.addEventListener("click", () => {
    acctUi = { ...acctUi, pat: b.dataset.apEdit, patErr: "", confirmDel: null }; renderAccount(true); $("apDob").focus();
  }));
  el.querySelectorAll("[data-ap-open]").forEach(b => b.addEventListener("click", () => {
    // The full card, on the Patients tab.
    view = "people"; pcUi = { ...pcUi, open: b.dataset.apOpen, edit: false, isNew: false, notice: "" };
    renderAll(); $("patientsCard").scrollIntoView({ block: "start", behavior: "smooth" });
  }));
  el.querySelectorAll("[data-ap-del]").forEach(b => b.addEventListener("click", () => { acctUi.confirmDel = b.dataset.apDel; renderAccount(true); }));
  el.querySelectorAll("[data-ap-delno]").forEach(b => b.addEventListener("click", () => { acctUi.confirmDel = null; renderAccount(true); }));
  el.querySelectorAll("[data-ap-delyes]").forEach(b => b.addEventListener("click", () => {
    acctUi.confirmDel = null; removeCard(b.dataset.apDelyes); renderAll(); renderAccount(true);
  }));
  if (!$("apForm")) return;
  $("apForm").addEventListener("submit", $("apSameYes") ? saveCaregiverPatient : saveMyPatient);
  el.querySelectorAll('input[name="apSame"]').forEach(r => r.addEventListener("change", () => {
    $("apSameHint").hidden = !$("apSameYes").checked;
    $("apClientWrap").hidden = !$("apSameNo").checked;
  }));
  $("apCancel").addEventListener("click", () => { acctUi = { ...acctUi, pat: null, patErr: "" }; renderAccount(true); });
  $("apDob").addEventListener("input", () => { const a = ageOf($("apDob").value); $("apAge").textContent = a !== null ? `Age ${a}` : ""; });
}
async function saveMyPatient(ev) {
  ev.preventDefault();
  const err = m => { acctUi.patErr = m; acctUi.patBusy = false; $("apErr").textContent = m; if ($("apSave")) { $("apSave").disabled = false; $("apSave").textContent = "Save patient"; } };
  const val = id => ($(id) ? $(id).value.trim() : "");
  const prev = acctUi.pat && acctUi.pat !== "new" ? pcards.find(x => x.id === acctUi.pat && !x.deleted) : null;
  const person = prev ? prev.person : val("apName").replace(/\s+/g, " ");
  if (!person) return err("Enter the patient's name.");
  if (!prev) {
    const dup = liveCards().find(c => samePerson(c.person) === samePerson(person));
    if (dup) return err(`You already have a patient named ${dup.person}.`);
    const theirs = [...sharedCards, ...memberCards].find(c => samePerson(c.person) === samePerson(person));
    if (theirs) return err(`${theirs.person} is already in Care Hours on ${ownerName(theirs.owner)}'s card. You'll find it on your Caregivers tab.`);
  }
  const dob = val("apDob");
  if (dob && (!/^\d{4}-\d\d-\d\d$/.test(dob) || parseDate(dob) > new Date() || dob < "1900-01-01")) return err("Enter a date of birth that isn't in the future.");
  const email = val("apEmail").toLowerCase();
  if (email && !emailOk(email)) return err("Enter the patient's full email address, like name@example.com.");
  let phone = val("apPhone");
  if (phone) { phone = normPhone(phone); if (phone === null) return err("Enter the patient's phone number with its area code, like 317-555-0123."); }
  acctUi.patBusy = true; acctUi.patErr = ""; if ($("apSave")) { $("apSave").disabled = true; $("apSave").textContent = "Saving…"; }
  const cl = await ensureMyClient();
  if (cl.error) return err("That didn't save. " + cl.error);
  const id = prev ? prev.id : cardId(person);
  const old = pcards.find(x => x.id === id);   // a patient removed earlier and added again gets their old card back
  putCard({ ...(old || {}), person, birthDate: dob || null, address: val("apAddress"), email, phone, notes: val("apNotes"),
    payerSame: false, payerRel: (old && old.payerRel) || "", clientId: cl.id, id, deleted: false, updatedAt: old ? old.updatedAt : 0 });
  acctUi = { ...acctUi, pat: null, patErr: "", patBusy: false };
  renderAll(); renderAccount(true);
}

// A caregiver adds a patient. A patient who's already in Care Hours (same name, date of birth and phone) isn't
// added again: their client is asked to approve adding this caregiver, and gets an email about it. Otherwise
// the card is made, the client gets this caregiver's shifts for the patient, and an email to set up their account.
async function saveCaregiverPatient(ev) {
  ev.preventDefault();
  const err = m => { acctUi.patErr = m; acctUi.patBusy = false; $("apErr").textContent = m; if ($("apSave")) { $("apSave").disabled = false; $("apSave").textContent = "Save patient"; } };
  const val = id => ($(id) ? $(id).value.trim() : "");
  const person = val("apName").replace(/\s+/g, " ");
  if (!person) return err("Enter the patient's name.");
  const dup = liveCards().find(c => samePerson(c.person) === samePerson(person));
  if (dup) return err(`You already have a patient named ${dup.person}.`);
  const shared = memberCards.find(c => samePerson(c.person) === samePerson(person));
  if (shared) return err(`${ownerName(shared.owner)} already shares a card for ${shared.person} with you.`);
  const dob = val("apDob");
  if (dob && (!/^\d{4}-\d\d-\d\d$/.test(dob) || parseDate(dob) > new Date() || dob < "1900-01-01")) return err("Enter a date of birth that isn't in the future.");
  const email = val("apEmail").toLowerCase();
  if (email && !emailOk(email)) return err("Enter the patient's full email address, like name@example.com.");
  let phone = val("apPhone");
  if (phone) { phone = normPhone(phone); if (phone === null) return err("Enter the patient's phone number with its area code, like 317-555-0123."); }
  const same = $("apSameYes").checked;
  if (!same && !$("apSameNo").checked) return err("Is the patient also the client? Pick Yes or No.");
  if (same && !email) return err("Enter the patient's email, so they can set up their client account.");
  const clientEmail = same ? email : val("apClientEmail").toLowerCase();
  if (!same && !emailOk(clientEmail)) return err("Enter the client's full email address, like name@example.com.");
  const c = { person, birthDate: dob || null, address: val("apAddress"), email, phone, notes: val("apNotes"), payerSame: same, payerRel: same ? "Self" : "" };
  acctUi.patBusy = true; acctUi.patErr = ""; if ($("apSave")) { $("apSave").disabled = true; $("apSave").textContent = "Saving…"; }

  // Already in Care Hours: ask that patient's client.
  const asked = await requestPatient(c);
  if (asked === "requested" || asked === "already") {
    let notice = asked === "already"
      ? `You've already asked to be added to ${person}. You'll see ${person} once ${person}'s client approves.`
      : `${person} is already in Care Hours, so ${person}'s client has been asked to approve adding you.`;
    if (asked === "requested") {
      const r = await notifyEmail({ action: "request", person });
      notice += r && r.sent === "notice" ? " We emailed them too." : " They'll see it the next time they open Care Hours.";
    }
    acctUi = { ...acctUi, pat: null, patBusy: false, notice };
    await loadCardSharing();
    renderAll(); renderAccount(true);
    return;
  }

  const cl = same ? { name: person, address: c.address, email, phone } : { name: "", address: "", email: clientEmail, phone: "" };
  const client = await resolveClient(null, cl);
  if (client.error) return err(client.error);
  c.clientId = client.id;
  const id = cardId(person);
  const old = pcards.find(x => x.id === id);   // a patient removed earlier and added again gets their old card back
  putCard({ ...(old || {}), ...c, id, deleted: false, updatedAt: old ? old.updatedAt : 0 });
  acctUi = { ...acctUi, pat: null, patBusy: false, notice: `${person} is added.` };
  renderAll(); renderAccount(true);
  acctUi.notice = `${person} is added. ` + await inviteClient(person, clientEmail);
  pcUi.notice = "";   // said here instead
  renderAll(); renderAccount(true);
}
// Shares the patient with their client, then emails the client to set up their account. Returns what happened.
async function inviteClient(person, email) {
  if (!email || email === (me.email || "").toLowerCase()) return "";
  const shared = await sharePayerTo(person, email, null);
  if (!shared || !shares.some(x => x.email === email && samePerson(x.person) === samePerson(person)))
    return `We couldn't email ${email} yet. Check your connection, then share ${person} with them under Sync & sharing.`;
  const r = await notifyEmail({ action: "invite", email, person });
  if (r && r.sent === "invite") return `We emailed ${email} an invitation to set up their client account.`;
  if (r && r.sent === "notice") return `${email} already uses Care Hours, so we emailed them that you added ${person}.`;
  if (r && r.registered) return `${email} already uses Care Hours and will see ${person} the next time they sign in.`;
  return `We couldn't email ${email}. Ask them to sign in to Care Hours with that email to set up their client account.`;
}
// Asks the "notify" Edge Function to send an email. Null when it couldn't (offline, or the function isn't set up).
async function notifyEmail(body) {
  if (!sb || !me || !sb.functions) return null;
  try {
    const { data, error } = await sb.functions.invoke("notify", { body });
    return error ? null : data;
  } catch (e) { return null; }
}
