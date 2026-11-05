// Care Hours: Tabs, drawing the whole page, the live timer, and starting the app. Loaded last.
// All app files share one set of names (classic scripts), and load in the order listed in index.html.

// ================= render: tabs & shared header =================
function renderTabs() {
  // Caregivers: Shifts | Schedule (| Shared with me). Payers: Shifts | Shared with me.
  const payer = payerMode(), hasShared = !!me && sharedPatients.length > 0;
  $("tabs").hidden = false;
  $("tabPlan").hidden = payer;
  $("tabShared").hidden = !hasShared;
  $("tabMine").setAttribute("aria-selected", String(view === "mine" || view === "all"));
  $("tabPlan").setAttribute("aria-selected", String(view === "plan"));
  $("tabShared").setAttribute("aria-selected", String(view === "shared"));
  const ro = readOnly(), plan = view === "plan";
  $("sharedHead").hidden = !ro;
  $("clock").hidden = ro || plan;
  $("addBtn").hidden = ro;
  $("plan").hidden = !plan;
  $("planShared").hidden = !ro;
  $("logSection").hidden = plan;
  if (!ro) return;
  const names = ids => ids.map(cgName).join(", ");
  if (view === "all") {
    $("sharedLabel").textContent = "Shifts shared with you";
    $("ownerPickWrap").hidden = true;
    $("sharedWho").innerHTML = `<h2>All shared shifts</h2>` + sharedPatients.map(g =>
      `<p class="hint"><b>${esc(g.person)}</b> · cared for by ${esc(names(g.caregivers))}</p>`).join("");
  } else {
    $("sharedLabel").textContent = "Patient shared with you";
    $("ownerPickWrap").hidden = sharedPatients.length < 2;
    $("ownerPick").innerHTML = sharedPatients.map(g => `<option value="${esc(g.key)}"${g.key === sharedPatient ? " selected" : ""}>${esc(g.person)}</option>`).join("");
    const g = sharedPatients.find(g => g.key === sharedPatient);
    $("sharedWho").innerHTML = g ? `<h2>${esc(g.person)}</h2><p class="hint">Cared for by ${esc(names(g.caregivers))}</p>` : "";
  }
  $("sharedUpdated").textContent = sharedErr || (sharedLoadedAt ? "Updated " + tFmt.format(new Date(sharedLoadedAt)) : "");
}
$("tabMine").addEventListener("click", () => { view = payerMode() ? "all" : "mine"; weekOffset = 0; closeForm(); closePlanForm(); renderAll(); if (view === "all") refreshShared(); });
$("tabPlan").addEventListener("click", () => { view = "plan"; weekOffset = 0; closeForm(); renderAll(); });
$("tabShared").addEventListener("click", () => { view = "shared"; weekOffset = 0; closeForm(); closePlanForm(); renderAll(); refreshShared(); });
$("ownerPick").addEventListener("change", e => { sharedPatient = e.target.value; renderAll(); });
$("sharedRefresh").addEventListener("click", refreshShared);

// ================= top-level render =================
function renderAll() {
  $("today").textContent = dayFmt.format(new Date());
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
sched = loadSched();
const standalone = window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
$("installTip").hidden = standalone;
renderAll();
initSync();
try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
