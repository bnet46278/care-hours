// Stand-in for the supabase-js library, loaded into the app during tests instead of the real one.
// It sends every request to https://fake-supabase.test/q, which the tests answer from the fake database.
// Sign-in codes: 123456 always works; anything else is "expired or invalid".
(function () {
  const API = "https://fake-supabase.test/q";
  const call = q => fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(q) })
    .then(r => r.json())
    .catch(() => ({ data: null, error: { message: "Failed to fetch" } }));

  window.supabase = { createClient(url, key, opts) {
    const SK = opts.auth.storageKey;
    let session = null;
    try { session = JSON.parse(localStorage.getItem(SK)); } catch (e) {}
    const subs = [];
    const emit = ev => subs.forEach(cb => cb(ev, session));
    const auth = {
      onAuthStateChange(cb) { subs.push(cb); setTimeout(() => cb("INITIAL_SESSION", session), 0); return { data: { subscription: { unsubscribe() {} } } }; },
      async signInWithOtp() { window.__codesSent = (window.__codesSent || 0) + 1; return { error: null }; },
      async verifyOtp({ email, token }) {
        if (token !== "123456") return { error: { message: "Token has expired or is invalid" } };
        const r = await call({ op: "login", email });
        session = { user: r.data };
        localStorage.setItem(SK, JSON.stringify(session));
        emit("SIGNED_IN");
        return { data: { session }, error: null };
      },
      async signOut() { session = null; localStorage.removeItem(SK); emit("SIGNED_OUT"); return { error: null }; },
    };
    function from(table) {
      const q = { table, filters: [] };
      const b = {
        select(cols) { q.op = q.op || "select"; q.cols = cols; return b; },
        eq(c, v) { q.filters.push([c, "eq", v]); return b; },
        neq(c, v) { q.filters.push([c, "neq", v]); return b; },
        in(c, v) { q.filters.push([c, "in", v]); return b; },
        order(c) { q.order = c; return b; },
        range(a, z) { q.range = [a, z]; return b; },
        maybeSingle() { q.single = true; return b; },
        upsert(rows) { q.op = "upsert"; q.rows = Array.isArray(rows) ? rows : [rows]; return b; },
        insert(rows) { q.op = "insert"; q.rows = Array.isArray(rows) ? rows : [rows]; return b; },
        delete() { q.op = "delete"; return b; },
        then(res, rej) {
          const u = session && session.user;
          return call({ ...q, uid: u && u.id, email: u && u.email }).then(res, rej);
        },
      };
      return b;
    }
    return { auth, from };
  } };
})();
