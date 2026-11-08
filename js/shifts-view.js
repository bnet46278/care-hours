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
        ${patientSelect("personIn", draftPerson)}
        <div class="err" id="clockErr" role="alert"></div></div>
      <button class="big" id="clockBtn">Clock in</button>`;
    $("personIn").addEventListener("change", e => { draftPerson = e.target.value; $("clockErr").textContent = ""; });
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
    if (!person) { $("clockErr").textContent = "Choose a patient to clock in."; $("personIn").focus(); return; }
    weekOffset = 0;
    put({ id: newId(), start: Date.now(), end: null, person: matchPatient(person), note: "" });
  }
}

// ================= render: week =================
// ---------- the period on screen: one week, two weeks (this one and the next), or a calendar month ----------
// weekOffset counts steps from the current period: weeks (also for 2 weeks, which slides a week at a time) or months.
function viewRange() {
  const now = new Date();
  let start, end;
  if (rangeMode === "month") {
    start = new Date(now.getFullYear(), now.getMonth() + weekOffset, 1);
    end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  } else {
    // 2 weeks starts on this week and next; each arrow press slides it one week (‹ = last week and this week).
    start = addDays(weekStart(now), weekOffset * 7);
    end = addDays(start, rangeMode === "2weeks" ? 14 : 7);
  }
  const days = [];
  for (let d = new Date(start); d < end; d = addDays(d, 1)) days.push(new Date(d));
  return { start, end, days, s: start.getTime(), e: end.getTime() };
}
function viewWeek() { return viewRange().start; }
// Words for the period: "this week", "these 2 weeks", "this month" (or "that ...").
function periodWords() {
  const now = weekOffset === 0;
  return rangeMode === "month" ? (now ? "this month" : "that month")
    : rangeMode === "2weeks" ? (now ? "these 2 weeks" : "those 2 weeks")
    : now ? "this week" : weekOffset === 1 ? "next week" : weekOffset === -1 ? "last week" : "that week";
}
function periodTitle(r) {
  if (rangeMode === "month") return monthFmt.format(r.start);
  if (rangeMode === "2weeks") return weekOffset === 0 ? "This week and next" : weekOffset === -1 ? "Last week and this week"
    : `${shortFmt.format(r.start)} – ${shortFmt.format(addDays(r.end, -1))}`;
  return weekOffset === 0 ? "This week" : weekOffset === -1 ? "Last week" : weekOffset === 1 ? "Next week" : `Week of ${shortFmt.format(r.start)}`;
}
// Which period a date falls in, counted from the current one.
function offsetFor(date) {
  const now = new Date();
  if (rangeMode === "month") return (date.getFullYear() - now.getFullYear()) * 12 + date.getMonth() - now.getMonth();
  const weeks = Math.round((weekStart(date) - weekStart(now)) / (7 * DAY));
  return weeks;
}
function msInDay(dayStart) {
  const dayEnd = addDays(dayStart, 1).getTime(), ds = dayStart.getTime();
  // Each shift counts on the day it started.
  return data().filter(s => s.start >= ds && s.start < dayEnd).reduce((t, s) => t + (endOf(s) - s.start), 0);
}
// You can look ahead on the schedule and on payer screens; the log stops at this week.
const maxWeekAhead = () => view === "mine" ? 0 : rangeMode === "month" ? 3 : 12;
function renderWeek() {
  const R = viewRange(), today = new Date();
  const ws = R.start, days = R.days;
  const wsMs = R.s, weMs = R.e;
  const occ = occurrences(viewSched(), wsMs, weMs);
  const plan = view === "plan" || view === "pplan";   // Schedule tabs chart scheduled hours
  // The Schedule tab charts scheduled hours; the other tabs chart hours worked.
  const schedByDay = days.map(d => schedHours(occ.filter(o => sameDay(new Date(o.start), d))));
  const totals = plan ? schedByDay : days.map(msInDay);
  const total = totals.reduce((a, b) => a + b, 0);
  const worked = days.map(msInDay).reduce((a, b) => a + b, 0);
  const scheduled = schedHours(occ);
  $("weekTitle").textContent = periodTitle(R);
  document.querySelectorAll("#rangePick [data-range]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.range === rangeMode)));
  $("thisWeek").hidden = weekOffset === 0;
  const atMax = weekOffset >= maxWeekAhead();
  $("nextWeek").disabled = atMax;
  $("nextWeek").style.visibility = atMax ? "hidden" : "visible";
  $("weekTotal").textContent = total ? dur(total) : "0h";
  $("weekDecimal").textContent = `${(total / HOUR).toFixed(2)} hours ${plan ? "scheduled" : "worked"} · ${shortFmt.format(ws)}–${shortFmt.format(days[days.length - 1])}`;
  // Scheduled vs worked, whenever there's a schedule to compare with.
  const vs = $("weekVs");
  vs.hidden = !(scheduled || (plan && worked));
  vs.innerHTML = plan ? `Worked: <b>${hrs(worked)}</b>` : `Scheduled: <b>${hrs(scheduled)}</b>`;
  const max = Math.max(8 * HOUR, ...totals);
  const colored = true;   // patients for caregivers, caregivers for payers
  const ro = readOnly();
  // Hours per patient on day d: worked on Shifts, scheduled on Schedule.
  const parts = d => {
    const m = new Map();
    // Group by patient on caregiver screens, by caregiver on payer screens.
    const add = (x, ms) => {
      const k = ro ? x.owner : samePerson(x.person), name = ro ? cgName(x.owner) : x.person;
      if (!m.has(k)) m.set(k, { key: k, name, cls: tint(x), ms: 0 });
      m.get(k).ms += ms;
    };
    if (plan) occ.forEach(o => { if (o.kind !== "off" && !o.cancelled && sameDay(new Date(o.start), d)) add(o, o.end - o.start); });
    else data().forEach(s => { if (sameDay(new Date(s.start), d)) add(s, endOf(s) - s.start); });
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  };
  const seen = new Map();
  // Week: one row with weekday names. 2 weeks and Month: a calendar with weekday headings and date numbers.
  const cal = rangeMode !== "week";
  $("bars").className = "bars r-" + rangeMode;
  const heads = cal ? WEEK_ORDER.map(n => `<div class="dow">${esc(dayShort(n))}</div>`).join("") : "";
  const lead = cal ? (days[0].getDay() + 6) % 7 : 0;   // blank cells before the 1st of the month
  const blanks = n => '<div class="day blank" aria-hidden="true"></div>'.repeat(n);
  $("bars").innerHTML = heads + blanks(lead) + days.map((d, i) => {
    const pct = totals[i] ? Math.max(4, (totals[i] / max) * 100) : 0;
    const key = dateVal(d), label = `${dayFmt.format(d)}, ${totals[i] ? dur(totals[i]) : "nothing"} ${plan ? "scheduled" : "worked"}`;
    const fill = colored && totals[i]
      ? `<div class="fill stack" style="height:${pct}%">${parts(d).map(p => { seen.set(p.key, p); return `<div class="seg${p.cls}" style="flex:${p.ms}"></div>`; }).join("")}</div>`
      : `<div class="fill" style="height:${pct}%"></div>`;
    const inner = `<div class="track" title="${dur(totals[i])}">${fill}</div>
      <div class="dname">${cal ? d.getDate() : wdFmt.format(d)}</div>
      <div class="dhrs">${totals[i] ? (totals[i] / HOUR).toFixed(1) : "–"}</div>`;
    // Tap a day to open its details.
    return `<button type="button" class="day${sameDay(d, today) ? " is-today" : ""}" data-day="${key}" aria-pressed="${selDay === key}" aria-label="${esc(label)}. Show details">${inner}</button>`;
  }).join("") + (cal ? blanks((7 - (lead + days.length) % 7) % 7) : "");
  renderDayDetail();
  // Hours box under the chart: per caregiver for payers, per patient for caregivers.
  // Each name has its color dot, so the box is also the chart's color key.
  const bc = $("byCaregiver");
  const ro2 = readOnly();
  const keyOf = x => ro2 ? x.owner : samePerson(x.person);
  const rows = new Map();
  const row = x => {
    const k = keyOf(x);
    if (!rows.has(k)) rows.set(k, { name: ro2 ? cgName(x.owner) : (x.person || "No patient"), cls: tint(x), worked: 0, sched: 0 });
    return rows.get(k);
  };
  for (const s of data()) if (s.start >= wsMs && s.start < weMs) row(s).worked += endOf(s) - s.start;
  for (const o of occ) if (o.kind !== "off" && !o.cancelled) row(o).sched += o.end - o.start;
  const list = [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
  bc.hidden = !list.length && !ro2;
  // Same dates as the chart, so it's clear which period the hours are for.
  const dates = `${shortFmt.format(R.start)} – ${shortFmt.format(addDays(R.end, -1))}`;
  const title = periodTitle(R);
  const sumOf = k => list.reduce((t, r) => t + r[k], 0);
  bc.innerHTML = `<div class="bycg-head"><span class="label">Hours by ${ro2 ? "caregiver" : "patient"}</span>
      <span class="bycg-dates" id="bycgDates">${esc(title === dates ? title : `${title} · ${dates}`)}</span></div>` + (list.length
    ? list.map(r => `<div class="bycg-item${r.cls}">
        <div class="bycg-name"><span class="dot"></span>${esc(r.name)}</div>
        <div class="bycg-row"><span>Worked</span><span class="num">${hrs(r.worked)}</span></div>
        <div class="bycg-row"><span>Scheduled</span><span class="num">${hrs(r.sched)}</span></div></div>`).join("")
      + (list.length > 1 ? `<div class="bycg-total">
        <div class="bycg-name">Total</div>
        <div class="bycg-row"><span>Worked</span><span class="num">${hrs(sumOf("worked"))}</span></div>
        <div class="bycg-row"><span>Scheduled</span><span class="num">${hrs(sumOf("sched"))}</span></div></div>` : "")
    : `<p class="hint">No hours ${periodWords()}.</p>`);
}


// ================= render: list =================
function renderList() {
  const R = viewRange(), ws = R.s, we = R.e;
  const inWeek = data().filter(s => s.start >= ws && s.start < we).sort((a, b) => b.start - a.start);
  const list = $("list");
  if (!inWeek.length) {
    list.innerHTML = `<div class="empty">${readOnly()
      ? (sharedErr ? esc(sharedErr) : `No shifts recorded ${periodWords()}.`)
      : myPatient !== "all" ? `No shifts for ${esc(myPatientName())} ${periodWords()}.`
      : weekOffset === 0
        ? `No shifts yet ${periodWords()}. Tap <b>Clock in</b> when you start, or add a shift you forgot to record.`
        : `No shifts recorded ${periodWords()}.`}</div>`;
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
// ================= day details (tap a day in the week chart) =================
function renderDayDetail() {
  const el = $("dayDetail");
  const R = viewRange();
  if (!selDay || parseDate(selDay) < R.start || parseDate(selDay) >= R.end) { el.hidden = true; el.innerHTML = ""; return; }
  const ro = readOnly();
  const d = parseDate(selDay), ds = d.getTime(), de = addDays(d, 1).getTime();
  const worked = data().filter(s => sameDay(new Date(s.start), d)).sort((a, b) => a.start - b.start);
  const occ = occurrences(viewSched(), ds - DAY, de)
    .filter(o => o.kind === "off" ? (o.start < de && o.end > ds) : sameDay(new Date(o.start), d));
  const wMs = worked.reduce((t, s) => t + (endOf(s) - s.start), 0), sMs = schedHours(occ);
  const range = (a, b) => `${tFmt.format(new Date(a))} – ${b ? tFmt.format(new Date(b)) : "now"}${b && !sameDay(new Date(a), new Date(b)) ? " (next day)" : ""}`;
  const pname = x => ro ? patientName(x) : (x.person || "No patient");
  const by = x => ro ? ` · <span class="dot"></span>by ${esc(cgName(x.owner))}` : "";
  const lead = ro ? "" : '<span class="dot"></span>';   // the dot sits by the name that sets the color
  const workedRows = worked.map(s => `<div class="occ tinted${tint(s)}"><div class="range">${range(s.start, s.end)}</div><div class="dur">${dur(endOf(s) - s.start)}</div>
    <div class="meta">${lead}<b>${esc(pname(s))}</b>${by(s)}${s.note ? " · " + esc(s.note) : ""}${!s.end ? " · on the clock" : ""}</div></div>`).join("");
  const schedRows = occ.map(o => {
    if (o.kind === "off") {
      const a = Math.max(o.start, ds), b = Math.min(o.end, de);
      const when = a === ds && b === de ? "All day" : `${tFmt.format(new Date(a))} – ${b === de ? "midnight" : tFmt.format(new Date(b))}`;
      return ro
        ? `<div class="occ off tinted${cc(o.owner)}"><div class="range">${when}</div><div class="dur"></div><div class="meta"><span class="dot"></span><b>${esc(cgName(o.owner))}</b> unavailable</div></div>`
        : `<div class="occ off"><div class="range">${when}</div><div class="dur"></div><div class="meta"><span class="pill">Time off</span></div></div>`;
    }
    const what = ro ? "" : ` · ${o.e.kind === "weekly" ? `Repeats ${esc(daysLabel(o.e.days))}` : "One time"}`;
    const off = o.cancelled ? ` · <span class="pill">${ro ? "Caregiver unavailable" : "Time off"}</span>` : "";
    return `<div class="occ tinted${tint(o)}${o.cancelled ? " cancel" : ""}"><div class="range">${range(o.start, o.end)}</div><div class="dur">${dur(o.end - o.start)}</div>
      <div class="meta">${lead}<b>${esc(pname(o))}</b>${by(o)}${what}${off}${o.note ? " · " + esc(o.note) : ""}</div></div>`;
  }).join("");
  // Who this day is about, right after the date: patients for caregivers, caregivers for payers.
  const who = new Map();
  const note = (key, name, cls) => { if (key && !who.has(key)) who.set(key, { name, cls }); };
  for (const x of [...worked, ...occ]) {
    if (ro) note(x.owner, cgName(x.owner), cc(x.owner));
    else if (x.kind !== "off") note(samePerson(x.person), x.person, pc(x.person));
  }
  if (!who.size && !ro && myPatient !== "all") note(myPatient, myPatientName(), pc(myPatientName()));
  if (!who.size && ro && sharedCaregiver !== "all") note(sharedCaregiver, cgName(sharedCaregiver), cc(sharedCaregiver));
  const names = [...who.values()].sort((a, b) => a.name.localeCompare(b.name))
    .map(w => `<span class="who${w.cls}"><span class="dot"></span>${esc(w.name)}</span>`).join("");
  el.hidden = false;
  el.innerHTML = `<div class="rowline"><h3>${dayFmt.format(d)}${names ? ` <span class="whosep">·</span> <span class="whos">${names}</span>` : ""}</h3>
      <button type="button" class="link" id="dayClose">Close</button></div>
    <p class="vs">Worked <b>${hrs(wMs)}</b> · Scheduled <b>${hrs(sMs)}</b></p>
    <span class="label">Worked</span>${workedRows || `<p class="hint">No shifts logged.</p>`}
    <span class="label">Scheduled</span>${schedRows || `<p class="hint">Nothing scheduled.</p>`}`;
  $("dayClose").addEventListener("click", () => { selDay = null; renderWeek(); });
}
// Week / 2 weeks / Month switch, remembered on this device.
document.querySelectorAll("#rangePick [data-range]").forEach(b => b.addEventListener("click", () => {
  if (rangeMode === b.dataset.range) return;
  rangeMode = b.dataset.range; weekOffset = 0; selDay = null; confirmId = null;
  setLS(LS_RANGE, rangeMode);
  renderAll();
}));
$("bars").addEventListener("click", e => {
  const b = e.target.closest("button[data-day]"); if (!b) return;
  selDay = selDay === b.dataset.day ? null : b.dataset.day;
  renderWeek();
});

function shiftRow(s) {
  const st = new Date(s.start), live = !s.end;
  const en = live ? null : new Date(s.end);
  const range = `${tFmt.format(st)} – ${live ? "now" : tFmt.format(en)}${en && !sameDay(st, en) ? " (next day)" : ""}`;
  const meta = [s.person ? `${colorsOn() ? '<span class="dot"></span>' : ""}<b>${esc(patientName(s))}</b>` : "No patient", readOnly() && `<span class="dot"></span>by ${esc(cgName(s.owner))}`, s.note && esc(s.note), s.failed && "Not saved online"].filter(Boolean).join(" · ");
  const confirm = confirmId === s.id ? `<div class="confirm"><span>Delete this shift?</span>
    <button class="link danger" data-act="del-yes" data-id="${esc(s.id)}">Delete</button>
    <button class="link" data-act="del-no">Keep it</button></div>` : "";
  const acts = live || readOnly() ? "" : `<button class="link" data-act="edit" data-id="${esc(s.id)}">Edit</button>
      <button class="link danger" data-act="del" data-id="${esc(s.id)}">Delete</button>`;
  return `<div class="shift${live ? " live" : ""}${s.person ? " tinted" + tint(s) : ""}">
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
      <div class="field"><label class="label" for="fPerson">Patient</label>${patientSelect("fPerson", s ? s.person : draftPerson)}</div>
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
    if (!person) { $("fErr").textContent = "Choose a patient."; $("fPerson").focus(); return; }
    const prev = formOpen.prev;
    put({ id: formOpen.id || newId(), start: r.start, end: r.end, person: matchPatient(person), note: $("fNote").value.trim(), updatedAt: prev ? prev.updatedAt : 0 });
    weekOffset = offsetFor(new Date(r.start));
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

// ================= CSV export of the period on screen =================
function csvCell(v) { const s = String(v ?? ""); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
$("csvBtn").addEventListener("click", () => {
  const R = viewRange(), ws = R.start, we = R.e;
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
  const who = readOnly() ? (sharedCaregiver === "all" ? "shared" : cgName(sharedCaregiver)) : myPatient !== "all" ? myPatientName() : "";
  const slug = who ? who.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" : "";
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  const period = rangeMode === "month" ? `month-${dateVal(ws).slice(0, 7)}` : rangeMode === "2weeks" ? `2-weeks-of-${dateVal(ws)}` : `week-of-${dateVal(ws)}`;
  a.download = `care-hours-${slug}${period}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
});
