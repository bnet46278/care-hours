// Care Hours: Patient cards (name, date of birth, contact details, who pays, notes) and the patient pickers.
// All app files share one set of names (classic scripts), and load in the order listed in index.html.
//
// Caregivers keep a card for each patient. Patients are always picked from this list (clocking in, adding a
// shift, the schedule, sharing), so a name is spelled the same way everywhere.
// Payers who can see a patient can also read and edit that patient's card, but only the caregiver adds,
// renames or removes one (see setup.sql).

let pcUi = { open: null, edit: false, isNew: false, confirmDel: false, err: "", busy: false, returnTo: null,
  memberErr: "", memberOk: "", memberBusy: false, confirmMember: null, confirmLeave: false };
// Who set up a card: shown as "Cynda B.'s card" to the other caregivers and payers.
const ownerName = id => cardOwnerNames[id] || cgName(id);
// The key used for a card's caregivers list.
const memberKey = c => (c.owner || (me && me.id)) + "|" + c.id;
const isMine = c => !c.owner || (me && c.owner === me.id);

// One card per patient name, with the same id on every device, so two phones never make two cards for "Mom".
const cardId = name => "p-" + samePerson(name);
const cardKey = c => (c.owner || "me") + "|" + c.id;

function ageOf(dob, now = new Date()) {
  if (!dob) return null;
  const d = parseDate(dob);
  let a = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) a--;
  return a >= 0 ? a : null;
}
const longDate = dob => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(parseDate(dob));

// Every patient name already used on a shift, the schedule or a share gets a card, so it stays in the list.
// A patient whose card was removed isn't brought back.
function ensureCards() {
  // Patients on a card another caregiver added you to don't need a card of your own.
  const have = new Set([...pcards, ...memberCards].map(c => samePerson(c.person)));
  const used = new Set([...mine(), ...sched.filter(e => !e.deleted && e.kind !== "off"), ...shares].map(x => samePerson(x.person)).filter(Boolean));
  let added = false;
  for (const name of patients()) {
    const k = samePerson(name);
    if (!used.has(k) || have.has(k)) continue;
    // Made with the oldest possible time, so a card saved on another device always wins.
    pcards.push(normCard({ id: cardId(name), person: name, updatedAt: 1, dirty: true }));
    have.add(k); added = true;
  }
  if (added) { saveLocal(); push(); }
}

// ---------- the patient pickers ----------
// A drop-down of the patient list. A patient no longer on the list still shows on an old shift.
function patientSelect(id, selected) {
  const list = patientList();
  const sel = selected ? (list.find(p => samePerson(p) === samePerson(selected)) || selected) : "";
  return `<select id="${id}" data-patients="1">${patientOptions(sel)}</select>
    <button type="button" class="link addpat" data-add-patient="${id}">+ New patient</button>`;
}
function patientOptions(sel) {
  const list = patientList();
  const opts = sel && !list.includes(sel) ? [...list, sel] : list;
  return `<option value="">${list.length ? "Choose a patient" : "No patients yet. Add one first."}</option>` +
    opts.map(p => `<option value="${esc(p)}"${p === sel ? " selected" : ""}>${esc(p)}</option>`).join("");
}
// Keep open forms up to date when a patient is added (the choice already made stays).
function refreshPatientPickers() {
  document.querySelectorAll("select[data-patients]").forEach(s => {
    const v = s.value;
    s.innerHTML = patientOptions(v);
    s.value = v;
  });
}
document.addEventListener("click", e => {
  const b = e.target.closest && e.target.closest("[data-add-patient]");
  if (!b) return;
  e.preventDefault();
  newCard(b.dataset.addPatient);
});

// ---------- the Patients card ----------
function patientsCardShown() { return ["mine", "plan", "all", "pplan"].includes(view); }
function renderPatients() {
  const el = $("patientsCard");
  if (!el) return;
  el.hidden = !patientsCardShown();
  if (el.hidden) return;
  const ro = readOnly();
  // Keep a form intact while someone is typing in it.
  if (pcUi.edit && $("pcForm") && el.contains(document.activeElement)) return;
  const cards = ro ? sharedCardsShown()
    : [...liveCards(), ...memberCards].sort((a, b) => a.person.localeCompare(b.person) || (isMine(a) ? -1 : isMine(b) ? 1 : 0));
  const missing = ro ? sharedWithoutCards() : [];
  const count = cards.length;
  el.innerHTML = `
    <div class="loghead">
      <button type="button" class="collapse inline" id="patientsToggle" aria-expanded="${patientsOpen}" aria-controls="patientsBody">
        <h2>Patients${count ? ` <span class="count">${count}</span>` : ""}</h2><span class="chev" aria-hidden="true"></span></button>
      ${ro ? "" : `<div class="tools"><button class="ghost" id="addPatient">+ Add patient</button></div>`}
    </div>
    <div id="patientsBody"${patientsOpen ? "" : " hidden"}>
      ${pcUi.notice && !ro ? `<p class="ok-msg" id="pcNotice">${esc(pcUi.notice)}</p>` : ""}
      ${pcUi.isNew && !ro ? `<div class="pcnew">${cardForm(null)}</div>` : ""}
      ${count ? `<ul class="pclist">${cards.map(c => cardRow(c, ro)).join("")}</ul>`
        : !pcUi.isNew ? `<p class="empty">${ro ? "No patient cards yet." : "No patients yet. Add a patient to start logging shifts for them."}</p>` : ""}
      ${missing.length ? `<p class="hint">${missing.map(m => `${esc(cgName(m.owner))} hasn't set up a card for ${esc(m.person)} yet.`).join(" ")}</p>` : ""}
      ${ro ? `<p class="hint">You can view and edit these cards. The caregiver sees your changes.</p>` : ""}
    </div>`;
  $("patientsToggle").addEventListener("click", () => {
    patientsOpen = !patientsOpen; setLS(LS_PATIENTS_OPEN, patientsOpen ? "1" : "0"); renderPatients();
  });
  if ($("addPatient")) $("addPatient").addEventListener("click", () => newCard(null));
  el.querySelectorAll("[data-pc]").forEach(b => b.addEventListener("click", () => {
    const k = b.dataset.pc;
    pcUi = { ...pcUi, open: pcUi.open === k && !pcUi.edit ? null : k, edit: false, isNew: false, confirmDel: false, err: "", notice: "",
      memberErr: "", memberOk: "", confirmMember: null, confirmLeave: false };
    renderPatients();
  }));
  // Caregivers on a card.
  if ($("pcInvite")) $("pcInvite").addEventListener("submit", inviteCaregiver);
  el.querySelectorAll("[data-pc-unmember]").forEach(b => b.addEventListener("click", () => { pcUi.confirmMember = b.dataset.pcUnmember; renderPatients(); }));
  el.querySelectorAll("[data-pc-unmember-no]").forEach(b => b.addEventListener("click", () => { pcUi.confirmMember = null; renderPatients(); }));
  el.querySelectorAll("[data-pc-unmember-yes]").forEach(b => b.addEventListener("click", () => removeCaregiver(b.dataset.pcUnmemberYes)));
  el.querySelectorAll("[data-pc-leave]").forEach(b => b.addEventListener("click", () => { pcUi.confirmLeave = true; renderPatients(); }));
  el.querySelectorAll("[data-pc-leave-no]").forEach(b => b.addEventListener("click", () => { pcUi.confirmLeave = false; renderPatients(); }));
  el.querySelectorAll("[data-pc-leave-yes]").forEach(b => b.addEventListener("click", leaveCard));
  el.querySelectorAll("[data-pc-edit]").forEach(b => b.addEventListener("click", () => { pcUi = { ...pcUi, edit: true, err: "" }; renderPatients(); focusForm(); }));
  el.querySelectorAll("[data-pc-del]").forEach(b => b.addEventListener("click", () => { pcUi.confirmDel = true; renderPatients(); }));
  el.querySelectorAll("[data-pc-delno]").forEach(b => b.addEventListener("click", () => { pcUi.confirmDel = false; renderPatients(); }));
  el.querySelectorAll("[data-pc-delyes]").forEach(b => b.addEventListener("click", () => {
    const c = liveCards().find(x => cardKey(x) === pcUi.open);
    pcUi = { ...pcUi, open: null, confirmDel: false };
    if (c) removeCard(c.id);
  }));
  if ($("pcForm")) wireForm();
}
function newCard(returnTo) {
  if (readOnly()) return;
  patientsOpen = true; setLS(LS_PATIENTS_OPEN, "1");
  pcUi = { open: null, edit: true, isNew: true, confirmDel: false, err: "", busy: false, returnTo: returnTo || null };
  renderPatients();
  $("patientsCard").scrollIntoView({ block: "start", behavior: "smooth" });
  focusForm();
}
function focusForm() { const f = $("pcName") || $("pcDob"); if (f) f.focus({ preventScroll: true }); }

function cardRow(c, ro) {
  const k = cardKey(c), open = pcUi.open === k;
  const age = ageOf(c.birthDate);
  const payer = c.payerSame ? "Pays for themselves" : c.payerName ? `Payer: ${c.payerName}${c.payerRel ? ` (${c.payerRel})` : ""}` : "";
  const theirs = !isMine(c);
  const dup = !theirs && !ro && memberCards.find(m => samePerson(m.person) === samePerson(c.person));
  const sub = [age !== null ? `Age ${age}` : "", payer, theirs ? `${ownerName(c.owner)}'s card` : "",
    theirs && !ro ? "shared with you" : "", dup ? `also on ${ownerName(dup.owner)}'s card` : ""].filter(Boolean).join(" · ");
  const color = tint(c);   // patient color for caregivers, caregiver color for payers
  return `<li class="pcard${color}${open ? " open" : ""}">
    <button type="button" class="prow" data-pc="${esc(k)}" aria-expanded="${open}">
      <span class="dot"></span><span class="pname"><b>${esc(c.person)}</b>${sub ? `<span class="hint">${esc(sub)}</span>` : ""}</span></button>
    ${open ? (pcUi.edit ? cardForm(c) : cardDetails(c, ro)) : ""}</li>`;
}
const line = (label, value, html) => value ? `<div class="pcline"><span class="label">${esc(label)}</span><span>${html || esc(value)}</span></div>` : "";
const mail = e => `<a href="mailto:${esc(e)}">${esc(e)}</a>`;
const tel = p => `<a href="tel:${esc(p)}">${esc(showPhone(p))}</a>`;
function cardDetails(c, ro) {
  const age = ageOf(c.birthDate);
  // With "same info", the payer shows the patient's own details.
  const p = c.payerSame ? { name: c.person, rel: "Self", address: c.address, email: c.email, phone: c.phone }
    : { name: c.payerName, rel: c.payerRel, address: c.payerAddress, email: c.payerEmail, phone: c.payerPhone };
  const payer = (c.payerSame ? `<p class="hint">Same as the patient (pays for themselves).</p>` : "") +
    ((line("Name", p.name) + line("Relationship", p.rel) + line("Address", p.address, `<span class="pre">${esc(p.address)}</span>`)
      + line("Email", p.email, mail(p.email)) + line("Phone", p.phone, tel(p.phone))) || `<p class="hint">Not filled in yet.</p>`);
  return `<div class="pcdetails" id="pcDetails">
    <h3>Patient</h3>
    ${line("Date of birth", c.birthDate, c.birthDate ? `${esc(longDate(c.birthDate))} (age ${age})` : "")}
    ${line("Address", c.address, `<span class="pre">${esc(c.address)}</span>`)}
    ${line("Email", c.email, mail(c.email))}
    ${line("Phone", c.phone, tel(c.phone))}
    ${!c.birthDate && !c.address && !c.email && !c.phone ? `<p class="hint">Nothing filled in yet.</p>` : ""}
    <h3>Payer</h3>${payer}
    <h3>Notes</h3>${c.notes ? `<p class="pre">${esc(c.notes)}</p>` : `<p class="hint">No notes.</p>`}
    ${ro ? "" : caregiversSection(c)}
    <div class="formacts">
      <button type="button" class="btn" data-pc-edit="1">Edit</button>
      ${ro || !isMine(c) ? "" : pcUi.confirmDel
        ? `<span class="confirm">Remove ${esc(c.person)} from your patients? Shifts already logged stay.
           <button type="button" class="link danger" data-pc-delyes="1">Remove</button><button type="button" class="link" data-pc-delno="1">Cancel</button></span>`
        : `<button type="button" class="link danger" data-pc-del="1">Remove patient</button>`}
    </div></div>`;
}
function cardForm(c) {
  const v = c || normCard({ id: "", person: "", dirty: false });
  const f = (id, label, val, attrs = "") => `<div class="field"><label class="label" for="${id}">${label}</label><input id="${id}" value="${esc(val)}" ${attrs}></div>`;
  const ta = (id, label, val, rows = 2, ph = "") => `<div class="field"><label class="label" for="${id}">${label}</label><textarea id="${id}" rows="${rows}" placeholder="${esc(ph)}">${esc(val)}</textarea></div>`;
  const age = ageOf(v.birthDate);
  return `<form class="form pcform" id="pcForm" novalidate>
    <h3>${c ? `Edit ${esc(c.person)}` : "New patient"}</h3>
    ${c ? "" : f("pcName", "Patient's name", v.person, 'autocomplete="off" maxlength="100"')}
    <div class="field"><label class="label" for="pcDob">Date of birth</label>
      <div class="inline"><input type="date" id="pcDob" value="${esc(v.birthDate || "")}" max="${dateVal(new Date())}"><span class="hint" id="pcAge">${age !== null ? `Age ${age}` : ""}</span></div></div>
    ${ta("pcAddress", "Address", v.address)}
    ${f("pcEmail", "Email", v.email, 'type="email" inputmode="email" autocomplete="off"')}${f("pcPhone", "Phone", showPhone(v.phone), 'type="tel" inputmode="tel" autocomplete="off"')}
    <fieldset class="payer"><legend>Payer</legend>
      <label class="checkline"><input type="checkbox" id="pcSame"${v.payerSame ? " checked" : ""}> The patient is the payer (same info)</label>
      <div class="row2">${f("pcPayerName", "Payer's name", v.payerName, 'autocomplete="off"')}${f("pcPayerRel", "Relationship to patient", v.payerRel, 'autocomplete="off" placeholder="Daughter, son, spouse…"')}</div>
      ${ta("pcPayerAddress", "Payer's address", v.payerAddress)}
      ${f("pcPayerEmail", "Payer's email", v.payerEmail, 'type="email" inputmode="email" autocomplete="off"')}${f("pcPayerPhone", "Payer's phone", showPhone(v.payerPhone), 'type="tel" inputmode="tel" autocomplete="off"')}
    </fieldset>
    ${ta("pcNotes", "Patient notes", v.notes, 4, "Allergies, routines, who to call, door codes…")}
    <div class="err" id="pcErr" role="alert">${esc(pcUi.err)}</div>
    <div class="formacts"><button class="btn" type="submit" id="pcSave"${pcUi.busy ? " disabled" : ""}>${pcUi.busy ? "Saving…" : c ? "Save changes" : "Add patient"}</button>
      <button class="ghost" type="button" id="pcCancel">Cancel</button></div>
  </form>`;
}
// With "same info" checked, the payer fields show the patient's details and can't be changed separately.
function mirrorPayer() {
  const same = $("pcSame").checked;
  const name = $("pcName") ? $("pcName").value : (currentCard() || {}).person || "";
  const pairs = [["pcPayerName", name], ["pcPayerAddress", $("pcAddress").value], ["pcPayerEmail", $("pcEmail").value], ["pcPayerPhone", $("pcPhone").value], ["pcPayerRel", "Self"]];
  for (const [id, val] of pairs) {
    const el = $(id);
    if (same) { if (!el.dataset.own) el.dataset.own = el.value; el.value = val; }
    else if (el.dataset.own !== undefined) { el.value = el.dataset.own; delete el.dataset.own; }
    el.disabled = same;
  }
}
function wireForm() {
  $("pcForm").addEventListener("submit", saveCard);
  $("pcCancel").addEventListener("click", () => {
    const back = pcUi.returnTo;
    pcUi = { ...pcUi, edit: false, isNew: false, err: "", returnTo: null };
    renderPatients();
    if (back && $(back)) $(back).focus();
  });
  $("pcSame").addEventListener("change", mirrorPayer);
  for (const id of ["pcName", "pcAddress", "pcEmail", "pcPhone"]) if ($(id)) $(id).addEventListener("input", () => { if ($("pcSame").checked) mirrorPayer(); });
  $("pcDob").addEventListener("input", () => { const a = ageOf($("pcDob").value); $("pcAge").textContent = a !== null ? `Age ${a}` : ""; });
  if ($("pcSame").checked) mirrorPayer();
}
function currentCard() {
  if (!pcUi.open) return null;
  return (readOnly() ? sharedCards : [...liveCards(), ...memberCards]).find(c => cardKey(c) === pcUi.open) || null;
}

async function saveCard(ev) {
  ev.preventDefault();
  const err = m => { pcUi.err = m; $("pcErr").textContent = m; };
  const val = id => ($(id) ? $(id).value.trim() : "");
  const prev = pcUi.isNew ? null : currentCard();
  const person = pcUi.isNew ? val("pcName").replace(/\s+/g, " ") : prev && prev.person;
  if (!person) return err("Enter the patient's name.");
  if (pcUi.isNew && liveCards().some(c => samePerson(c.person) === samePerson(person))) return err(`You already have a patient named ${liveCards().find(c => samePerson(c.person) === samePerson(person)).person}.`);
  const shared = pcUi.isNew && memberCards.find(c => samePerson(c.person) === samePerson(person));
  if (shared) return err(`${ownerName(shared.owner)} already shares a card for ${shared.person} with you.`);
  const dob = val("pcDob");
  if (dob && (!/^\d{4}-\d\d-\d\d$/.test(dob) || parseDate(dob) > new Date() || dob < "1900-01-01")) return err("Enter a date of birth that isn't in the future.");
  const same = $("pcSame").checked;
  const c = {
    person, birthDate: dob || null, address: val("pcAddress"), email: val("pcEmail").toLowerCase(), phone: val("pcPhone"), notes: val("pcNotes"),
    payerSame: same, payerName: same ? person : val("pcPayerName"), payerRel: same ? "Self" : val("pcPayerRel"),
    payerAddress: same ? val("pcAddress") : val("pcPayerAddress"), payerEmail: (same ? val("pcEmail") : val("pcPayerEmail")).toLowerCase(),
    payerPhone: same ? val("pcPhone") : val("pcPayerPhone"),
  };
  for (const [k, label] of [["email", "the patient's"], ["payerEmail", "the payer's"]])
    if (c[k] && !emailOk(c[k])) return err(`Enter ${label} full email address, like name@example.com.`);
  for (const [k, label] of [["phone", "the patient's"], ["payerPhone", "the payer's"]]) {
    if (!c[k]) continue;
    const p = normPhone(c[k]);
    if (p === null) return err(`Enter ${label} phone number with its area code, like 317-555-0123.`);
    c[k] = p;
  }
  if (readOnly() || (prev && !isMine(prev))) return saveSharedEdit(prev, c);
  const back = pcUi.returnTo;
  // A patient already in Care Hours (same name, date of birth and phone): join that card instead of making another.
  if (pcUi.isNew) {
    const joined = await joinMatchingPatient(c);
    if (joined) {
      pcUi = { ...pcUi, open: cardKey(joined), edit: false, isNew: false, err: "", returnTo: null,
        notice: `${joined.person} is already in Care Hours, on ${ownerName(joined.owner)}'s card. You've been added to that card instead of making a new one.` };
      renderAll();
      await sharePayer(joined, null);
      pickFor(back, joined.person);
      return;
    }
  }
  // A patient removed earlier and added again gets their old card back.
  const old = pcards.find(x => x.id === (prev ? prev.id : cardId(person)));
  const key = cardKey({ id: old ? old.id : cardId(person) });
  pcUi = { ...pcUi, open: key, edit: false, isNew: false, err: "", returnTo: null, notice: "" };
  putCard({ ...(old || {}), ...c, id: old ? old.id : cardId(person), deleted: false, updatedAt: old ? old.updatedAt : 0 });
  await sharePayer(c, prev);
  pickFor(back, person);
}
// Back to the form that asked for a new patient, with the new patient picked.
function pickFor(back, person) {
  if (!back || !$(back)) return;
  $(back).value = person;
  $(back).dispatchEvent(new Event("change", { bubbles: true }));
  $(back).scrollIntoView({ block: "center", behavior: "smooth" });
  $(back).focus({ preventScroll: true });
}
// Looks for another caregiver's card with the same name, date of birth and phone, and joins it.
async function joinMatchingPatient(c) {
  if (!sb || !me || !c.birthDate || !c.phone) return null;
  const { data: rows, error } = await sb.rpc("join_matching_patient", { the_person: c.person, the_birth: c.birthDate, the_phone: c.phone });
  if (error || !rows || !rows.length) return null;   // no match, offline, or an older database: make a new card
  await loadCardSharing();
  return memberCards.find(m => m.owner === rows[0].owner && m.id === rows[0].id) || null;
}
// The payer on a card gets this caregiver's shifts for the patient: when the card is added or joined,
// or when its payer's email changes.
async function sharePayer(c, prev) {
  if (!sb || !me || readOnly()) return;
  const payerEmail = card => String((card.payerSame ? card.email : card.payerEmail) || "").trim().toLowerCase();
  const email = payerEmail(c);
  if (!emailOk(email) || email === (me.email || "").toLowerCase()) return;
  if (prev && payerEmail(prev) === email) return;
  if (shares.some(x => x.email === email && samePerson(x.person) === samePerson(c.person))) return;
  const { error } = await sb.from("shares").insert({ owner: me.id, viewer_email: email, person: c.person });
  if (error) return;   // offline: they can still share by hand under Sync & sharing
  shares.push({ email, person: c.person });
  const msg = `${c.person}'s payer, ${email}, can now see your shifts for ${c.person}.`;
  pcUi.notice = pcUi.notice ? pcUi.notice + " " + msg : msg;
  renderAll();
  loadContacts().then(renderAll);
}
// Payers, and caregivers on someone else's card, save straight to the online database.
async function saveSharedEdit(prev, c) {
  if (!prev || !sb) return;
  pcUi.busy = true; pcUi.err = ""; renderPatients();
  const row = cardToRow({ ...prev, ...c, updatedAt: Date.now() });
  delete row.owner; delete row.id; delete row.person; delete row.deleted;
  const { error } = await sb.from("patients").update(row).eq("owner", prev.owner).eq("id", prev.id);
  pcUi.busy = false;
  if (error) {
    pcUi.err = isNetworkError(error) ? "That didn't save. Check your connection and try again." : "That didn't save. You may no longer have access to this patient.";
    renderPatients(); return;
  }
  pcUi = { ...pcUi, edit: false, err: "" };
  await loadCardSharing();
  renderAll();
  if (!readOnly()) await sharePayer({ ...prev, ...c }, prev);   // a caregiver on the card who changed the payer's email
}

// ---------- payers: the cards of patients shared with them ----------
function sharedCardsShown() {
  return sharedCards.filter(c => sharedCaregiver === "all" || c.owner === sharedCaregiver)
    .sort((a, b) => a.person.localeCompare(b.person) || cgName(a.owner).localeCompare(cgName(b.owner)));
}
function sharedWithoutCards() {
  // Any card for that patient counts, even one another caregiver set up.
  const have = new Set(sharedCards.map(c => samePerson(c.person)));
  const seen = new Set();
  return sharedPairs.filter(r => (sharedCaregiver === "all" || r.owner === sharedCaregiver) && !have.has(samePerson(r.person)))
    .filter(r => { const k = r.owner + "|" + samePerson(r.person); if (seen.has(k)) return false; seen.add(k); return true; });
}
// Cards other caregivers added you to, cards payers can see, and who's on each card.
async function loadCardSharing() {
  if (!sb || !me) { memberCards = []; sharedCards = []; cardMembers = {}; return; }
  try {
    const owners = await sb.rpc("patient_card_owners");
    if (!owners.error) for (const r of owners.data) cardOwnerNames[r.owner] = r.name;
    let mem = [];
    try { mem = await fetchAll(() => sb.from("patient_members").select("*").order("id")); }
    catch (e) { if (!missingTable(e)) throw e; }   // an older database: no shared cards yet
    const byCard = {};
    for (const m of mem) (byCard[m.owner + "|" + m.id] = byCard[m.owner + "|" + m.id] || []).push(m.member_email);
    for (const k in byCard) byCard[k].sort();
    cardMembers = byCard;
    const myEmail = (me.email || "").toLowerCase();
    const onCard = new Set(mem.filter(m => m.member_email === myEmail).map(m => m.owner + "|" + m.id));
    let rows = [];
    try { rows = await fetchAll(() => sb.from("patients").select("*").neq("owner", me.id).eq("deleted", false).order("id")); }
    catch (e) { if (!missingTable(e)) throw e; }
    const cards = rows.map(r => ({ ...cardFromRow(r), owner: r.owner }));
    memberCards = cards.filter(c => onCard.has(c.owner + "|" + c.id));
    sharedCards = cards.filter(c => !onCard.has(c.owner + "|" + c.id));
    setLS(LS_MEMBER_CARDS, JSON.stringify(memberCards));
  } catch (e) {
    // Offline: keep what's already loaded.
  }
}
function loadMemberCardsSaved() {
  try { const v = JSON.parse(getLS(LS_MEMBER_CARDS) || "[]"); return Array.isArray(v) ? v.filter(c => c && c.owner && c.person) : []; }
  catch (e) { return []; }
}
document.addEventListener("visibilitychange", () => {
  if (me && document.visibilityState === "visible") loadCardSharing().then(renderAll);
});

// ---------- caregivers on a card ----------
function caregiversSection(c) {
  if (!me) return isMine(c) ? `<h3>Caregivers</h3><p class="hint">Sign in under Sync &amp; sharing to add the other caregivers for ${esc(c.person)} to this card.</p>` : "";
  const members = cardMembers[memberKey(c)] || [];
  const myEmail = (me.email || "").toLowerCase();
  const mineCard = isMine(c);
  const items = [`<li><span>${mineCard ? "You" : esc(ownerName(c.owner))}</span><span class="hint">set up this card</span></li>`]
    .concat(members.map(e => {
      const you = e === myEmail;
      const act = !mineCard ? "" : pcUi.confirmMember === e
        ? `<span class="inline"><button type="button" class="link danger" data-pc-unmember-yes="${esc(e)}">Remove</button><button type="button" class="link" data-pc-unmember-no="1">Cancel</button></span>`
        : `<button type="button" class="link danger" data-pc-unmember="${esc(e)}">Remove</button>`;
      return `<li><span>${you ? "You" : esc(e)}</span>${act}</li>`;
    }));
  const dup = mineCard && memberCards.find(m => samePerson(m.person) === samePerson(c.person));
  return `<h3>Caregivers</h3>
    <ul class="people" id="pcCaregivers">${items.join("")}</ul>
    ${dup ? `<p class="hint">${esc(ownerName(dup.owner))} also added you to their card for ${esc(dup.person)}. To keep just one card, remove yours; your shifts for ${esc(c.person)} stay.</p>` : ""}
    ${mineCard ? `<form id="pcInvite" class="field" novalidate>
        <label class="label" for="pcInviteEmail">Add a caregiver</label>
        <div class="inline"><input id="pcInviteEmail" type="email" inputmode="email" autocomplete="off" placeholder="caregiver@example.com" value="${esc(pcUi.inviteEmail || "")}">
        <button class="ghost" type="submit"${pcUi.memberBusy ? " disabled" : ""}>Add</button></div>
        <p class="hint">They sign in to Care Hours with that email. They can see and edit this card and log shifts for ${esc(c.person)}. Only you can add or remove caregivers.</p>
      </form>`
      : pcUi.confirmLeave
        ? `<p class="confirm">Leave ${esc(ownerName(c.owner))}'s card for ${esc(c.person)}? You won't see it any more. Shifts you logged stay.
           <button type="button" class="link danger" data-pc-leave-yes="1">Leave</button><button type="button" class="link" data-pc-leave-no="1">Cancel</button></p>`
        : `<button type="button" class="link danger" data-pc-leave="1">Leave this card</button>`}
    <div class="err" role="alert" id="pcMemberErr">${esc(pcUi.memberErr)}</div>
    <div class="ok-msg" id="pcMemberOk">${esc(pcUi.memberOk)}</div>`;
}
async function inviteCaregiver(ev) {
  ev.preventDefault();
  const c = currentCard();
  const email = ($("pcInviteEmail").value || "").trim().toLowerCase();
  pcUi.inviteEmail = email; pcUi.memberErr = ""; pcUi.memberOk = "";
  const fail = m => { pcUi.memberErr = m; renderPatients(); if ($("pcInviteEmail")) $("pcInviteEmail").focus(); };
  if (!c || !me) return;
  if (!emailOk(email)) return fail("Enter the caregiver's full email address, like name@example.com.");
  if (email === (me.email || "").toLowerCase()) return fail("That's your own email.");
  if ((cardMembers[memberKey(c)] || []).includes(email)) return fail(`${email} is already on this card.`);
  pcUi.memberBusy = true; renderPatients();
  // The card has to be online before someone can be added to it.
  await push();
  const saved = pcards.find(x => x.id === c.id);
  let error = saved && saved.dirty ? { message: "fetch" } : null;
  if (!error) ({ error } = await sb.from("patient_members").insert({ owner: me.id, id: c.id, member_email: email }));
  pcUi.memberBusy = false;
  if (error) return fail(missingTable(error) ? "Adding caregivers to a card needs the latest setup.sql. Run it in Supabase, then try again."
    : /duplicate/i.test(error.message || "") ? `${email} is already on this card.`
    : "That didn't save. Check your connection and try again.");
  pcUi.inviteEmail = "";
  pcUi.memberOk = `${email} can now see and edit ${c.person}'s card.`;
  await loadCardSharing();
  renderAll();
}
async function removeCaregiver(email) {
  const c = currentCard();
  pcUi.confirmMember = null; pcUi.memberErr = ""; pcUi.memberOk = "";
  if (!c || !me) return;
  const { error } = await sb.from("patient_members").delete().eq("owner", me.id).eq("id", c.id).eq("member_email", email);
  if (error) pcUi.memberErr = "That caregiver wasn't removed. Check your connection and try again.";
  await loadCardSharing();
  renderAll();
}
async function leaveCard() {
  const c = currentCard();
  pcUi.confirmLeave = false; pcUi.memberErr = "";
  if (!c || !me) return;
  const { error } = await sb.from("patient_members").delete().eq("owner", c.owner).eq("id", c.id).eq("member_email", (me.email || "").toLowerCase());
  if (error) { pcUi.memberErr = "You weren't removed. Check your connection and try again."; renderPatients(); return; }
  pcUi.open = null;
  await loadCardSharing();
  renderAll();
}
