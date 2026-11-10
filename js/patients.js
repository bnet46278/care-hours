// Care Hours: the Patients tab (Caregivers, for payers; Client Details and Patient Details for each patient) and the patient pickers.
// All app files share one set of names (classic scripts), and load in the order listed in index.html.
//
// Caregivers keep a card for each patient. Patients are always picked from this list (clocking in, adding a
// shift, the schedule, sharing), so a name is spelled the same way everywhere.
// A client (the person who pays) is its own record, found by email and phone together, so the same client
// is never added twice; one client can have several patients. Payers and clients can read and edit the
// cards of their patients, but only a caregiver adds one, and only the caregiver who set it up renames or
// removes it (see setup.sql).

let pcUi = { open: null, edit: false, isNew: false, confirmDel: false, err: "", busy: false, returnTo: null, notice: "",
  memberErr: "", memberOk: "", memberBusy: false, confirmMember: null, confirmLeave: false };
// Who set up a card: shown as "Cynda B.'s card" to the other caregivers and payers.
const ownerName = id => cardOwnerNames[id] || cgName(id);
// The key used for a card's caregivers list.
const memberKey = c => (c.owner || (me && me.id)) + "|" + c.id;
const isMine = c => !c.owner || (me && c.owner === me.id);
// A card you see as its client or payer (not as one of its caregivers): you can edit it, not manage it.
const asPayer = c => readOnly() || sharedCards.includes(c);

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

// ---------- clients ----------
// The client of a card: your own client record, someone else's that the card is linked to, or (for a card
// made before clients were their own records) the payer details saved on the card.
function clientOf(c) {
  if (!c) return null;
  if (c.clientId) {
    const own = pclients.find(x => x.id === c.clientId && !x.deleted);
    if (own) return own;
    if (sharedClients[c.clientId]) return sharedClients[c.clientId];
  }
  if (c.payerSame) return { id: null, name: c.person, address: c.address, email: c.email, phone: c.phone, legacy: true };
  if (c.payerName || c.payerEmail || c.payerPhone || c.payerAddress)
    return { id: null, name: c.payerName, address: c.payerAddress, email: c.payerEmail, phone: c.payerPhone, legacy: true };
  return null;
}
const clientEmailOf = c => String((clientOf(c) || {}).email || "").trim().toLowerCase();
const newClientId = () => "c-" + newId();
// Another device added the same client (email and phone) before this one could: use that client instead.
async function relinkDuplicateClient(x) {
  if (!sb || !me) return;
  const { data: rows, error } = await sb.rpc("find_client", { the_email: x.email, the_phone: x.phone });
  if (error || !rows || !rows.length) { const cur = pclients.find(y => y.id === x.id); if (cur) cur.failed = true; return; }
  const found = rows[0];
  sharedClients[found.id] = { ...found, updatedAt: Date.now() };
  for (const c of pcards) if (c.clientId === x.id) putCard({ ...c, clientId: found.id });
  pclients = pclients.filter(y => y.id !== x.id);
  saveLocal();
}

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

// ---------- the Patients tab (caregivers) ----------
// The tab shows the cards. "+ New patient" next to a picker on another tab opens just the form there.
const peopleTab = () => view === "people" || view === "ppeople";
function patientsCardShown() { return peopleTab() || (pcUi.isNew && !!pcUi.returnTo); }
function renderPatients() {
  const el = $("patientsCard");
  if (!el) return;
  el.hidden = !patientsCardShown();
  if (el.hidden) { el.innerHTML = ""; return; }   // nothing left behind, such as a closed form
  const ro = readOnly();
  // Keep a form intact while someone is typing in it.
  if (pcUi.edit && $("pcForm") && el.contains(document.activeElement)) return;
  // Just the new-patient form, when it was opened from a picker on another tab.
  if (!peopleTab()) {
    el.innerHTML = `<h2>New patient</h2><div id="patientsBody">${cardForm(null)}</div>`;
    wireForm();
    return;
  }
  if (ro) { renderCaregivers(el); return; }   // payers: a list of their caregivers instead
  // Caregivers also see the cards of patients they're the client or payer of.
  const cards = ro ? sharedCardsShown()
    : [...liveCards(), ...memberCards, ...sharedCards].sort((a, b) => a.person.localeCompare(b.person) || (isMine(a) ? -1 : isMine(b) ? 1 : 0));
  const missing = ro ? sharedWithoutCards() : [];
  el.innerHTML = `
    <div class="loghead">
      <h2>Patients</h2>
      ${ro ? "" : `<div class="tools"><button class="ghost" id="addPatient">+ Add patient</button></div>`}
    </div>
    <div id="patientsBody">
      ${requestsSection()}
      ${pcUi.notice ? `<p class="ok-msg" id="pcNotice">${esc(pcUi.notice)}</p>` : ""}
      ${pcUi.isNew && !ro ? `<div class="pcnew">${cardForm(null)}</div>` : ""}
      ${cards.length ? `<ul class="pclist">${cards.map(c => cardRow(c, asPayer(c))).join("")}</ul>`
        : !pcUi.isNew ? `<p class="empty">${ro ? "No patient cards yet." : "No patients yet. Add a patient to start logging shifts for them."}</p>` : ""}
      ${missing.length ? `<p class="hint">${missing.map(m => `${esc(cgName(m.owner))} hasn't set up a card for ${esc(m.person)} yet.`).join(" ")}</p>` : ""}
      ${ro ? `<p class="hint">You can view and edit these cards. The caregivers see your changes.</p>` : ""}
    </div>`;
  if ($("addPatient")) $("addPatient").addEventListener("click", () => newCard(null));
  wireCards(el);
}
// What happens when a card, a request or a caregiver on a card is tapped (both lists).
function wireCards(el) {
  el.querySelectorAll("[data-req-approve]").forEach(b => b.addEventListener("click", () => answerRequest(b.dataset.reqApprove, true)));
  el.querySelectorAll("[data-req-decline]").forEach(b => b.addEventListener("click", () => answerRequest(b.dataset.reqDecline, false)));
  el.querySelectorAll("[data-req-cancel]").forEach(b => b.addEventListener("click", () => answerRequest(b.dataset.reqCancel, false)));
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
  wireMessageButtons(el);
  if ($("pcForm")) wireForm();
}
// ---------- payers: the Caregivers tab ----------
// Each caregiver who shares with the payer, with their contact details and the cards of the patients they care for.
const tabPeopleLabel = () => payerMode() ? "Caregivers" : "Patients";
function cardsOfCaregiver(id) {
  // One card per patient: the caregiver's own card if they set one up, otherwise any card for that patient
  // (including one a client set up on their Account Card).
  return patientsOf(id).map(person => {
    const same = [...sharedCards, ...liveCards()].filter(c => samePerson(c.person) === samePerson(person));
    return { person, card: same.find(c => c.owner === id) || same[0] || null };
  });
}
function renderCaregivers(el) {
  const ids = sharedCaregivers();   // all of them: the caregiver picker isn't on this tab
  const openId = ids.length === 1 ? ids[0] : pcUi.openCg;
  const row = id => {
    const open = id === openId, info = caregiverNames[id] || {}, contact = (typeof contactById === "function" && contactById(id)) || {};
    const email = info.email || contact.email || "", phone = contact.phone || "";
    const pats = cardsOfCaregiver(id);
    const cards = pats.filter(p => p.card), noCard = pats.filter(p => !p.card);
    return `<li class="pcard cgcard${cc(id)}${open ? " open" : ""}">
      <button type="button" class="prow" data-cg="${esc(id)}" aria-expanded="${open}">
        <span class="dot"></span><span class="pname"><b>${esc(cgName(id))}</b>${pats.length ? `<span class="hint">Caring for ${esc(pats.map(p => p.person).join(", "))}</span>` : ""}</span></button>
      ${open ? `<div class="pcdetails cgdetails">
        <h3>Caregiver Details</h3>
        ${line("Name", cgName(id)) + line("Phone", phone, tel(phone)) + line("Email", email, mail(email))}
        ${cgMessages(id)}
        <h3>Patients</h3>
        ${cards.length ? `<ul class="pclist">${cards.map(p => cardRow(p.card, true)).join("")}</ul>` : ""}
        ${noCard.length ? `<p class="hint">${noCard.map(p => `${esc(cgName(id))} hasn't set up a card for ${esc(p.person)} yet.`).join(" ")}</p>` : ""}
        ${cards.length ? `<p class="hint">Open a patient to see or edit their card. The caregivers see your changes.</p>` : ""}
      </div>` : ""}</li>`;
  };
  el.innerHTML = `
    <div class="loghead"><h2>Caregivers</h2></div>
    <div id="patientsBody">
      ${requestsSection()}
      ${pcUi.notice ? `<p class="ok-msg" id="pcNotice">${esc(pcUi.notice)}</p>` : ""}
      ${ids.length ? `<ul class="pclist">${ids.map(row).join("")}</ul>` : `<p class="empty">No caregivers share with you yet.</p>`}
    </div>`;
  el.querySelectorAll("[data-cg]").forEach(b => b.addEventListener("click", () => {
    const id = b.dataset.cg;
    pcUi = { ...pcUi, openCg: openId === id ? null : id, open: null, edit: false, confirmDel: false, err: "", notice: "",
      memberErr: "", memberOk: "", confirmMember: null, confirmLeave: false };
    renderPatients();
  }));
  wireCards(el);
}

function newCard(returnTo) {
  if (readOnly()) return;
  pcUi = { ...pcUi, open: null, edit: true, isNew: true, confirmDel: false, err: "", busy: false, returnTo: returnTo || null, notice: "" };
  renderPatients();
  $("patientsCard").scrollIntoView({ block: "start", behavior: "smooth" });
  focusForm();
}
function focusForm() { const f = $("pcClientName") || $("pcDob"); if (f && !f.disabled) f.focus({ preventScroll: true }); }

function cardRow(c, ro) {
  const k = cardKey(c), open = pcUi.open === k;
  const age = ageOf(c.birthDate);
  const cl = clientOf(c);
  const payer = c.payerSame ? `Client: ${c.person} (Self)` : cl && cl.name ? `Client: ${cl.name}${c.payerRel ? ` (${c.payerRel})` : ""}` : "";
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
  const cl = c.payerSame ? { name: c.person, address: c.address, email: c.email, phone: c.phone } : clientOf(c) || {};
  const client = (c.payerSame ? `<p class="hint">Same as the patient (pays for themselves).</p>` : "") +
    ((line("Name", cl.name) + line("Relationship to patient", c.payerSame ? "Self" : c.payerRel)
      + line("Address", cl.address, `<span class="pre">${esc(cl.address || "")}</span>`)
      + line("Phone", cl.phone, tel(cl.phone)) + line("Email", cl.email, mail(cl.email))) || `<p class="hint">Not filled in yet.</p>`);
  const patient = line("Name", c.person) + line("Date of birth", c.birthDate, c.birthDate ? `${esc(longDate(c.birthDate))} (age ${age})` : "")
    + line("Address", c.address, `<span class="pre">${esc(c.address)}</span>`) + line("Phone", c.phone, tel(c.phone)) + line("Email", c.email, mail(c.email));
  return `<div class="pcdetails" id="pcDetails">
    <h3>Client Details</h3>${client}
    <h3>Patient Details</h3>${patient}
    <div class="pcline"><span class="label">Notes</span>${c.notes ? `<span class="pre">${esc(c.notes)}</span>` : `<span class="hint">No notes.</span>`}</div>
    ${patientMessages(c)}
    ${caregiversSection(c, ro)}
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
  const cl = (c && !c.payerSame && clientOf(c)) || { name: "", address: "", email: "", phone: "" };
  const f = (id, label, val, attrs = "") => `<div class="field"><label class="label" for="${id}">${label}</label><input id="${id}" value="${esc(val)}" ${attrs}></div>`;
  const ta = (id, label, val, rows = 2, ph = "") => `<div class="field"><label class="label" for="${id}">${label}</label><textarea id="${id}" rows="${rows}" placeholder="${esc(ph)}">${esc(val)}</textarea></div>`;
  const age = ageOf(v.birthDate);
  return `<form class="form pcform" id="pcForm" novalidate>
    <h3>${c ? `Edit ${esc(c.person)}` : "New patient"}</h3>
    <fieldset class="payer"><legend>Client Details</legend>
      <label class="checkline"><input type="checkbox" id="pcSame"${v.payerSame ? " checked" : ""}> The patient is the client (same details)</label>
      ${f("pcClientName", "Name", cl.name, 'autocomplete="off" maxlength="100"')}
      ${f("pcClientRel", "Relationship to patient", v.payerRel, 'autocomplete="off" placeholder="Daughter, son, spouse…"')}
      ${ta("pcClientAddress", "Address", cl.address)}
      ${f("pcClientPhone", "Phone", showPhone(cl.phone), 'type="tel" inputmode="tel" autocomplete="off"')}
      ${f("pcClientEmail", "Email", cl.email, 'type="email" inputmode="email" autocomplete="off"')}
      <p class="hint">A client who's already in Care Hours (same email and phone) is linked, not added again.</p>
    </fieldset>
    <fieldset class="payer"><legend>Patient Details</legend>
      ${c ? `<div class="field"><span class="label">Name</span><b>${esc(c.person)}</b></div>` : f("pcName", "Name", v.person, 'autocomplete="off" maxlength="100"')}
      <div class="field"><label class="label" for="pcDob">Date of birth</label>
        <div class="inline"><input type="date" id="pcDob" value="${esc(v.birthDate || "")}" max="${dateVal(new Date())}"><span class="hint" id="pcAge">${age !== null ? `Age ${age}` : ""}</span></div></div>
      ${ta("pcAddress", "Address", v.address)}
      ${f("pcPhone", "Phone", showPhone(v.phone), 'type="tel" inputmode="tel" autocomplete="off"')}
      ${f("pcEmail", "Email", v.email, 'type="email" inputmode="email" autocomplete="off"')}
      ${ta("pcNotes", "Notes", v.notes, 4, "Allergies, routines, who to call, door codes…")}
    </fieldset>
    <div class="err" id="pcErr" role="alert">${esc(pcUi.err)}</div>
    <div class="formacts"><button class="btn" type="submit" id="pcSave"${pcUi.busy ? " disabled" : ""}>${pcUi.busy ? "Saving…" : c ? "Save changes" : "Add patient"}</button>
      <button class="ghost" type="button" id="pcCancel">Cancel</button></div>
  </form>`;
}
// With "same details" checked, the client fields show the patient's details and can't be changed separately.
function mirrorPayer() {
  const same = $("pcSame").checked;
  const name = $("pcName") ? $("pcName").value : (currentCard() || {}).person || "";
  const pairs = [["pcClientName", name], ["pcClientAddress", $("pcAddress").value], ["pcClientEmail", $("pcEmail").value],
    ["pcClientPhone", $("pcPhone").value], ["pcClientRel", "Self"]];
  for (const [id, val] of pairs) {
    const el = $(id);
    if (same) { if (el.dataset.own === undefined) el.dataset.own = el.value; el.value = val; }
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
    if (back && $(back)) { $(back).scrollIntoView({ block: "center" }); $(back).focus(); }
  });
  $("pcSame").addEventListener("change", mirrorPayer);
  for (const id of ["pcName", "pcAddress", "pcEmail", "pcPhone"]) if ($(id)) $(id).addEventListener("input", () => { if ($("pcSame").checked) mirrorPayer(); });
  $("pcDob").addEventListener("input", () => { const a = ageOf($("pcDob").value); $("pcAge").textContent = a !== null ? `Age ${a}` : ""; });
  if ($("pcSame").checked) mirrorPayer();
}
function currentCard() {
  if (!pcUi.open) return null;
  return (readOnly() ? [...sharedCards, ...liveCards()] : [...liveCards(), ...memberCards, ...sharedCards]).find(c => cardKey(c) === pcUi.open) || null;
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
  const c = { person, birthDate: dob || null, address: val("pcAddress"), email: val("pcEmail").toLowerCase(), phone: val("pcPhone"), notes: val("pcNotes"),
    payerSame: same, payerRel: same ? "Self" : val("pcClientRel") };
  const cl = same ? { name: person, address: c.address, email: c.email, phone: c.phone }
    : { name: val("pcClientName").replace(/\s+/g, " "), address: val("pcClientAddress"), email: val("pcClientEmail").toLowerCase(), phone: val("pcClientPhone") };
  if (cl.email && !emailOk(cl.email)) return err("Enter the client's full email address, like name@example.com.");
  if (c.email && !emailOk(c.email)) return err("Enter the patient's full email address, like name@example.com.");
  for (const [o, k, label] of [[cl, "phone", "the client's"], [c, "phone", "the patient's"]]) {
    if (!o[k]) continue;
    const p = normPhone(o[k]);
    if (p === null) return err(`Enter ${label} phone number with its area code, like 317-555-0123.`);
    o[k] = p;
  }
  if (same) cl.phone = c.phone;
  const back = pcUi.returnTo;
  const prevEmail = prev ? clientEmailOf(prev) : null;   // before the client is changed below
  // A patient already in Care Hours (same name, date of birth and phone) isn't added again: their client is
  // asked to approve adding this caregiver.
  const isNew = pcUi.isNew;
  if (isNew) {
    const asked = await requestPatient(c);
    if (asked === "requested" || asked === "already") {
      // The client also gets an email about it (when the "notify" Edge Function is set up).
      const mailed = asked === "requested" && await notifyEmail({ action: "request", person });
      pcUi = { ...pcUi, edit: false, isNew: false, err: "", returnTo: null,
        notice: asked === "requested"
          ? `${person} is already in Care Hours, so ${person}'s client has been asked to approve adding you. You'll see ${person} here once they do.`
            + (mailed && mailed.sent === "notice" ? " We emailed them too." : "")
          : `You've already asked to be added to ${person}. You'll see ${person} here once ${person}'s client approves.` };
      await loadCardSharing();
      renderAll();
      if (back && $(back)) { $(back).scrollIntoView({ block: "center" }); $(back).focus(); }
      return;
    }
  }
  pcUi.busy = true; pcUi.err = ""; if ($("pcSave")) { $("pcSave").disabled = true; $("pcSave").textContent = "Saving…"; }
  const client = await resolveClient(prev, cl);
  pcUi.busy = false;
  if (client.error) return err(client.error);
  c.clientId = client.id;
  if (prev ? !isMine(prev) : readOnly()) return saveSharedEdit(prev, c, client, prevEmail);   // a client's own card saves like any of yours
  // A patient removed earlier and added again gets their old card back.
  const old = pcards.find(x => x.id === (prev ? prev.id : cardId(person)));
  const key = cardKey({ id: old ? old.id : cardId(person) });
  pcUi = { ...pcUi, open: key, edit: false, isNew: false, err: "", returnTo: null, notice: client.notice || "" };
  putCard({ ...(old || {}), ...c, id: old ? old.id : cardId(person), deleted: false, updatedAt: old ? old.updatedAt : 0 });
  renderAll();
  const clientEmail = clientEmailOf(pcards.find(x => x.id === (old ? old.id : cardId(person))));
  if (isNew && clientEmail && clientEmail !== (me && me.email || "").toLowerCase() && sb && me) {
    // A new patient's client gets this caregiver's shifts, and an email to set up their client account.
    const said = await inviteClient(person, clientEmail);
    pcUi.notice = [pcUi.notice, said].filter(Boolean).join(" ");
    renderAll();
  } else {
    await sharePayerTo(person, clientEmail, prevEmail);
  }
  pickFor(back, person);
}

// Works out which client record a card points to, after the client details were filled in:
//   * no client details: no client;
//   * email and phone match a client already in Care Hours: link to that client (it isn't added again);
//   * the card already has a client: update it;
//   * otherwise: a new client.
// Returns { id, notice } or { error }.
async function resolveClient(prev, cl) {
  const empty = !cl.name && !cl.address && !cl.email && !cl.phone;
  const cur = prev && prev.clientId ? (pclients.find(x => x.id === prev.clientId) || sharedClients[prev.clientId]) : null;
  if (empty) return { id: null };
  const sameKey = cur && cur.email === cl.email && cur.phone === cl.phone;
  if (!sameKey && cl.email && cl.phone && sb && me) {
    const { data: rows, error } = await sb.rpc("find_client", { the_email: cl.email, the_phone: cl.phone });
    if (!error && rows && rows.length && (!cur || rows[0].id !== cur.id)) {
      const found = rows[0];
      if (!pclients.some(x => x.id === found.id)) sharedClients[found.id] = { ...found, updatedAt: Date.now() };
      return { id: found.id, notice: `${found.name || found.email} is already a client in Care Hours, so this patient is linked to that client.` };
    }
  }
  if (cur) {
    const mineClient = pclients.find(x => x.id === cur.id);
    if (mineClient) { putClient({ ...mineClient, ...cl }); return { id: cur.id }; }
    // Someone else's client: change it online.
    if (!sb) return { error: "That didn't save. Check your connection and try again." };
    const { error } = await sb.from("clients").update({ name: cl.name, address: cl.address, email: cl.email, phone: cl.phone, updated_at: new Date().toISOString() }).eq("id", cur.id);
    if (error) return { error: error.code === "23505" ? "Another client already has that email and phone." : "That didn't save. Check your connection and try again." };
    sharedClients[cur.id] = { ...cur, ...cl };
    return { id: cur.id };
  }
  const id = newClientId();
  if (readOnly() || (prev && !isMine(prev))) {
    // Payers and caregivers on someone else's card add the client online.
    if (!sb || !me) return { error: "That didn't save. Check your connection and try again." };
    const { error } = await sb.from("clients").insert({ owner: me.id, id, name: cl.name, address: cl.address, email: cl.email, phone: cl.phone });
    if (error) return { error: "That didn't save. Check your connection and try again." };
    sharedClients[id] = { id, ...cl, updatedAt: Date.now() };
    return { id };
  }
  putClient({ id, ...cl, updatedAt: 0 });
  return { id };
}
// Asks to be added to a patient who's already in Care Hours. "requested", "already" or "none".
async function requestPatient(c) {
  if (!sb || !me || !c.birthDate || !c.phone) return "none";
  const { data, error } = await sb.rpc("request_patient", { the_person: c.person, the_birth: c.birthDate, the_phone: c.phone });
  return error ? "none" : data;   // offline or an older database: add the patient
}
// Back to the form that asked for a new patient, with the new patient picked.
function pickFor(back, person) {
  if (!back || !$(back)) return;
  $(back).value = person;
  $(back).dispatchEvent(new Event("change", { bubbles: true }));
  $(back).scrollIntoView({ block: "center", behavior: "smooth" });
  $(back).focus({ preventScroll: true });
}
// The client of a card gets this caregiver's shifts for the patient: when the card is added, when the
// caregiver is added to someone else's card, or when the client's email changes.
async function sharePayerTo(person, email, prevEmail) {
  if (!sb || !me || readOnly()) return false;
  email = String(email || "").trim().toLowerCase();
  if (!emailOk(email) || email === (me.email || "").toLowerCase()) return true;   // nothing to share
  if (prevEmail !== null && prevEmail !== undefined && String(prevEmail).toLowerCase() === email) return true;
  if (shares.some(x => x.email === email && samePerson(x.person) === samePerson(person))) return true;
  const { error } = await sb.from("shares").insert({ owner: me.id, viewer_email: email, person });
  if (error) return false;   // offline: tried again later, or they can share by hand under Sync & sharing
  shares.push({ email, person });
  const msg = `${person}'s client, ${email}, can now see your shifts for ${person}.`;
  pcUi.notice = pcUi.notice ? pcUi.notice + " " + msg : msg;
  renderAll();
  loadContacts().then(renderAll);
  return true;
}
// Payers, and caregivers on someone else's card, save straight to the online database.
async function saveSharedEdit(prev, c, client, prevEmail) {
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
  pcUi = { ...pcUi, edit: false, err: "", notice: (client && client.notice) || "" };
  const onCard = memberCards.includes(prev);
  await loadCardSharing();
  renderAll();
  if (onCard && !readOnly()) {   // a caregiver on the card who changed the client's email
    const now = [...memberCards].find(x => x.owner === prev.owner && x.id === prev.id);
    await sharePayerTo(prev.person, clientEmailOf(now || { ...prev, ...c }), prevEmail);
  }
}

// ---------- payers: the cards of patients shared with them ----------
function sharedCardsShown() {
  return sharedCards.filter(c => peopleTab() || sharedCaregiver === "all" || c.owner === sharedCaregiver)
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
    // Clients of those cards, and requests to be added to a patient (version 8).
    try {
      const cl = await fetchAll(() => sb.from("clients").select("*").neq("owner", me.id).order("id"));
      sharedClients = {};
      for (const r of cl) sharedClients[r.id] = clientFromRow(r);
      patientRequests = await fetchAll(() => sb.from("patient_requests").select("*").order("created_at"));
    } catch (e) { if (!missingTable(e)) throw e; }
    setLS(LS_MEMBER_CARDS, JSON.stringify(memberCards));
    setLS(LS_SHARED_CLIENTS, JSON.stringify(sharedClients));
    autoSharePayers();
  } catch (e) {
    // Offline: keep what's already loaded.
  }
}
// A caregiver added to someone else's card shares their shifts for that patient with the card's client,
// once per card (if they later remove that share under Sync & sharing, it isn't added back).
const LS_AUTO_SHARED = "care-hours-auto-shared";
async function autoSharePayers() {
  if (!sb || !me) return;
  let done = [];
  try { done = JSON.parse(getLS(LS_AUTO_SHARED) || "[]"); } catch (e) {}
  for (const c of memberCards) {
    const k = me.id + "|" + c.owner + "|" + c.id;
    if (done.includes(k)) continue;
    if (!(await sharePayerTo(c.person, clientEmailOf(c), null))) continue;   // try again next time
    done.push(k);
    setLS(LS_AUTO_SHARED, JSON.stringify(done));
  }
}
const LS_SHARED_CLIENTS = "care-hours-shared-clients";
function loadSharedClientsSaved() {
  try { const v = JSON.parse(getLS(LS_SHARED_CLIENTS) || "{}"); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; }
  catch (e) { return {}; }
}
function loadMemberCardsSaved() {
  try { const v = JSON.parse(getLS(LS_MEMBER_CARDS) || "[]"); return Array.isArray(v) ? v.filter(c => c && c.owner && c.person) : []; }
  catch (e) { return []; }
}
document.addEventListener("visibilitychange", () => {
  if (me && document.visibilityState === "visible") loadCardSharing().then(renderAll);
});
// Now and then, so a new request to approve shows on the Caregivers tab's badge while the app is open.
setInterval(() => { if (me && document.visibilityState === "visible") loadCardSharing().then(renderAll); }, 60000);

// ---------- caregivers on a card ----------
// The caregiver who set up the card, a caregiver on it, or its payer can add caregivers.
// The one who set it up, or the payer, can remove them; an added caregiver can leave.
function caregiversSection(c, ro) {
  if (!me) return isMine(c) ? `<h3>Caregivers</h3><p class="hint">Sign in under Sync &amp; sharing to add the other caregivers for ${esc(c.person)} to this card.</p>` : "";
  const members = cardMembers[memberKey(c)] || [];
  const myEmail = (me.email || "").toLowerCase();
  const mineCard = isMine(c);
  const canRemove = mineCard || ro;
  const onCard = !mineCard && !ro;
  const items = [`<li><span>${mineCard ? "You" : esc(ownerName(c.owner))}</span><span class="hint">set up this card</span></li>`]
    .concat(members.map(e => {
      const you = e === myEmail;
      const act = !canRemove || you ? "" : pcUi.confirmMember === e
        ? `<span class="inline"><button type="button" class="link danger" data-pc-unmember-yes="${esc(e)}">Remove</button><button type="button" class="link" data-pc-unmember-no="1">Cancel</button></span>`
        : `<button type="button" class="link danger" data-pc-unmember="${esc(e)}">Remove</button>`;
      return `<li><span>${you ? "You" : esc(e)}</span>${act}</li>`;
    }));
  const dup = mineCard && memberCards.find(m => samePerson(m.person) === samePerson(c.person));
  return `<h3>Caregivers</h3>
    <ul class="people" id="pcCaregivers">${items.join("")}</ul>
    ${dup ? `<p class="hint">${esc(ownerName(dup.owner))} also added you to their card for ${esc(dup.person)}. To keep just one card, remove yours; your shifts for ${esc(c.person)} stay.</p>` : ""}
    <form id="pcInvite" class="field" novalidate>
        <label class="label" for="pcInviteEmail">Add a caregiver</label>
        <div class="inline"><input id="pcInviteEmail" type="email" inputmode="email" autocomplete="off" placeholder="caregiver@example.com" value="${esc(pcUi.inviteEmail || "")}">
        <button class="ghost" type="submit"${pcUi.memberBusy ? " disabled" : ""}>Add</button></div>
        <p class="hint">They sign in to Care Hours with that email. They can see and edit this card and log shifts for ${esc(c.person)}.
          ${ro ? "" : `${esc(c.person)}'s payer and the caregivers on this card can add caregivers too.`}</p>
      </form>
    ${!onCard ? "" : pcUi.confirmLeave
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
  const owner = c.owner || me.id;
  if (!emailOk(email)) return fail("Enter the caregiver's full email address, like name@example.com.");
  if (email === (me.email || "").toLowerCase()) return fail("That's your own email.");
  if ((cardMembers[memberKey(c)] || []).includes(email)) return fail(`${email} is already on this card.`);
  pcUi.memberBusy = true; renderPatients();
  // Your own card has to be online before someone can be added to it.
  let error = null;
  if (isMine(c)) {
    await push();
    const saved = pcards.find(x => x.id === c.id);
    if (saved && saved.dirty) error = { message: "fetch" };
  }
  if (!error) ({ error } = await sb.from("patient_members").insert({ owner, id: c.id, member_email: email }));
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
  const { error } = await sb.from("patient_members").delete().eq("owner", c.owner || me.id).eq("id", c.id).eq("member_email", email);
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

// ---------- requests to be added to a patient ----------
// Yours (waiting for the client) and ones waiting for you to approve as the client.
function requestsSection() {
  if (!me || !patientRequests.length) return "";
  const k = r => r.owner + "|" + r.id + "|" + r.requester;
  const mineReq = patientRequests.filter(r => r.requester === me.id);
  const forMe = patientRequests.filter(r => r.requester !== me.id);
  const when = r => shortFmt.format(new Date(r.created_at));
  return `<div class="pcrequests" id="pcRequests">
    ${forMe.length ? `<h3>Waiting for your approval</h3><ul>${forMe.map(r => {
      const card = [...sharedCards, ...memberCards, ...liveCards()].find(c => (c.owner || me.id) === r.owner && c.id === r.id);
      const who = r.requester_name ? `${r.requester_name} (${r.requester_email})` : r.requester_email;
      return `<li><span><b>${esc(who)}</b> asked to be added as a caregiver for ${esc(card ? card.person : r.person)} · ${esc(when(r))}</span>
        <span class="inline"><button type="button" class="btn" data-req-approve="${esc(k(r))}">Approve</button>
        <button type="button" class="link danger" data-req-decline="${esc(k(r))}">Decline</button></span></li>`;
    }).join("")}</ul>` : ""}
    ${mineReq.length ? `<h3>Waiting for the client to approve</h3><ul>${mineReq.map(r =>
      `<li><span>${esc(r.person)} · asked ${esc(when(r))}</span><button type="button" class="link" data-req-cancel="${esc(k(r))}">Cancel request</button></li>`).join("")}</ul>` : ""}
  </div>`;
}
async function answerRequest(key, approve) {
  const r = patientRequests.find(x => x.owner + "|" + x.id + "|" + x.requester === key);
  if (!r || !sb) return;
  const { error } = approve
    ? await sb.rpc("approve_patient_request", { the_owner: r.owner, the_id: r.id, the_requester: r.requester })
    : await sb.from("patient_requests").delete().eq("owner", r.owner).eq("id", r.id).eq("requester", r.requester);
  pcUi.notice = error ? "That didn't go through. Check your connection and try again."
    : approve ? `${r.requester_name || r.requester_email} can now see and edit the card and log shifts.` : "";
  await loadCardSharing();
  renderAll();
}
