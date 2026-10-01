import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Creates (or activates) the invited teammate's auth account directly from
// their own "Join team" form submission -- name + password only, no email
// field, no dependence on Supabase's own single-use magic-link email at
// all. That link was getting consumed before the invitee could use it
// (exact cause varies -- link scanners, proxies, whatever sits between
// Resend and the inbox), dumping them onto the wrong page every time.
// This sidesteps the whole class of bug: nothing here can fire except from
// an explicit, in-browser form submission.
//
//   POST { invite_token, password } -> { email }
//     caller signs in with that email + the same password right after, then
//     calls complete-signup (unchanged) to attach the profile/company/role.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey" },
    });
  }
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { invite_token, password } = await req.json();
    if (!invite_token || !password) return json({ error: "invite_token and password are required" }, 400);
    if (String(password).length < 6) return json({ error: "Password must be at least 6 characters." }, 400);

    const { data: invite, error: inviteErr } = await supabase
      .from("company_invites")
      .select("email, used_at, expires_at")
      .eq("token", invite_token)
      .maybeSingle();
    if (inviteErr) throw inviteErr;
    if (!invite) return json({ error: "This invite link is invalid -- ask for a new one." }, 404);
    if (invite.used_at) return json({ error: "This invite has already been used." }, 400);
    if (new Date(invite.expires_at) < new Date()) return json({ error: "This invite has expired -- ask for a new one." }, 400);

    const email = invite.email;

    const { error: createErr } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createErr) {
      if (!/already.*registered|already.*exist/i.test(createErr.message || "")) throw createErr;
      // An account for this email already exists -- most likely a leftover
      // from an earlier broken attempt. Look it up and set this password on
      // it instead of failing here.
      const { data: link, error: linkErr } = await supabase.auth.admin.generateLink({ type: "recovery", email });
      if (linkErr || !link?.user?.id) throw new Error("Could not find the existing account for this email.");
      const { error: updErr } = await supabase.auth.admin.updateUserById(link.user.id, { password, email_confirm: true });
      if (updErr) throw updErr;
    }

    return json({ email });
  } catch (err: any) {
    console.error("accept-invite error:", err);
    return json({ error: err.message }, 500);
  }
});
