// Care Hours: The Shifts screen: time clock, week summary, shift list, add/edit shift form, CSV download.
// All app files share one set of names (classic scripts), and load in the order listed in index.html.

// ================= render: clock =================
function renderClock() {
  const a = active();
  const el = $("clock");
  el.classList.toggle("on", !!a);
  if (a) {
    if (noteForId !== a.id) { noteForId = a.id; draftNote = a.note || ""; }
    el.innerHTML = `
      <div class="status"><span class="dot"></span>On the clock${a.person ? ` · ${esc(a.person)}` : ""}</div>
      <div><div class="timer" id="timer">${clockText(Date.now() - a.start)}</div>
      <div class="since">Started at ${tFmt.format(new Date(a.start))}${sameDay(new Date(a.start), new Date()) ? "" : ", " + shortFmt.format(new Date(a.start))}</div></div>
      <div class="field"><label class="label" for="noteIn">Notes for this shift</label>
        <textarea id="noteIn" placeholder="Meals, medications given, errands, anything to remember">${esc(draftNote)}</textarea></div>
      <button class="big out" id="clockBtn">Clock out</button>`;
    $("noteIn").addEventListener("input", e => { draftNote = e.target.value; });
    // Save the note without redrawing the card, so a tap on Clock out isn't swallowed.
    $("noteIn").addEventListener("blur", () => {
      const cur = active();
      if (!cur || draftNote === (cur.note || "")) return;
      cur.note = draftNote; cur.updatedAt = Date.now(); cur.dirty = true; cur.failed = false;
      saveLocal(); renderList();
      setTimeout(push, 800);
    });
  } else {
    noteForId = null;
    const t0 = new Date(); t0.setHours(0, 0, 0, 0);
    const todays = occurrences(liveSched().map(e => ({ ...e, owner: "me" })), t0.getTime(), addDays(t0, 1).getTime())
      .filter(o => o.kind !== "off" && !o.cancelled && sameDay(new Date(o.start), t0) && o.end > Date.now());
    el.innerHTML = `
      <div class="status"><span class="dot"></span>Off the clock</div>
      ${todays.length ? `<div class="todayplan"><span class="label">Scheduled today</span>${todays.map(o =>
        `<button class="ghost" data-clockfor="${esc(o.person)}">Clock in for <b>${esc(o.person)}</b> · ${tFmt.format(new Date(o.start))} – ${tFmt.format(new Date(o.end))}</button>`).join("")}</div>` : ""}
      <div class="field"><label class="label" for="personIn">Patient</label>
        <input id="personIn" list="people" autocomplete="off" placeholder="Patient's name" value="${esc(draftPerson)}">
        <div class="err" id="clockErr" role="alert"></div></div>
      <button class="big" id="clockBtn">Clock in</button>`;
    $("personIn").addEventListener("input", e => { draftPerson = e.target.value; $("clockErr").textContent = ""; });
    el.querySelectorAll("[data-clockfor]").forEach(b => b.addEventListener("click", () => { draftPerson = b.dataset.clockfor; onClock(); }));
  }
  $("clockBtn").addEventListener("click", onClock);
}
function onClock() {
  const a = active();
  if (a) {
    draftPerson = a.person || "";
    put({ ...a, end: Math.max(Date.now(), a.start), note: draftNote });
  } else {
    const person = draftPerson.replace(/\s+/g, " ").trim();
    if (!person) { $("clockErr").textContent = "Enter the patient's name to clock in."; $("personIn").focus(); return; }
    weekOffset = 0;
    put({ id: newId(), start: Date.now(), end: null, person: matchPatient(person), note: "" });
  }
}

// ================= render: week =================
function viewWeek() { return addDays(weekStart(new Date()), weekOffset * 7); }
function msInDay(dayStart) {
  const dayEnd = addDays(dayStart, 1).getTime(), ds = dayStart.getTime();
  // Each shift counts on the day it started.
  return data().filter(s => s.start >= ds && s.start < dayEnd).reduce((t, s) => t + (endOf(s) - s.start), 0);
}
// You can look ahead on the schedule and on payer screens; the log stops at this week.
const maxWeekAhead = () => view === "mine" ? 0 : 12;
function renderWeek() {
  const ws = viewWeek(), today = new Date();
  const days = [...Array(7)].map((_, i) => addDays(ws, i));
  const wsMs = ws.getTime(), weMs = addDays(ws, 7).getTime();
  const occ = occurrences(viewSched(), wsMs, weMs);
  const plan = view === "plan";
  // The Schedule tab charts scheduled hours; the other tabs chart hours worked.
  const schedByDay = days.map(d => schedHours(occ.filter(o => sameDay(new Date(o.start), d))));
  const totals = plan ? schedByDay : days.map(msInDay);
  const total = totals.reduce((a, b) => a + b, 0);
  const worked = days.map(msInDay).reduce((a, b) => a + b, 0);
  const scheduled = schedHours(occ);
  $("weekTitle").textContent = weekOffset === 0 ? "This week" : weekOffset === -1 ? "Last week" : weekOffset === 1 ? "Next week" : `Week of ${shortFmt.format(ws)}`;
  $("thisWeek").hidden = weekOffset === 0;
  const atMax = weekOffset >= maxWeekAhead();
  $("nextWeek").disabled = atMax;
  $("nextWeek").style.visibility = atMax ? "hidden" : "visible";
  $("weekTotal").textContent = total ? dur(total) : "0h";
  $("weekDecimal").textContent = `${(total / HOUR).toFixed(2)} hours ${plan ? "scheduled" : "worked"} · ${shortFmt.format(ws)}–${shortFmt.format(days[6])}`;
  // Scheduled vs worked, whenever there's a schedule to compare with.
  const vs = $("weekVs");
  vs.hidden = !(scheduled || (plan && worked));
  vs.innerHTML = plan ? `Worked: <b>${hrs(worked)}</b>` : `Scheduled: <b>${hrs(scheduled)}</b>`;
  const max = Math.max(8 * HOUR, ...totals);
  $("bars").innerHTML = days.map((d, i) => {
    const pct = totals[i] ? Math.max(4, (totals[i] / max) * 100) : 0;
    return `<div class="day${sameDay(d, today) ? " is-today" : ""}">
      <div class="track" title="${dur(totals[i])}"><div class="fill" style="height:${pct}%"></div></div>
      <div class="dname">${wdFmt.format(d)}</div>
      <div class="dhrs">${totals[i] ? (totals[i] / HOUR).toFixed(1) : "–"}</div></div>`;
  }).join("");
  // Payers pay each caregiver, so show each caregiver's hours for the week, next to what was scheduled.
  const bc = $("byCaregiver");
  bc.hidden = !readOnly();
  if (readOnly()) {
    const per = new Map(), sch = new Map();
    for (const s of data()) if (s.start >= wsMs && s.start < weMs) per.set(s.owner, (per.get(s.owner) || 0) + (endOf(s) - s.start));
    for (const o of occ) if (o.kind !== "off" && !o.cancelled) sch.set(o.owner, (sch.get(o.owner) || 0) + (o.end - o.start));
    const ids = [...new Set([...per.keys(), ...sch.keys()])].sort((a, b) => cgName(a).localeCompare(cgName(b)));
    bc.innerHTML = `<span class="label">Hours by caregiver</span>` + (ids.length
      ? ids.map(id => `<div class="bycg-row"><span>${esc(cgName(id))}</span><span class="num">${hrs(per.get(id) || 0)}${sch.get(id) ? ` <span class="hint">of ${hrs(sch.get(id))} scheduled</span>` : ""}</span></div>`).join("")
      : `<p class="hint">No hours this week.</p>`);
  }
}

// ================= render: list =================
function renderList() {
  const ws = viewWeek().getTime(), we = addDays(viewWeek(), 7).getTime();
  const inWeek = data().filter(s => s.start >= ws && s.start < we).sort((a, b) => b.start - a.start);
  const list = $("list");
  if (!inWeek.length) {
    list.innerHTML = `<div class="empty">${readOnly()
      ? (sharedErr ? esc(sharedErr) : "No shifts recorded this week.")
      : myPatient !== "all" ? `No shifts for ${esc(myPatientName())} this week.`
      : weekOffset === 0
        ? "No shifts yet this week. Tap <b>Clock in</b> when you start, or add a shift you forgot to record."
        : "No shifts recorded this week."}</div>`;
    return;
  }
  const groups = new Map();
  for (const s of inWeek) {
    const k = dateVal(new Date(s.start));
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  list.innerHTML = `<div class="log">${[...groups.values()].map(g => {
    const d = new Date(g[0].start);
    const t = g.reduce((a, s) => a + (endOf(s) - s.start), 0);
    return `<div class="group">
      <div class="grouphead"><span class="label">${dayFmt.format(d)}</span><span>${dur(t)}</span></div>
      ${g.map(shiftRow).join("")}</div>`;
  }).join("")}</div>`;
}
function shiftRow(s) {
  const st = new Date(s.start), live = !s.end;
  const en = live ? null : new Date(s.end);
  const range = `${tFmt.format(st)} – ${live ? "now" : tFmt.format(en)}${en && !sameDay(st, en) ? " (next day)" : ""}`;
  const meta = [s.person ? `<b>${esc(patientName(s))}</b>` : "No patient", readOnly() && `by ${esc(cgName(s.owner))}`, s.note && esc(s.note), s.failed && "Not saved online"].filter(Boolean).join(" · ");
  const confirm = confirmId === s.id ? `<div class="confirm"><span>Delete this shift?</span>
    <button class="link danger" data-act="del-yes" data-id="${esc(s.id)}">Delete</button>
    <button class="link" data-act="del-no">Keep it</button></div>` : "";
  const acts = live || readOnly() ? "" : `<button class="link" data-act="edit" data-id="${esc(s.id)}">Edit</button>
      <button class="link danger" data-act="del" data-id="${esc(s.id)}">Delete</button>`;
  return `<div class="shift${live ? " live" : ""}">
    <div class="range">${range}</div><div class="dur" ${live ? 'data-live="1"' : ""}>${dur(endOf(s) - s.start)}</div>
    <div class="meta">${meta}</div>
    <div class="acts">${acts}</div>
    ${confirm}</div>`;
}
$("list").addEventListener("click", e => {
  const b = e.target.closest("button[data-act]"); if (!b || readOnly()) return;
  const id = b.dataset.id;
  if (b.dataset.act === "del") { confirmId = id; renderList(); }
  else if (b.dataset.act === "del-no") { confirmId = null; renderList(); }
  else if (b.dataset.act === "del-yes") { confirmId = null; remove(id); }
  else if (b.dataset.act === "edit") openForm(mine().find(s => s.id === id));
});

// ================= add / edit form =================
function openForm(s) {
  const now = new Date();
  const st = s ? new Date(s.start) : new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0);
  const en = s ? new Date(s.end) : new Date(now.getFullYear(), now.getMonth(), now.getDate(), 13, 0);
  formOpen = { id: s ? s.id : null, prev: s || null };
  $("formSlot").innerHTML = `
    <form class="form" id="shiftForm" novalidate>
      <h2>${s ? "Edit shift" : "Add a missed shift"}</h2>
      <div class="row3">
        <div class="field"><label class="label" for="fDate">Date</label><input type="date" id="fDate" value="${dateVal(st)}" required></div>
        <div class="field"><label class="label" for="fStart">Start</label><input type="time" id="fStart" value="${timeVal(st)}" required></div>
        <div class="field"><label class="label" for="fEnd">End</label><input type="time" id="fEnd" value="${timeVal(en)}" required></div>
      </div>
      <div class="hint" id="fHint"></div>
      <div class="field"><label class="label" for="fPerson">Patient</label><input id="fPerson" list="people" autocomplete="off" value="${esc(s ? s.person : draftPerson)}" placeholder="Patient's name"></div>
      <div class="field"><label class="label" for="fNote">Notes</label><textarea id="fNote">${esc(s ? s.note : "")}</textarea></div>
      <div class="err" id="fErr" role="alert"></div>
      <div class="formacts"><button class="btn" type="submit">${s ? "Save changes" : "Add shift"}</button>
        <button class="ghost" type="button" id="fCancel">Cancel</button></div>
    </form>`;
  const f = $("shiftForm");
  const update = () => {
    const r = readTimes();
    $("fHint").textContent = r && r.overnight ? `Ends the next day · ${dur(r.end - r.start)}` : r ? dur(r.end - r.start) : "";
  };
  ["fDate", "fStart", "fEnd"].forEach(id => $(id).addEventListener("input", update));
  update();
  $("fCancel").addEventListener("click", closeForm);
  f.addEventListener("submit", ev => {
    ev.preventDefault();
    const r = readTimes();
    if (!r) { $("fErr").textContent = "Enter a date, a start time and an end time."; return; }
    if (r.end - r.start > 24 * HOUR) { $("fErr").textContent = "A shift can't be longer than 24 hours."; return; }
    if (r.end > Date.now() + 60000) { $("fErr").textContent = "That shift ends in the future. Use Clock in for a shift that's happening now."; return; }
    const person = $("fPerson").value.replace(/\s+/g, " ").trim();
    if (!person) { $("fErr").textContent = "Enter the patient's name."; $("fPerson").focus(); return; }
    const prev = formOpen.prev;
    put({ id: formOpen.id || newId(), start: r.start, end: r.end, person: matchPatient(person), note: $("fNote").value.trim(), updatedAt: prev ? prev.updatedAt : 0 });
    weekOffset = Math.round((weekStart(new Date(r.start)) - weekStart(new Date())) / (7 * 24 * HOUR));
    closeForm(); renderAll();
  });
  $("fDate").focus();
}
function readTimes() {
  const d = $("fDate").value, a = $("fStart").value, b = $("fEnd").value;
  if (!d || !a || !b) return null;
  const start = new Date(`${d}T${a}`).getTime();
  let end = new Date(`${d}T${b}`).getTime();
  if (isNaN(start) || isNaN(end)) return null;
  let overnight = false;
  if (end <= start) { end = addDays(new Date(end), 1).getTime(); overnight = true; }
  return { start, end, overnight };
}
function closeForm() { formOpen = null; $("formSlot").innerHTML = ""; }
$("addBtn").addEventListener("click", () => openForm(null));

// ================= week navigation =================
$("prevWeek").addEventListener("click", () => { weekOffset--; confirmId = null; renderAll(); });
$("nextWeek").addEventListener("click", () => { if (weekOffset < maxWeekAhead()) { weekOffset++; confirmId = null; renderAll(); } });
$("thisWeek").addEventListener("click", () => { weekOffset = 0; renderAll(); });

// ================= CSV export of the week on screen =================
function csvCell(v) { const s = String(v ?? ""); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
$("csvBtn").addEventListener("click", () => {
  const ws = viewWeek(), we = addDays(ws, 7).getTime();
  const rows = data().filter(s => s.end && s.start >= ws.getTime() && s.start < we).sort((a, b) => a.start - b.start);
  const ro = readOnly();
  const lines = [ro ? ["Date", "Start", "End", "Hours", "Patient", "Caregiver", "Notes"] : ["Date", "Start", "End", "Hours", "Patient", "Notes"]];
  let total = 0; const per = new Map();
  for (const s of rows) {
    const h = (s.end - s.start) / HOUR; total += h;
    const base = [dateVal(new Date(s.start)), tFmt.format(new Date(s.start)), tFmt.format(new Date(s.end)), h.toFixed(2), patientName(s)];
    if (ro) { per.set(s.owner, (per.get(s.owner) || 0) + h); lines.push([...base, cgName(s.owner), s.note]); }
    else lines.push([...base, s.note]);
  }
  if (ro) for (const [id, h] of [...per.entries()].sort((a, b) => cgName(a[0]).localeCompare(cgName(b[0]))))
    lines.push([`Total for ${cgName(id)}`, "", "", h.toFixed(2), "", cgName(id), ""]);
  lines.push(ro ? ["Total", "", "", total.toFixed(2), "", "", ""] : ["Total", "", "", total.toFixed(2), "", ""]);
  const csv = lines.map(r => r.map(csvCell).join(",")).join("\r\n");
  const who = view === "all" ? "shared" : view === "shared" ? (sharedCaregiver === "all" ? "all-caregivers" : cgName(sharedCaregiver)) : myPatient !== "all" ? myPatientName() : "";
  const slug = who ? who.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" : "";
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `care-hours-${slug}week-of-${dateVal(ws)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
});
