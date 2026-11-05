// Care Hours: Tabs, drawing the whole page, the live timer, and starting the app. Loaded last.
// All app files share one set of names (classic scripts), and load in the order listed in index.html.

// ================= render: tabs & shared header =================
function renderTabs() {
  // Caregivers: Shifts | Schedule (| Caregivers, if someone shares hours with them).
  // Payers: Shifts | Schedule, both showing what caregivers share with them.
  const payer = payerMode(), hasShared = !!me && sharedPatients.length > 0;
  $("tabs").hidden = false;
  $("tabShared").hidden = payer || !hasShared;
  $("tabMine").setAttribute("aria-selected", String(view === "mine" || view === "all"));
  $("tabPlan").setAttribute("aria-selected", String(view === "plan" || view === "pplan"));
  $("tabShared").setAttribute("aria-selected", String(view === "shared"));
  const ro = readOnly(), plan = view === "plan", schedTab = plan || view === "pplan";
  $("sharedHead").hidden = !ro;
  $("clock").hidden = ro || plan;
  $("addBtn").hidden = ro;
  $("plan").hidden = !plan;
  $("planShared").hidden = !(view === "pplan" || view === "shared");
  $("logSection").hidden = schedTab;
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
$("tabPlan").addEventListener("click", () => { view = payerMode() ? "pplan" : "plan"; weekOffset = 0; closeForm(); renderAll(); if (view === "pplan") refreshShared(); });
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
  $("people").innerHTML = patients().map(p => `<option value="${esc(p)}"></option>`).join("");
  renderTabs();
  if (view === "mine") {
    // Keep the clock card intact while someone is typing in it.
    const typing = document.activeElement && $("clock").contains(document.activeElement) && document.activeElement.tagName !== "BUTTON";
    if (!typing || !!active() !== $("clock").classList.contains("on")) renderClock();
  }
  renderWeek(); renderList(); renderPlan(); renderPlanShared();
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
syncOpen = getLS(LS_SYNC_OPEN) !== "0";   // open until you collapse it
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
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
