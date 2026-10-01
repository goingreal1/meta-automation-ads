import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Emails a teammate a one-click invite link via Resend. Unlike the old
// version of this function (which just linked to index.html's normal
// signup form), this now creates the auth user server-side via
// auth.admin.generateLink and emails Supabase's own magic-link action_link
// directly -- so an invited teammate:
//   - never sees Supabase's own "confirm your email" email (there isn't
//     one; generateLink only creates the account + a one-time link, it
//     never sends mail itself)
//   - lands already signed in on setup-company.html, where they pick a
//     name and password once and they're done
// Confirmation email is still required for a brand-new company's first
// admin (self-serve signup on index.html) -- that's a different, intentional
// path. This function is only for inviting someone INTO an existing company.
//
//   POST { access_token, token, email }
//     access_token -- the caller's own Supabase session token (proves they're
//                      logged in as an owner/admin of the invite's company)
//     token         -- the invite's token (company_invites.token)
//     email         -- where to send it (also re-validated server-side against
//                       the invite row, so a caller can't redirect someone
//                       else's invite to an arbitrary address)

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") ?? "";
// The site's own origin, no trailing slash and no filename -- e.g.
// https://metaautomationads.vercel.app -- used to build the setup-company.html
// redirect that Supabase's magic link lands on after it signs the invitee in.
const DASHBOARD_BASE_URL = (Deno.env.get("DASHBOARD_BASE_URL") ?? "").replace(/\/+$/, "");

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

  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL || !DASHBOARD_BASE_URL) {
    return json({ error: "Email sending isn't configured yet -- RESEND_API_KEY, RESEND_FROM_EMAIL and DASHBOARD_BASE_URL need to be set as Supabase edge function secrets." }, 500);
  }

  try {
    const { access_token, token, email } = await req.json();
    if (!access_token || !token || !email) return json({ error: "access_token, token and email are required" }, 400);

    const { data: { user }, error: authErr } = await supabase.auth.getUser(access_token);
    if (authErr || !user) return json({ error: "Not signed in." }, 401);

    const { data: callerProfile } = await supabase.from("profiles").select("role, company_id").eq("id", user.id).maybeSingle();
    if (!callerProfile || !["owner", "admin"].includes(callerProfile.role)) {
      return json({ error: "Only an owner or admin can send invites." }, 403);
    }

    const { data: invite } = await supabase.from("company_invites").select("id, role, email, company_id, used_at, expires_at").eq("token", token).maybeSingle();
    if (!invite) return json({ error: "Invite not found." }, 404);
    if (invite.company_id !== callerProfile.company_id) return json({ error: "That invite doesn't belong to your company." }, 403);
    if (invite.used_at) return json({ error: "This invite has already been used." }, 400);
    // The email typed into the invite form is just a label today, so it may
    // not match what's passed here -- only block a mismatch when the invite
    // row actually has one recorded.
    if (invite.email && invite.email.toLowerCase() !== String(email).toLowerCase()) {
      return json({ error: "That email doesn't match this invite." }, 400);
    }

    const { data: company } = await supabase.from("companies").select("name").eq("id", invite.company_id).maybeSingle();
    const companyName = company?.name || "the team";
    const joinUrl = `${DASHBOARD_BASE_URL}/setup-company.html?invite=${encodeURIComponent(token)}`;
    const roleLabel = ({ buyer: "Media Buyer", admin: "Admin", customer_care: "Customer Care", delivery_agent: "Delivery Agent" } as Record<string, string>)[invite.role] || invite.role;

    // Creates the auth user (if they don't already have one) and returns a
    // one-time link that signs them in the moment it's clicked -- no
    // separate "confirm your email" step, because generateLink never sends
    // mail itself; we're the only email they get.
    let linkResult = await supabase.auth.admin.generateLink({ type: "invite", email, options: { redirectTo: joinUrl } });
    if (linkResult.error && /already.*registered|already.*exist/i.test(linkResult.error.message || "")) {
      // They already have an account (e.g. re-inviting someone, or they
      // signed up some other way) -- a magic link signs an existing user
      // in instead of trying to create a duplicate.
      linkResult = await supabase.auth.admin.generateLink({ type: "magiclink", email, options: { redirectTo: joinUrl } });
    }
    if (linkResult.error || !linkResult.data?.properties?.action_link) {
      throw new Error(linkResult.error?.message || "Could not generate a sign-in link for this invite.");
    }
    const link = linkResult.data.properties.action_link;

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: RESEND_FROM_EMAIL,
        to: [email],
        subject: `You've been invited to join ${companyName}`,
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">
            <h2 style="margin:0 0 12px;">You're invited to join ${companyName}</h2>
            <p style="color:#444;">You've been invited as a <strong>${roleLabel}</strong>. Click below to sign in and set up your name and password.</p>
            <p style="margin:24px 0;"><a href="${link}" style="background:#1a9e75;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;">Accept invite</a></p>
            <p style="color:#888;font-size:12px;">Or paste this link into your browser: ${link}</p>
            <p style="color:#aaa;font-size:11px;">This link is one-time use and expires after a while -- if it's expired, ask whoever invited you to send a new one.</p>
          </div>
        `,
      }),
    });
    const resendData = await resendRes.json();
    if (!resendRes.ok) throw new Error(resendData?.message || "Resend rejected the email.");

    return json({ ok: true, id: resendData.id });
  } catch (err: any) {
    console.error("send-company-invite error:", err);
    return json({ error: err.message }, 500);
  }
});
