// Care Hours: Schedule math: turns repeating shifts, one-time shifts and time off into real times. No screen code here.
// All app files share one set of names (classic scripts), and load in the order listed in index.html.

// ---------- schedule: turn entries into real times ----------

const liveSched = () => sched.filter(e => !e.deleted);
// Every scheduled shift and time off that touches [from, to), each with real start/end times.
function occurrences(entries, from, to) {
  const out = [];
  for (const e of entries) {
    if (e.deleted) continue;
    if (e.kind === "off") {
      const first = parseDate(e.onDate), last = parseDate(e.untilDate || e.onDate);
      const start = atTime(first, e.startTime || "00:00");
      let end = e.endTime ? atTime(last, e.endTime) : atTime(addDays(last, 1), "00:00");
      // Use the next day's clock time, not "+24 hours", so the night the clocks change comes out right.
      if (end <= start) end = atTime(addDays(last, 1), e.endTime || "00:00");
      if (start < to && end > from) out.push({ e, owner: e.owner, kind: "off", start, end });
      continue;
    }
    const startDay = parseDate(e.onDate), stopDay = e.untilDate ? parseDate(e.untilDate) : null;
    for (let d = addDays(new Date(from), -1); d.getTime() < to; d = addDays(d, 1)) {
      d.setHours(0, 0, 0, 0);
      if (d < startDay || (stopDay && d > stopDay)) continue;
      if (e.kind === "once" && !sameDay(d, startDay)) continue;
      if (e.kind === "weekly" && !e.days.includes(d.getDay())) continue;
      const start = atTime(d, e.startTime);
      let end = atTime(d, e.endTime);
      if (end <= start) end = atTime(addDays(d, 1), e.endTime);   // overnight: next day's clock time, so clock changes count
      if (start < to && end > from) out.push({ e, owner: e.owner, kind: e.kind, person: e.person, note: e.note, start, end });
    }
  }
  // Time off wins: a scheduled shift during the same caregiver's time off doesn't happen.
  const offs = out.filter(o => o.kind === "off");
  for (const o of out) if (o.kind !== "off") o.cancelled = offs.some(f => f.owner === o.owner && f.start < o.end && f.end > o.start);
  return out.sort((a, b) => a.start - b.start || (a.kind === "off" ? -1 : 1));
}
const schedHours = occ => occ.filter(o => o.kind !== "off" && !o.cancelled).reduce((t, o) => t + (o.end - o.start), 0);

// Schedule entries the current view is about.
function viewSched() {
  if (readOnly()) {
    return sharedSched.filter(e => sharedCaregiver === "all" || e.owner === sharedCaregiver);
  }
  return liveSched().filter(forMyPatient).map(e => ({ ...e, owner: "me" }));
}
