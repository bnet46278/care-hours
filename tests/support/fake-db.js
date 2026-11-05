// An in-memory stand-in for the Care Hours database, used only by the tests.
// It follows the same access rules as setup.sql, so the app behaves as it would against Supabase:
//   * people read and change only their own shifts, schedule and shares
//   * a payer reads a caregiver's shifts and schedule only for patients shared with them
//   * a payer sees a caregiver's time off (never a note), and the caregiver's display name
//   * signed-out visitors get nothing
const { randomUUID } = require("crypto");

// "Mom", "mom" and " Mom " are the same patient, as in setup.sql.
const samePerson = p => String(p || "").replace(/\s+/g, " ").trim().toLowerCase();
const KEYS = { shifts: ["owner", "id"], schedule: ["owner", "id"], shares: ["owner", "viewer_email", "person"], profiles: ["id"] };
const OWNER = { shifts: "owner", schedule: "owner", shares: "owner", profiles: "id" };

class FakeDb {
  constructor() {
    this.users = new Map();   // email -> id
    this.tables = { shifts: [], schedule: [], shares: [], profiles: [] };
  }

  // ---------- helpers for tests ----------
  rows(table) { return this.tables[table].map(r => ({ ...r })); }
  userId(email) { return this.users.get(email.toLowerCase()); }

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
    if (table === "shifts") return r.owner === me.id || this.canViewPatient(r.owner, r.person, me);
    if (table === "schedule") return r.owner === me.id ||
      (r.kind === "off" ? this.sharedWithMe(r.owner, me) : this.canViewPatient(r.owner, r.person, me));
    if (table === "shares") return r.owner === me.id || r.viewer_email === me.email;
    if (table === "profiles") return r.id === me.id || this.sharedWithMe(r.id, me);
    return false;
  }
  canWrite(table, r, me) { return !!me.id && r[OWNER[table]] === me.id; }
  check(table, r) {
    if (table === "shares") {
      if (r.viewer_email !== String(r.viewer_email || "").toLowerCase()) return "viewer_email must be lowercase";
      if (!String(r.person || "").trim()) return "a share needs a patient";
    }
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
    const table = this.tables[q.table];
    if (!table) return { data: null, error: { code: "PGRST205", message: `Could not find the table 'public.${q.table}'` } };
    if (!me.id) return { data: null, error: { code: "42501", message: `permission denied for table ${q.table}` } };
    const matches = r => (q.filters || []).every(([c, op, v]) =>
      op === "eq" ? r[c] === v : op === "neq" ? r[c] !== v : op === "in" ? v.includes(r[c]) : true);
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
        const row = { ...raw };
        if (!(OWNER[q.table] in row)) row[OWNER[q.table]] = me.id;
        if (!this.canWrite(q.table, row, me)) return { data: null, error: { code: "42501", message: `new row violates row-level security policy for table "${q.table}"` } };
        const bad = this.check(q.table, row);
        if (bad) return { data: null, error: { code: "23514", message: bad } };
        const i = table.findIndex(r => key(r) === key(row));
        if (i >= 0 && q.op === "insert") return { data: null, error: { code: "23505", message: "duplicate key" } };
        if (i >= 0) table[i] = { ...table[i], ...row }; else table.push({ created_at: new Date().toISOString(), ...row });
      }
      return { data: null, error: null };
    }
    if (q.op === "delete") {
      const keep = table.filter(r => !(matches(r) && this.canWrite(q.table, r, me)));
      this.tables[q.table] = keep;
      return { data: null, error: null };
    }
    return { data: null, error: { code: "400", message: "unsupported" } };
  }
}

module.exports = { FakeDb, samePerson };
