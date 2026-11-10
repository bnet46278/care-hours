// Care Hours: emails sent on a caregiver's behalf. A Supabase Edge Function named "notify".
// Deploy it once (see "Emails to clients" in README.md). It runs on Supabase, never in the browser, so it can
// use the service role key that Supabase gives every Edge Function. That key never leaves Supabase.
//
// The app calls it with the signed-in caregiver's session:
//   { action: "invite", email, person }
//       The caregiver added `person` with `email` as the client (or the patient is the client). Someone new
//       gets Supabase's "Invite user" email, to set up their client account. Someone who already has an
//       account gets a short email instead. Only allowed after the caregiver shared that patient with that email.
//   { action: "request", person }
//       The caregiver asked to be added to `person`, who's already in Care Hours. That patient's client gets
//       an email asking them to approve or decline. Only allowed for the caregiver's own request.
//
// Secrets (Supabase dashboard -> Edge Functions -> Secrets):
//   SITE_URL   your Care Hours address, like https://you.github.io/care-hours/
//   SMTP_HOST, SMTP_PORT (465), SMTP_USER, SMTP_PASS, SMTP_FROM
//              the email service that sends the short emails (the same one as Authentication -> SMTP Settings
//              works). Edge Functions can't use ports 25 or 587, so use port 465. Without these, invites to new
//              people still go out (Supabase sends those), and the other emails are skipped.
import { createClient } from "npm:@supabase/supabase-js@2.93.3";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const samePerson = (p: unknown) => String(p ?? "").replace(/\s+/g, " ").trim().toLowerCase();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "Use POST" }, 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Who's asking: the signed-in caregiver.
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: auth } = await admin.auth.getUser(token);
  const me = auth?.user;
  if (!me) return reply({ error: "Sign in first" }, 401);
  const body = await req.json().catch(() => ({}));
  const site = Deno.env.get("SITE_URL") || "";
  const { data: prof } = await admin.from("profiles").select("display_name").eq("id", me.id).maybeSingle();
  const who = (prof && prof.display_name) || me.email || "A caregiver";

  if (body.action === "invite") {
    const email = String(body.email || "").trim().toLowerCase();
    const person = String(body.person || "").replace(/\s+/g, " ").trim();
    if (!email || !person) return reply({ error: "An email and a patient are needed" }, 400);
    // Only someone this caregiver shares the patient with: they're that patient's client.
    const { data: shares } = await admin.from("shares").select("person").eq("owner", me.id).eq("viewer_email", email);
    if (!(shares || []).some((s) => samePerson(s.person) === samePerson(person))) return reply({ error: "Not your client" }, 403);
    const { error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: site || undefined,
      data: { invited_by: who, patient: person },
    });
    if (!error) return reply({ sent: "invite" });
    if (!/already|registered|exists/i.test(error.message || "")) return reply({ error: error.message }, 500);
    // They already have an account: tell them instead.
    const sent = await mail(email, `${who} added you in Care Hours`,
      `${who} added ${person} in Care Hours, with you as ${person}'s client.\n\n` +
      `Sign in to Care Hours with this email to see ${person}'s shifts${site ? `: ${site}` : "."}`);
    return reply({ sent: sent ? "notice" : "none", registered: true });
  }

  if (body.action === "request") {
    const person = samePerson(body.person);
    const { data: reqs } = await admin.from("patient_requests").select("owner, id, person, created_at")
      .eq("requester", me.id).order("created_at", { ascending: false });
    const r = (reqs || []).find((x) => samePerson(x.person) === person);
    if (!r) return reply({ error: "No request" }, 403);
    const { data: p } = await admin.from("patients").select("person, client_id").eq("owner", r.owner).eq("id", r.id).maybeSingle();
    const { data: c } = p && p.client_id
      ? await admin.from("clients").select("email").eq("id", p.client_id).maybeSingle()
      : { data: null };
    if (!c || !c.email) return reply({ sent: "none" });
    const sent = await mail(c.email, `${who} asked to care for ${p!.person}`,
      `${who} (${me.email}) asked to be added as a caregiver for ${p!.person} in Care Hours.\n\n` +
      `Open Care Hours to approve or decline. It's on your Caregivers tab${site ? `: ${site}` : "."}`);
    return reply({ sent: sent ? "notice" : "none" });
  }

  return reply({ error: "Unknown action" }, 400);
});

// Sends a short plain-text email through your own email service. False when it isn't set up.
async function mail(to: string, subject: string, content: string): Promise<boolean> {
  const host = Deno.env.get("SMTP_HOST");
  if (!host) return false;
  const port = Number(Deno.env.get("SMTP_PORT") || 465);
  const client = new SMTPClient({
    connection: {
      hostname: host, port, tls: port === 465,
      auth: { username: Deno.env.get("SMTP_USER") || "", password: Deno.env.get("SMTP_PASS") || "" },
    },
  });
  try {
    await client.send({ from: Deno.env.get("SMTP_FROM") || Deno.env.get("SMTP_USER") || "", to, subject, content });
    return true;
  } catch (_e) {
    return false;
  } finally {
    await client.close().catch(() => {});
  }
}
