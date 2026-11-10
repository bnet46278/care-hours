// Care Hours: Tabs, drawing the whole page, the live timer, and starting the app. Loaded last.
// All app files share one set of names (classic scripts), and load in the order listed in index.html.

// ================= render: tabs & shared header =================
function renderTabs() {
  // Caregivers: Care Hours (| Caregivers, if someone shares hours with them) | Patients.
  // Payers: Care Hours, showing what caregivers share with them | Caregivers.
  // Care Hours holds shifts worked and the schedule together; the Shifts and Schedule boxes pick what shows.
  const payer = payerMode(), hasShared = !!me && sharedPatients.length > 0;
  $("tabs").hidden = false;
  $("tabShared").hidden = payer || !hasShared;
  $("tabMine").setAttribute("aria-selected", String(view === "mine" || view === "all"));
  $("tabShared").setAttribute("aria-selected", String(view === "shared"));
  // There's no Messages tab: conversations open from a card on the Patients tab (caregivers, by patient) or the
  // Caregivers tab (payers, by caregiver). That tab stays selected while a conversation is open, and shows the unread count.
  // Requests waiting for your approval (as a patient's client) count too.
  const msgs = view === "msgs", unread = unreadCount();
  const waiting = me ? patientRequests.filter(r => r.requester !== me.id).length : 0, peopleUnread = unread + waiting;
  document.body.classList.toggle("msgview", msgs);
  // Patients, for caregivers; Caregivers, for payers.
  const people = view === "people" || view === "ppeople", peopleSel = people || msgs;
  const label = tabPeopleLabel();
  $("tabPeople").setAttribute("aria-selected", String(peopleSel));
  $("tabPeopleLabel").textContent = label;   // Patients for caregivers, Caregivers for payers
  const said = [unread ? `${unread} unread` : "", waiting ? `${waiting} waiting for your approval` : ""].filter(Boolean).join(", ");
  $("tabPeople").setAttribute("aria-label", said ? `${label}, ${said}` : label);
  $("peopleBadge").hidden = !peopleUnread;
  $("peopleBadge").textContent = peopleUnread || "";
  document.body.classList.toggle("peopleview", people);
  const ro = readOnly(), home = view === "mine" || view === "all";
  $("sharedHead").hidden = !ro;
  $("clock").hidden = ro;
  $("addBtn").hidden = ro;
  $("plan").hidden = !(view === "mine" && showSched);
  $("planShared").hidden = !((view === "all" && showSched) || view === "shared");
  $("logSection").hidden = home && !showShifts;
  $("showShifts").checked = showShifts; $("showSched").checked = showSched;
  // Caregiver's patient picker.
  const pats = patients();
  if (myPatient !== "all" && !pats.some(p => samePerson(p) === myPatient)) myPatient = "all";
  $("myPatientWrap").hidden = ro || !pats.length;
  $("myPatient").innerHTML = `<option value="all"${myPatient === "all" ? " selected" : ""}>All patients</option>` +
    pats.map(p => `<option value="${esc(samePerson(p))}"${samePerson(p) === myPatient ? " selected" : ""}>${esc(p)}</option>`).join("");
  // Payer's caregiver picker, at the top on every payer tab.
  const cgs = sharedCaregivers();
  if (sharedCaregiver !== "all" && !cgs.includes(sharedCaregiver)) sharedCaregiver = "all";
  $("ownerPickWrap").hidden = !ro || !cgs.length;
  if (!ro) return;
  $("ownerPick").innerHTML = `<option value="all"${sharedCaregiver === "all" ? " selected" : ""}>All caregivers</option>` +
    cgs.map(id => `<option value="${esc(id)}"${id === sharedCaregiver ? " selected" : ""}>${esc(cgName(id))}</option>`).join("");
  $("sharedLabel").textContent = "Caregivers who share with you";
  const one = sharedCaregiver !== "all" ? sharedCaregiver : cgs.length === 1 ? cgs[0] : null;
  const email = id => caregiverNames[id] && caregiverNames[id].email && caregiverNames[id].email !== cgName(id) ? " · " + caregiverNames[id].email : "";
  $("sharedWho").innerHTML = one
    ? `<h2 class="${cc(one).trim()}"><span class="dot"></span>${esc(cgName(one))}</h2><p class="hint">Caring for ${esc(patientsOf(one).join(", "))}${esc(email(one))}</p>`
    : `<h2>All caregivers</h2>` + cgs.map(id => `<p class="hint${cc(id)}"><span class="dot"></span><b>${esc(cgName(id))}</b> · caring for ${esc(patientsOf(id).join(", "))}</p>`).join("");
  $("sharedUpdated").textContent = sharedErr || (sharedLoadedAt ? "Updated " + tFmt.format(new Date(sharedLoadedAt)) : "");
}
$("tabMine").addEventListener("click", () => { view = payerMode() ? "all" : "mine"; weekOffset = 0; closeForm(); closePlanForm(); renderAll(); if (view === "all") refreshShared(); });
// Shifts and Schedule boxes on the chart: what the Care Hours tab shows. At least one stays on.
function setShow(which, on) {
  if (!on && !(which === "shifts" ? showSched : showShifts)) { $(which === "shifts" ? "showShifts" : "showSched").checked = true; return; }
  if (which === "shifts") showShifts = on; else showSched = on;
  setLS(LS_SHOW, showShifts && showSched ? "both" : showShifts ? "shifts" : "sched");
  if (!showShifts) closeForm();
  if (!showSched) closePlanForm();
  // The future has only scheduled hours: come back to this week when the schedule is hidden.
  if (!showSched && weekOffset > maxWeekAhead()) weekOffset = 0;
  selDay = null; renderAll();
}
$("showShifts").addEventListener("change", e => setShow("shifts", e.target.checked));
$("showSched").addEventListener("change", e => setShow("sched", e.target.checked));
$("tabPeople").addEventListener("click", () => {
  view = payerMode() ? "ppeople" : "people"; closeForm(); closePlanForm();
  pcUi = { ...pcUi, returnTo: null };   // the last notice stays until the next action on a card
  renderAll(); loadCardSharing().then(renderAll);
  if (me) refreshMessaging();   // the cards show who you can message, and the latest messages
});
$("tabShared").addEventListener("click", () => { view = "shared"; weekOffset = 0; closeForm(); closePlanForm(); renderAll(); refreshShared(); });
$("ownerPick").addEventListener("change", e => { sharedCaregiver = e.target.value; renderAll(); });
// ---------- collapsible Shifts and Schedule lists ----------
function applyCollapsed() {
  $("list").hidden = !listOpen; $("listToggle").setAttribute("aria-expanded", String(listOpen));
  $("planList").hidden = !schedOpen; $("planToggle").setAttribute("aria-expanded", String(schedOpen));
  const ps = $("planSharedList"), pt = $("planSharedToggle");
  if (ps) { ps.hidden = !schedOpen; pt.setAttribute("aria-expanded", String(schedOpen)); }
}
function toggleList() { listOpen = !listOpen; setLS(LS_LIST_OPEN, listOpen ? "1" : "0"); applyCollapsed(); }
function toggleSched() { schedOpen = !schedOpen; setLS(LS_SCHED_OPEN, schedOpen ? "1" : "0"); applyCollapsed(); }
$("listToggle").addEventListener("click", toggleList);
$("planToggle").addEventListener("click", toggleSched);
$("myPatient").addEventListener("change", e => { myPatient = e.target.value; confirmId = null; planConfirm = null; renderAll(); });
$("sharedRefresh").addEventListener("click", refreshShared);

// ================= top-level render =================
function renderAll() {
  $("today").textContent = dayFmt.format(new Date());
  seedColors();
  ensureCards();
  refreshPatientPickers();
  renderTabs();
  if (view === "mine") {
    // Keep the clock card intact while someone is typing in it.
    const typing = document.activeElement && $("clock").contains(document.activeElement) && document.activeElement.tagName !== "BUTTON";
    if (!typing || !!active() !== $("clock").classList.contains("on")) renderClock();
  }
  renderWeek(); renderHeldNote(); renderList(); renderPlan(); renderPlanShared(); renderPatients(); renderMessages();
  const typingSync = document.activeElement && $("sync").contains(document.activeElement) && document.activeElement.tagName === "INPUT";
  if (!typingSync) renderSync(); else renderSyncState();
}

// Live timer: update text every second; refresh totals every 30 seconds.
let ticks = 0;
setInterval(() => {
  const a = active();
  if (a && view === "mine") { const t = $("timer"); if (t) t.textContent = clockText(Date.now() - a.start); }
  if (++ticks % 30 === 0 && data().some(s => !s.end)) { renderWeek(); renderList(); }
}, 1000);

// ================= start =================
shifts = loadLocal();
pcards = loadCards();
pclients = loadClients();
memberCards = loadMemberCardsSaved();
sharedClients = loadSharedClientsSaved();
patientsOpen = getLS(LS_PATIENTS_OPEN) === "1";
syncOpen = getLS(LS_SYNC_OPEN) !== "0";
rangeMode = ["week", "2weeks", "month"].includes(getLS(LS_RANGE)) ? getLS(LS_RANGE) : "week";   // open until you collapse it
showShifts = getLS(LS_SHOW) !== "sched";   // both, unless one was turned off on this device
showSched = getLS(LS_SHOW) !== "shifts";
// The Shifts and Schedule cards start collapsed; once you open one, it stays open on this device.
listOpen = getLS(LS_LIST_OPEN) === "1";
schedOpen = getLS(LS_SCHED_OPEN) === "1";
applyCollapsed();
sched = loadSched();
const standalone = window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
$("installTip").hidden = standalone;
renderAll();
initSync();
try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}
if ("serviceWorker" in navigator) {
  // When a newer version takes over in the background, offer a one-tap refresh (never reload on its own,
  // so nothing being typed is lost). The very first install isn't an update, so it's skipped.
  const hadVersion = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadVersion) $("updateBar").hidden = false; });
  navigator.serviceWorker.register("sw.js").then(reg => {
    // Check for an update whenever the app comes back to the front.
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reg.update().catch(() => {}); });
  }).catch(() => {});
}
$("updateNow").addEventListener("click", () => location.reload());
