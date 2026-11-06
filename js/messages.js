// Care Hours: Messages between caregivers and payers, and the Text button that opens the phone's Messages app.
// All app files share one set of names (classic scripts), and load in the order listed in index.html.
//
// Two people can message each other when one shares a patient with the other (see setup.sql).
// Messages live only online: they need a connection to send, and new ones appear right away.

let contacts = [];        // [{id|null, email, name, phone, role: "payer"|"caregiver"}], from my_contacts()
let messages = [];        // [{id, sender, recipient, body, created_at, read_at}], oldest first
let chatWith = null;      // id of the person whose conversation is open
let msgDraft = {};        // unsent text, by person id
let msgUi = { busy: false, err: "", loadErr: "" };
let msgChannel = null;
let msgRendered = null;   // which conversation the compose box was built for

// ---------- phone numbers ----------
// Keep digits (and a leading +). A 10-digit number is taken as US/Canada.
function normPhone(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const digits = s.replace(/\D/g, "");
  if (s.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? "+" + digits : null;
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits[0] === "1") return "+" + digits;
  return null;
}
function showPhone(p) {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(p || "");
  return m ? `${m[1]}-${m[2]}-${m[3]}` : p || "";
}
// Opens the phone's own Messages app, addressed to this person.
const smsLink = (phone, body) => `sms:${phone}${body ? "?&body=" + encodeURIComponent(body) : ""}`;
const textButton = c => c && c.phone
  ? `<a class="ghost textbtn" href="${esc(smsLink(c.phone))}" aria-label="Text ${esc(c.name)} at ${esc(showPhone(c.phone))}">Text</a>` : "";

// ---------- loading ----------
const contactName = c => c.name || c.email;
const contactById = id => contacts.find(c => c.id === id);
const unreadFrom = id => messages.filter(m => m.recipient === me.id && !m.read_at && (id === undefined || m.sender === id)).length;
const unreadCount = () => (me ? unreadFrom() : 0);
const msgTab = () => !!me && contacts.length > 0;

async function loadContacts() {
  if (!sb || !me) return;
  const { data: rows, error } = await sb.rpc("my_contacts");
  if (error) return;   // an older database without messages: the tab stays hidden
  contacts = rows.map(r => ({ id: r.id || null, email: r.email, name: r.display_name || "", phone: r.phone || "", role: r.role }))
    .sort((a, b) => contactName(a).localeCompare(contactName(b)));
  if (chatWith && !contactById(chatWith)) chatWith = null;
  if (view === "msgs" && !msgTab()) view = payerMode() ? "all" : "mine";
}
async function loadMessages() {
  if (!sb || !me || !msgTab()) return;
  try {
    messages = (await fetchAll(() => sb.from("messages").select("*").order("created_at")))
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    msgUi.loadErr = "";
  } catch (e) {
    msgUi.loadErr = "Couldn't load messages. Check your connection.";
  }
  if (view === "msgs" && chatWith && document.visibilityState !== "hidden") await markRead(chatWith);
  renderTabs(); renderMessages();
}
async function refreshMessaging() { await loadContacts(); await loadMessages(); renderTabs(); renderMessages(); }

// Live updates while the app is open, plus a check now and then in case the connection dropped.
function startMessaging() {
  stopMessaging();
  if (!sb || !me) return;
  try {
    msgChannel = sb.channel("messages-" + me.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => refreshMessaging())
      .subscribe();
  } catch (e) { msgChannel = null; }
  refreshMessaging();
}
function stopMessaging() {
  if (msgChannel && sb) sb.removeChannel(msgChannel).catch(() => {});
  msgChannel = null;
  contacts = []; messages = []; chatWith = null; msgDraft = {}; msgUi = { busy: false, err: "", loadErr: "" }; msgRendered = null;
}
setInterval(() => { if (me && document.visibilityState === "visible") refreshMessaging(); }, 60000);
document.addEventListener("visibilitychange", () => { if (me && document.visibilityState === "visible") refreshMessaging(); });

async function markRead(id) {
  if (!unreadFrom(id)) return;
  const at = new Date().toISOString();
  const { error } = await sb.from("messages").update({ read_at: at }).eq("recipient", me.id).eq("sender", id).is("read_at", null);
  if (!error) for (const m of messages) if (m.recipient === me.id && m.sender === id && !m.read_at) m.read_at = at;
}

async function sendMessage(ev) {
  ev.preventDefault();
  const box = $("msgBody");
  const body = (box.value || "").trim();
  msgUi.err = "";
  if (!body) { msgUi.err = "Type a message first."; renderMessages(); return; }
  if (body.length > 2000) { msgUi.err = "That's too long. Messages can be up to 2,000 characters."; renderMessages(); return; }
  msgUi.busy = true; renderMessages();
  const to = chatWith;
  const { error } = await sb.from("messages").insert({ recipient: to, body });
  msgUi.busy = false;
  if (error) {
    msgUi.err = navigator.onLine === false || /fetch/i.test(error.message || "")
      ? "Not sent. You're offline. Your message is still here; try again when you're connected."
      : "Not sent. Check your connection and try again.";
    renderMessages(); return;
  }
  msgDraft[to] = "";
  if ($("msgBody")) $("msgBody").value = "";
  await loadMessages();
  if ($("msgBody")) $("msgBody").focus();
}

// ---------- render ----------
const msgTime = iso => {
  const d = new Date(iso), now = new Date();
  return sameDay(d, now) ? tFmt.format(d) : shortFmt.format(d) + ", " + tFmt.format(d);
};
// What each person is to you: the patients you share with them, or the patients they share with you.
function contactRole(c) {
  if (c.role === "payer") {
    const pats = [...new Set(shares.filter(x => x.email === c.email).map(x => x.person))];
    return pats.length ? "Sees " + pats.join(", ") : "Payer";
  }
  const pats = c.id ? patientsOf(c.id) : [];
  return pats.length ? "Caring for " + pats.join(", ") : "Caregiver";
}
const contactColor = c => (c.role === "caregiver" && c.id ? cc(c.id) : "");
const threadWith = id => messages.filter(m => (m.sender === me.id && m.recipient === id) || (m.sender === id && m.recipient === me.id));

function renderMessages() {
  const el = $("msgs");
  if (!el) return;
  if (view !== "msgs" || !me) { el.hidden = true; msgRendered = null; return; }
  el.hidden = false;
  const c = chatWith && contactById(chatWith);
  if (!c) { msgRendered = null; el.innerHTML = renderContactList(); wireContactList(el); return; }

  // Keep the compose box (and anything being typed in it) when only the conversation changes.
  if (msgRendered !== c.id || !$("msgCompose")) {
    el.innerHTML = `
      <div class="chathead">
        <button type="button" class="link" id="msgBack">‹ All messages</button>
        <div class="rowline"><h2 class="${contactColor(c).trim()}">${contactColor(c) ? '<span class="dot"></span>' : ""}${esc(contactName(c))}</h2>${textButton(c)}</div>
        <p class="hint">${esc(contactRole(c))}</p>
      </div>
      <div class="thread" id="msgThread" aria-live="polite"></div>
      <form id="msgCompose" class="field compose" novalidate>
        <label class="label" for="msgBody">Message to ${esc(contactName(c))}</label>
        <textarea id="msgBody" rows="3" maxlength="2000" placeholder="Running a few minutes late…">${esc(msgDraft[c.id] || "")}</textarea>
        <div class="rowline"><span class="err" id="msgErr" role="alert"></span><button class="btn" type="submit" id="msgSend">Send</button></div>
      </form>`;
    msgRendered = c.id;
    $("msgBack").addEventListener("click", () => { chatWith = null; renderAll(); });
    $("msgCompose").addEventListener("submit", sendMessage);
    $("msgBody").addEventListener("input", e => { msgDraft[c.id] = e.target.value; });
  }
  $("msgErr").textContent = msgUi.err;
  $("msgSend").disabled = msgUi.busy;
  $("msgSend").textContent = msgUi.busy ? "Sending…" : "Send";

  const list = threadWith(c.id);
  const lastMine = [...list].reverse().find(m => m.sender === me.id);
  let lastDay = "";
  const thread = $("msgThread");
  thread.innerHTML = msgUi.loadErr ? `<p class="err">${esc(msgUi.loadErr)}</p>` : list.length ? list.map(m => {
    const day = dayFmt.format(new Date(m.created_at));
    const head = day !== lastDay ? `<div class="msgday">${esc(day)}</div>` : "";
    lastDay = day;
    const mine = m.sender === me.id;
    return head + `<div class="bubble ${mine ? "mine" : "theirs"}" data-msg="${esc(m.id)}">
      <div class="body">${esc(m.body)}</div>
      <div class="meta">${esc(msgTime(m.created_at))}${mine && m === lastMine && m.read_at ? " · Read" : ""}</div></div>`;
  }).join("") : `<p class="empty">No messages with ${esc(contactName(c))} yet. Say hello, or send a note about a shift.</p>`;
  thread.scrollTop = thread.scrollHeight;
}

function renderContactList() {
  const rows = contacts.map(c => {
    const t = c.id ? threadWith(c.id) : [];
    const last = t[t.length - 1];
    const n = c.id ? unreadFrom(c.id) : 0;
    const preview = !c.id ? "Hasn't signed in to Care Hours yet, so they can't get messages here."
      : last ? (last.sender === me.id ? "You: " : "") + last.body : "No messages yet";
    const main = `<span class="who"><b class="${contactColor(c).trim()}">${contactColor(c) ? '<span class="dot"></span>' : ""}${esc(contactName(c))}</b>
        <span class="hint">${esc(contactRole(c))}</span>
        <span class="preview">${esc(preview)}</span></span>
      <span class="when">${last ? esc(msgTime(last.created_at)) : ""}${n ? `<span class="badge" aria-label="${n} unread">${n}</span>` : ""}</span>`;
    return `<li class="contact${n ? " unread" : ""}">
      ${c.id ? `<button type="button" class="open" data-chat="${esc(c.id)}">${main}</button>` : `<div class="open off">${main}</div>`}
      ${textButton(c)}</li>`;
  }).join("");
  return `<h2>Messages</h2>
    ${msgUi.loadErr ? `<p class="err">${esc(msgUi.loadErr)}</p>` : ""}
    <ul class="contacts">${rows}</ul>
    <p class="hint">${payerMode() ? "You can message the caregivers who share with you." : "You can message the people you share a patient with."}
      Text opens your phone's Messages app instead${contacts.some(c => c.phone) ? "" : ", once someone adds their mobile number"}.</p>`;
}
function wireContactList(el) {
  el.querySelectorAll("[data-chat]").forEach(b => b.addEventListener("click", async () => {
    chatWith = b.dataset.chat; msgUi.err = "";
    renderAll();
    await markRead(chatWith);
    renderTabs(); renderMessages();
  }));
}
