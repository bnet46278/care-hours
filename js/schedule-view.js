// Care Hours: The Schedule screen and the schedule shown to payers, plus the add/edit schedule forms.
// All app files share one set of names (classic scripts), and load in the order listed in index.html.

// ================= render: schedule =================
// One row for a scheduled shift or time off, as it falls on day d.
function occRow(o, d, ro) {
  const ds = new Date(d); ds.setHours(0, 0, 0, 0);
  const dayStart = ds.getTime(), dayEnd = addDays(ds, 1).getTime();
  const e = o.e, who = ro ? cgName(o.owner) : "";
  let range, meta, cls = "occ", acts = "";
  if (o.kind === "off") {
    const a = Math.max(o.start, dayStart), b = Math.min(o.end, dayEnd);
    range = a === dayStart && b === dayEnd ? "All day" : `${tFmt.format(new Date(a))} – ${b === dayEnd ? "midnight" : tFmt.format(new Date(b))}`;
    meta = ro ? `${colorCgs() ? caregiverTag(o.owner) : `<b>${esc(who)}</b>`} unavailable` : `<span class="pill">Time off</span>`;
    cls += " off";
    if (!ro) acts = `<button class="link" data-pact="edit" data-id="${esc(e.id)}">Edit</button>
      <button class="link danger" data-pact="del" data-id="${esc(e.id)}">Delete</button>`;
  } else {
    const en = new Date(o.end);
    range = `${tFmt.format(new Date(o.start))} – ${tFmt.format(en)}${!sameDay(new Date(o.start), en) ? " (next day)" : ""}`;
    const pname = ro ? patientName({ person: o.person }) : o.person;
    meta = [ro ? patientTag(pname) : `<span class="dot"></span><b>${esc(pname)}</b>`, ro && caregiverTag(o.owner, "by "), !ro && (e.kind === "weekly" ? `Repeats ${esc(daysLabel(e.days))}` : "One time"),
      o.cancelled && `<span class="pill">${ro ? "Caregiver unavailable" : "Time off"}</span>`, e.note && esc(e.note)].filter(Boolean).join(" · ");
    if (o.cancelled) cls += " cancel";
    if (!ro) acts = (e.kind === "weekly" && !o.cancelled ? `<button class="link" data-pact="skip" data-id="${esc(e.id)}" data-start="${o.start}" data-end="${o.end}">Skip this day</button>` : "")
      + `<button class="link" data-pact="edit" data-id="${esc(e.id)}">${e.kind === "weekly" ? "Edit series" : "Edit"}</button>
      <button class="link danger" data-pact="del" data-id="${esc(e.id)}">Delete</button>`;
  }
  const confirm = !ro && planConfirm === e.id ? `<div class="confirm"><span>${e.kind === "weekly" ? "Delete every week of this repeating shift?" : "Delete this?"}</span>
    <button class="link danger" data-pact="del-yes" data-id="${esc(e.id)}">Delete</button>
    <button class="link" data-pact="del-no">Keep it</button></div>` : "";
  // Patient color for caregivers; caregiver color for payers (or patient color, see byPatient in state.js).
  if (ro) cls += o.kind === "off" ? (byPatient() ? "" : " tinted" + cc(o.owner)) : " tinted" + tint(o);
  else if (o.kind !== "off") cls += " tinted" + pc(o.person);
  return `<div class="${cls}"><div class="range">${range}</div><div class="dur">${o.kind === "off" ? "" : dur(o.end - o.start)}</div>
    <div class="meta">${meta}</div><div class="acts">${acts}</div>${confirm}</div>`;
}
// The week's schedule, day by day.
function scheduleDays(ro) {
  const R = viewRange();
  const occ = occurrences(viewSched(), R.s, R.e);
  const out = [];
  for (const d of R.days) {
    const ds = d.getTime(), de = addDays(d, 1).getTime();
    const items = occ.filter(o => o.kind === "off" ? (o.start < de && o.end > ds) : sameDay(new Date(o.start), d));
    if (!items.length) continue;
    const h = schedHours(items.filter(o => o.kind !== "off"));
    out.push(`<div class="group"><div class="grouphead"><span class="label">${dayFmt.format(d)}</span><span>${h ? dur(h) : ""}</span></div>
      ${items.map(o => occRow(o, d, ro)).join("")}</div>`);
  }
  return out.length ? `<div class="log">${out.join("")}</div>` : "";
}
function renderPlan() {
  if (view !== "mine" || !showSched) return;
  const now = Date.now();
  const days = scheduleDays(false);
  const weekly = liveSched().filter(e => e.kind === "weekly" && forMyPatient(e)).sort((a, b) => a.person.localeCompare(b.person) || a.startTime.localeCompare(b.startTime));
  const offs = liveSched().filter(e => e.kind === "off").map(e => ({ e, o: occurrences([{ ...e, owner: "me" }], 0, 8.64e15)[0] }))
    .filter(x => x.o && x.o.end > now).sort((a, b) => a.o.start - b.o.start);
  const rangeTxt = e => `${timeLabel(e.startTime)} – ${timeLabel(e.endTime)}`;
  $("planList").innerHTML = `
    ${days || (myPatient !== "all" ? `<div class="empty">Nothing scheduled for ${esc(myPatientName())} ${periodWords()}.</div>` : "") || `<div class="empty">Nothing scheduled ${periodWords()}. Add a <b>repeating shift</b> for regular visits, a <b>one-time shift</b>, or <b>time off</b>.</div>`}
    <div class="field"><h2>Repeating shifts</h2>
      ${weekly.length ? `<ul class="rules">${weekly.map(e => `<li><span><b>${esc(e.person)}</b> · ${esc(daysLabel(e.days))}</span>
        <span class="acts"><button class="link" data-pact="edit" data-id="${esc(e.id)}">Edit</button><button class="link danger" data-pact="del" data-id="${esc(e.id)}">Delete</button></span>
        <span class="meta">${rangeTxt(e)} · from ${shortFmt.format(parseDate(e.onDate))}${e.untilDate ? " until " + shortFmt.format(parseDate(e.untilDate)) : ""}${e.note ? " · " + esc(e.note) : ""}</span>
        ${planConfirm === e.id ? `<div class="confirm" style="grid-column:1/-1"><span>Delete every week of this repeating shift?</span><button class="link danger" data-pact="del-yes" data-id="${esc(e.id)}">Delete</button><button class="link" data-pact="del-no">Keep it</button></div>` : ""}</li>`).join("")}</ul>`
        : `<p class="hint">None yet.</p>`}</div>
    <div class="field"><h2>Upcoming time off</h2>
      ${offs.length ? `<ul class="rules">${offs.map(({ e, o }) => {
        const allDay = !e.startTime && !e.endTime, multi = e.untilDate && e.untilDate !== e.onDate;
        const when = allDay ? (multi ? `${shortFmt.format(parseDate(e.onDate))} – ${shortFmt.format(parseDate(e.untilDate))}` : dayFmt.format(parseDate(e.onDate)))
          : `${dayFmt.format(new Date(o.start))} ${tFmt.format(new Date(o.start))} – ${multi ? dayFmt.format(new Date(o.end)) + " " : ""}${tFmt.format(new Date(o.end))}`;
        return `<li><span>${esc(when)}${allDay ? " · all day" : ""}</span>
          <span class="acts"><button class="link" data-pact="edit" data-id="${esc(e.id)}">Edit</button><button class="link danger" data-pact="del" data-id="${esc(e.id)}">Delete</button></span>
          ${planConfirm === e.id ? `<div class="confirm" style="grid-column:1/-1"><span>Delete this time off?</span><button class="link danger" data-pact="del-yes" data-id="${esc(e.id)}">Delete</button><button class="link" data-pact="del-no">Keep it</button></div>` : ""}</li>`;
      }).join("")}</ul>` : `<p class="hint">None coming up.</p>`}
      <p class="hint">People you share a patient with see your time off as "unavailable", without any details.</p></div>`;
}
function renderPlanShared() {
  if (!readOnly()) return;
  const days = scheduleDays(true);
  const title = `Scheduled ${periodWords()}`;
  $("planShared").innerHTML = `<button type="button" class="collapse inline" id="planSharedToggle" aria-expanded="${schedOpen}" aria-controls="planSharedList">
      <h2>${title}</h2><span class="chev" aria-hidden="true"></span></button>
    <div id="planSharedList"${schedOpen ? "" : " hidden"}>${days || `<div class="empty">Nothing scheduled.</div>`}</div>`;
  $("planSharedToggle").addEventListener("click", () => toggleSched());
}
$("planList").addEventListener("click", e => {
  const b = e.target.closest("button[data-pact]"); if (!b) return;
  const id = b.dataset.id, act = b.dataset.pact;
  if (act === "del") { planConfirm = id; renderPlan(); }
  else if (act === "del-no") { planConfirm = null; renderPlan(); }
  else if (act === "del-yes") { planConfirm = null; removeSched(id); }
  else if (act === "edit") { const en = liveSched().find(x => x.id === id); if (en) openPlanForm(en.kind, en); }
  else if (act === "skip") {
    // Skipping one day of a repeating shift is time off for exactly that shift.
    const a = new Date(Number(b.dataset.start)), z = new Date(Number(b.dataset.end));
    putSched({ id: newId(), kind: "off", person: "", days: [], onDate: dateVal(a), untilDate: dateVal(z), startTime: timeVal(a), endTime: timeVal(z), note: "" });
  }
});
document.querySelectorAll("[data-new]").forEach(b => b.addEventListener("click", () => openPlanForm(b.dataset.new, null)));

// ---------- add / edit schedule entries ----------
function openPlanForm(kind, en) {
  planForm = { kind, id: en ? en.id : null, prev: en };
  const today = dateVal(new Date());
  const v = en || { person: draftPerson || "", days: [], onDate: today, untilDate: null, startTime: kind === "off" ? null : "09:00", endTime: kind === "off" ? null : "13:00", note: "" };
  const title = { weekly: "Repeating shift", once: "One-time shift", off: "Time off" }[kind];
  const allDay = kind === "off" && !v.startTime && !v.endTime;
  const patient = `<div class="field"><label class="label" for="pPerson">Patient</label>${patientSelect("pPerson", v.person)}</div>`;
  const times = `<div class="row2"><div class="field"><label class="label" for="pStart">Start</label><input type="time" id="pStart" value="${esc(v.startTime || "")}"></div>
    <div class="field"><label class="label" for="pEnd">End</label><input type="time" id="pEnd" value="${esc(v.endTime || "")}"></div></div>`;
  const note = `<div class="field"><label class="label" for="pNote">Notes</label><textarea id="pNote" placeholder="Anything to remember for these visits">${esc(v.note)}</textarea></div>`;
  let body = "";
  if (kind === "weekly") body = patient + `<div class="field"><span class="label">Repeats on</span><div class="daypick">${WEEK_ORDER.map(n =>
      `<label><input type="checkbox" id="pDay${n}" value="${n}"${v.days.includes(n) ? " checked" : ""}>${esc(dayShort(n))}</label>`).join("")}</div></div>`
    + times + `<div class="row2"><div class="field"><label class="label" for="pFrom">Starting</label><input type="date" id="pFrom" value="${esc(v.onDate)}"></div>
      <div class="field"><label class="label" for="pUntil">Ending (optional)</label><input type="date" id="pUntil" value="${esc(v.untilDate || "")}"></div></div>` + note;
  else if (kind === "once") body = patient + `<div class="field"><label class="label" for="pFrom">Date</label><input type="date" id="pFrom" value="${esc(v.onDate)}"></div>` + times + note;
  else body = `<div class="row2"><div class="field"><label class="label" for="pFrom">From</label><input type="date" id="pFrom" value="${esc(v.onDate)}"></div>
      <div class="field"><label class="label" for="pUntil">To</label><input type="date" id="pUntil" value="${esc(v.untilDate || v.onDate)}"></div></div>
    <label class="checkline"><input type="checkbox" id="pAllDay"${allDay ? " checked" : ""}> All day</label>
    <div id="pTimes"${allDay ? " hidden" : ""}><div class="row2"><div class="field"><label class="label" for="pStart">Starting at (first day)</label><input type="time" id="pStart" value="${esc(v.startTime || "")}"></div>
      <div class="field"><label class="label" for="pEnd">Back at (last day)</label><input type="time" id="pEnd" value="${esc(v.endTime || "")}"></div></div></div>
    <p class="hint">Scheduled shifts during time off are skipped. People you share with see only that you're unavailable.</p>`;
  $("planForm").innerHTML = `<form class="form" id="planFormEl" novalidate><h2>${en ? "Edit " + title.toLowerCase() : "Add " + title.toLowerCase()}</h2>${body}
    <div class="err" id="pErr" role="alert"></div>
    <div class="formacts"><button class="btn" type="submit">${en ? "Save changes" : "Add to schedule"}</button><button class="ghost" type="button" id="pCancel">Cancel</button></div></form>`;
  if ($("pAllDay")) $("pAllDay").addEventListener("change", e => { $("pTimes").hidden = e.target.checked; });
  $("pCancel").addEventListener("click", closePlanForm);
  $("planFormEl").addEventListener("submit", savePlanForm);
  ($("pPerson") || $("pFrom")).focus();
}
function closePlanForm() { planForm = null; $("planForm").innerHTML = ""; }
function savePlanForm(ev) {
  ev.preventDefault();
  const f = planForm, err = m => { $("pErr").textContent = m; };
  const val = id => ($(id) ? $(id).value.trim() : "");
  const en = { id: f.id || newId(), kind: f.kind, person: "", days: [], onDate: val("pFrom"), untilDate: null, startTime: null, endTime: null, note: "", updatedAt: f.prev ? f.prev.updatedAt : 0 };
  if (!/^\d{4}-\d\d-\d\d$/.test(en.onDate)) return err(f.kind === "off" ? "Enter the first day of your time off." : "Enter a date.");
  if (f.kind !== "off") {
    en.person = matchPatient(val("pPerson").replace(/\s+/g, " "));
    if (!en.person) return err("Choose a patient.");
    en.startTime = val("pStart"); en.endTime = val("pEnd");
    if (!en.startTime || !en.endTime) return err("Enter a start time and an end time.");
    if (en.startTime === en.endTime) return err("The end time must be different from the start time.");
    en.note = val("pNote");
    if (f.kind === "weekly") {
      en.days = WEEK_ORDER.filter(n => $("pDay" + n).checked);
      if (!en.days.length) return err("Pick at least one day of the week.");
      en.untilDate = val("pUntil") || null;
      if (en.untilDate && en.untilDate < en.onDate) return err("The ending date must be on or after the starting date.");
    }
  } else {
    en.untilDate = val("pUntil") || en.onDate;
    if (en.untilDate < en.onDate) return err("The last day must be on or after the first day.");
    if (!$("pAllDay").checked) {
      en.startTime = val("pStart") || null; en.endTime = val("pEnd") || null;
      if (!en.startTime || !en.endTime) return err("Enter both times, or choose All day.");
      if (en.untilDate === en.onDate && en.endTime <= en.startTime) return err("On a single day, the time you're back must be after the time you start.");
    }
  }
  putSched(en);
  // Jump to the week the entry starts in, so it's visible right away.
  weekOffset = Math.max(-52, Math.min(maxWeekAhead(), offsetFor(parseDate(en.onDate))));
  if (en.kind === "weekly" && parseDate(en.onDate) < new Date()) weekOffset = 0;
  closePlanForm(); renderAll();
}
