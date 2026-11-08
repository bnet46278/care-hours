// An in-memory stand-in for the Care Hours database, used only by the tests.
// It follows the same access rules as setup.sql, so the app behaves as it would against Supabase:
//   * people read and change only their own shifts, schedule and shares
//   * a payer reads a caregiver's shifts and schedule only for patients shared with them
//   * a payer sees a caregiver's time off (never a note), and the caregiver's display name
//   * people message each other only when one shares a patient with the other; only the two of them
//     can read a message, and only the recipient can mark it read (nothing else can change)
//   * a caregiver who holds weeks shows payers only the shifts that start before their shared_through,
//     and shared_through can never move back (version 5)
//   * signed-out visitors get nothing
const { randomUUID } = require("crypto");

// "Mom", "mom" and " Mom " are the same patient, as in setup.sql.
const samePerson = p => String(p || "").replace(/\s+/g, " ").trim().toLowerCase();
const KEYS = { shifts: ["owner", "id"], schedule: ["owner", "id"], shares: ["owner", "viewer_email", "person"], profiles: ["id"], messages: ["id"] };
const OWNER = { shifts: "owner", schedule: "owner", shares: "owner", profiles: "id", messages: "sender" };
// Columns people may set themselves, as granted in setup.sql (everything else is filled in by the database).
const INSERT_COLS = { messages: ["recipient", "body"] };
const UPDATE_COLS = { messages: ["read_at"] };

class FakeDb {
  // now: the time the database clock starts at (each new row is a second later than the last).
  // version: acts like a database set up with that version of setup.sql (4: no week holding; 3: also no messages or phone numbers).
  constructor({ now = Date.now(), version = 5 } = {}) {
    this.version = version;
    this.users = new Map();   // email -> id
    this.tables = { shifts: [], schedule: [], shares: [], profiles: [], messages: [] };
    this.clock = +now;
    this.onChange = null;     // called with the table name after a write, like Supabase's live updates
  }
  stamp() { this.clock += 1000; return new Date(this.clock).toISOString(); }

  // ---------- helpers for tests ----------
  rows(table) { return this.tables[table].map(r => ({ ...r })); }
  userId(email) { return this.users.get(email.toLowerCase()); }
  emailOf(id) { for (const [e, i] of this.users) if (i === id) return e; return null; }

  // ---------- my_contacts() and can_message() from setup.sql ----------
  contacts(me) {
    const out = new Map();
    const add = (id, email, role) => {
      if (out.has(email)) return;
      const p = this.tables.profiles.find(r => r.id === id) || {};
      out.set(email, { id: id || null, email, display_name: p.display_name || "", phone: p.phone || "", role });
    };
    const rows = [];
    for (const s of this.tables.shares) if (s.owner === me.id) rows.push([this.users.get(s.viewer_email) || null, s.viewer_email, "payer"]);
    for (const s of this.tables.shares) if (me.email && s.viewer_email === me.email && s.owner !== me.id) rows.push([s.owner, this.emailOf(s.owner), "caregiver"]);
    rows.sort((a, b) => a[1].localeCompare(b[1]) || a[2].localeCompare(b[2]));
    for (const r of rows) add(...r);
    return [...out.values()];
  }
  // shift_released() from setup.sql
  released(owner, startAt) {
    const p = this.tables.profiles.find(r => r.id === owner);
    if (!p || !p.hold_weeks) return true;
    return !!p.shared_through && Date.parse(startAt) < Date.parse(p.shared_through);
  }
  canMessage(other, me) { return !!other && other !== me.id && this.contacts(me).some(c => c.id === other); }

  // ---------- access rules ----------
  sharedWithMe(owner, me) {
    return !!me.email && this.tables.shares.some(s => s.owner === owner && s.viewer_email === me.email);
  }
  canViewPatient(owner, person, me) {
    return !!me.email && samePerson(person) !== "" &&
      this.tables.shares.some(s => s.owner === owner && s.viewer_email === me.email && samePerson(s.person) === samePerson(person));
  }
  canRead(table, r, me) {
    if (!me.id) return false;
    if (table === "shifts") return r.owner === me.id || (this.canViewPatient(r.owner, r.person, me) && this.released(r.owner, r.start_at));
    if (table === "schedule") return r.owner === me.id ||
      (r.kind === "off" ? this.sharedWithMe(r.owner, me) : this.canViewPatient(r.owner, r.person, me));
    if (table === "shares") return r.owner === me.id || r.viewer_email === me.email;
    if (table === "profiles") return r.id === me.id || this.sharedWithMe(r.id, me);
    if (table === "messages") return r.sender === me.id || r.recipient === me.id;
    return false;
  }
  canWrite(table, r, me) {
    if (table === "messages") return !!me.id && r.sender === me.id && this.canMessage(r.recipient, me);
    return !!me.id && r[OWNER[table]] === me.id;
  }
  check(table, r) {
    if (table === "shares") {
      if (r.viewer_email !== String(r.viewer_email || "").toLowerCase()) return "viewer_email must be lowercase";
      if (!String(r.person || "").trim()) return "a share needs a patient";
    }
    if (table === "messages" && !(String(r.body || "").trim().length >= 1 && String(r.body).trim().length <= 2000)) return "a message needs 1 to 2000 characters";
    if (table === "profiles" && String(r.phone || "").length > 30) return "phone is too long";
    if (table === "shifts" && r.end_at && Date.parse(r.end_at) < Date.parse(r.start_at)) return "shift ends before it starts";
    if (table === "schedule" && !r.deleted) {
      if (r.kind === "off" && (r.person || r.note)) return "time off can't have a patient or a note";
      if (r.kind !== "off" && (!String(r.person || "").trim() || !r.start_time || !r.end_time)) return "a scheduled shift needs a patient and times";
      if (r.kind === "weekly" && !(r.days || []).length) return "a repeating shift needs at least one day";
    }
    return null;
  }

  // ---------- the request handler the fake client talks to ----------
  handle(q) {
    if (q.op === "login") {
      const email = q.email.toLowerCase();
      if (!this.users.has(email)) this.users.set(email, randomUUID());
      return { data: { id: this.users.get(email), email }, error: null };
    }
    const me = { id: q.uid || null, email: (q.email || "").toLowerCase() };
    if (q.op === "rpc") {
      if (!me.id) return { data: null, error: { code: "42501", message: "permission denied" } };
      if (q.name === "my_contacts" && this.version >= 4) return { data: this.contacts(me), error: null };
      return { data: null, error: { code: "PGRST202", message: `Could not find the function public.${q.name}` } };
    }
    const table = this.version < 4 && q.table === "messages" ? null : this.tables[q.table];
    if (this.version < 4 && q.table === "profiles" && (q.rows || []).some(r => "phone" in r))
      return { data: null, error: { code: "PGRST204", message: "Could not find the 'phone' column of 'profiles' in the schema cache" } };
    if (!table) return { data: null, error: { code: "PGRST205", message: `Could not find the table 'public.${q.table}'` } };
    if (!me.id) return { data: null, error: { code: "42501", message: `permission denied for table ${q.table}` } };
    const matches = r => (q.filters || []).every(([c, op, v]) =>
      op === "eq" ? r[c] === v : op === "neq" ? r[c] !== v : op === "in" ? v.includes(r[c]) : op === "is" ? (r[c] ?? null) === v : true);
    const denied = { data: null, error: { code: "42501", message: `permission denied for table ${q.table}` } };
    const key = r => KEYS[q.table].map(k => r[k]).join("|");

    if (q.op === "select") {
      let out = table.filter(r => this.canRead(q.table, r, me) && matches(r));
      if (q.order) out = [...out].sort((a, b) => String(a[q.order]).localeCompare(String(b[q.order])));
      if (q.range) out = out.slice(q.range[0], q.range[1] + 1);
      out = out.map(r => ({ ...r }));
      return { data: q.single ? (out[0] || null) : out, error: null };
    }
    if (q.op === "insert" || q.op === "upsert") {
      for (const raw of q.rows) {
        if (INSERT_COLS[q.table] && Object.keys(raw).some(k => !INSERT_COLS[q.table].includes(k))) return denied;
        const row = { ...raw };
        if (q.table === "messages") Object.assign(row, { id: randomUUID(), read_at: null, created_at: this.stamp() });
        if (!(OWNER[q.table] in row)) row[OWNER[q.table]] = me.id;
        if (!this.canWrite(q.table, row, me)) return { data: null, error: { code: "42501", message: `new row violates row-level security policy for table "${q.table}"` } };
        const bad = this.check(q.table, row);
        if (bad) return { data: null, error: { code: "23514", message: bad } };
        const i = table.findIndex(r => key(r) === key(row));
        // The keep_shared_through trigger: a shared week can't be unshared.
        if (q.table === "profiles" && i >= 0 && "shared_through" in row && table[i].shared_through &&
            (!row.shared_through || Date.parse(row.shared_through) < Date.parse(table[i].shared_through)))
          return { data: null, error: { code: "23514", message: "A shared week can't be unshared" } };
        if (this.version < 5 && q.table === "profiles" && ("hold_weeks" in row || "shared_through" in row))
          return { data: null, error: { code: "PGRST204", message: "Could not find the 'hold_weeks' column of 'profiles' in the schema cache" } };
        if (i >= 0 && q.op === "insert") return { data: null, error: { code: "23505", message: "duplicate key" } };
        if (i >= 0) table[i] = { ...table[i], ...row }; else table.push({ created_at: this.stamp(), ...row });
      }
      this.changed(q.table);
      return { data: null, error: null };
    }
    if (q.op === "update") {
      if (UPDATE_COLS[q.table] && Object.keys(q.vals).some(k => !UPDATE_COLS[q.table].includes(k))) return denied;
      const mayUpdate = r => q.table === "messages" ? r.recipient === me.id : r[OWNER[q.table]] === me.id;
      for (const r of table) if (matches(r) && this.canRead(q.table, r, me) && mayUpdate(r)) Object.assign(r, q.vals);
      this.changed(q.table);
      return { data: null, error: null };
    }
    if (q.op === "delete") {
      if (q.table === "messages") return denied;   // nobody deletes messages
      const keep = table.filter(r => !(matches(r) && this.canWrite(q.table, r, me)));
      this.tables[q.table] = keep;
      return { data: null, error: null };
    }
    return { data: null, error: { code: "400", message: "unsupported" } };
  }
  changed(table) { if (this.onChange) this.onChange(table); }
}

module.exports = { FakeDb, samePerson };
