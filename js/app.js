// Care Hours: Tabs, drawing the whole page, the live timer, and starting the app. Loaded last.
// All app files share one set of names (classic scripts), and load in the order listed in index.html.

// ================= render: tabs & shared header =================
function renderTabs() {
  // Caregivers: Shifts | Schedule (| Caregivers, if someone shares with them). Payers: Shifts | Caregivers.
  const payer = payerMode(), hasShared = !!me && sharedPatients.length > 0;
  $("tabs").hidden = false;
  $("tabPlan").hidden = payer;
  $("tabShared").hidden = !hasShared;
  $("tabMine").setAttribute("aria-selected", String(view === "mine" || view === "all"));
  $("tabPlan").setAttribute("aria-selected", String(view === "plan"));
  $("tabShared").setAttribute("aria-selected", String(view === "shared"));
  const ro = readOnly(), plan = view === "plan";
  $("sharedHead").hidden = !ro;
  $("ownerPickWrap").hidden = true;   // shown below on the Caregivers tab
  $("clock").hidden = ro || plan;
  $("addBtn").hidden = ro;
  $("plan").hidden = !plan;
  $("planShared").hidden = !ro;
  $("logSection").hidden = plan;
  // Payer's Shifts tab: the shifts list comes first, then the schedule. Elsewhere the schedule comes first.
  const log = $("logSection"), ps = $("planShared");
  if (view === "all") { if (log.nextElementSibling !== ps) log.after(ps); }
  else if (ps.nextElementSibling !== log) log.before(ps);
  // Caregiver's patient picker on Shifts and Schedule.
  const pats = patients();
  if (myPatient !== "all" && !pats.some(p => samePerson(p) === myPatient)) myPatient = "all";
  $("myPatientWrap").hidden = ro || !pats.length;
  $("myPatient").innerHTML = `<option value="all"${myPatient === "all" ? " selected" : ""}>All patients</option>` +
    pats.map(p => `<option value="${esc(samePerson(p))}"${samePerson(p) === myPatient ? " selected" : ""}>${esc(p)}</option>`).join("");
  if (!ro) return;
  const names = ids => ids.map(cgName).join(", ");
  if (view === "all") {
    $("sharedLabel").textContent = "Shifts shared with you";
    $("ownerPickWrap").hidden = true;
    $("sharedWho").innerHTML = `<h2>All shared shifts</h2>` + sharedPatients.map(g =>
      `<p class="hint"><b>${esc(g.person)}</b> · cared for by ${esc(names(g.caregivers))}</p>`).join("");
  } else {
    // Pick one caregiver, or all of them.
    const cgs = sharedCaregivers();
    $("sharedLabel").textContent = "Caregivers who share with you";
    $("ownerPickWrap").hidden = cgs.length === 0;
    $("ownerPick").innerHTML = `<option value="all"${sharedCaregiver === "all" ? " selected" : ""}>All caregivers</option>` +
      cgs.map(id => `<option value="${esc(id)}"${id === sharedCaregiver ? " selected" : ""}>${esc(cgName(id))}</option>`).join("");
    const one = sharedCaregiver !== "all" ? sharedCaregiver : cgs.length === 1 ? cgs[0] : null;
    const email = id => caregiverNames[id] && caregiverNames[id].email && caregiverNames[id].email !== cgName(id) ? " · " + caregiverNames[id].email : "";
    $("sharedWho").innerHTML = one
      ? `<h2>${esc(cgName(one))}</h2><p class="hint">Caring for ${esc(patientsOf(one).join(", "))}${esc(email(one))}</p>`
      : `<h2>All caregivers</h2>` + cgs.map(id => `<p class="hint${cc(id)}"><span class="dot"></span><b>${esc(cgName(id))}</b> · caring for ${esc(patientsOf(id).join(", "))}</p>`).join("");
  }
  $("sharedUpdated").textContent = sharedErr || (sharedLoadedAt ? "Updated " + tFmt.format(new Date(sharedLoadedAt)) : "");
}
$("tabMine").addEventListener("click", () => { view = payerMode() ? "all" : "mine"; weekOffset = 0; closeForm(); closePlanForm(); renderAll(); if (view === "all") refreshShared(); });
$("tabPlan").addEventListener("click", () => { view = "plan"; weekOffset = 0; closeForm(); renderAll(); });
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
listOpen = getLS(LS_LIST_OPEN) !== "0";
schedOpen = getLS(LS_SCHED_OPEN) !== "0";
applyCollapsed();
sched = loadSched();
const standalone = window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
$("installTip").hidden = standalone;
renderAll();
initSync();
try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
