import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Emails a teammate their invite link via Resend, instead of an admin
// manually copy-pasting it out of the dashboard. Called right after the
// dashboard inserts a company_invites row:
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
// Where the invite link points -- e.g. https://yourdomain.com/index.html
const DASHBOARD_LOGIN_URL = Deno.env.get("DASHBOARD_LOGIN_URL") ?? "";

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

  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL || !DASHBOARD_LOGIN_URL) {
    return json({ error: "Email sending isn't configured yet -- RESEND_API_KEY, RESEND_FROM_EMAIL and DASHBOARD_LOGIN_URL need to be set as Supabase edge function secrets." }, 500);
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
    const link = `${DASHBOARD_LOGIN_URL}?invite=${token}`;
    const roleLabel = ({ buyer: "Media Buyer", admin: "Admin", customer_care: "Customer Care", delivery_agent: "Delivery Agent" } as Record<string, string>)[invite.role] || invite.role;

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
            <p style="color:#444;">You've been invited as a <strong>${roleLabel}</strong>. Click below to set up your account and password.</p>
            <p style="margin:24px 0;"><a href="${link}" style="background:#1a9e75;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;">Set up your account</a></p>
            <p style="color:#888;font-size:12px;">Or paste this link into your browser: ${link}</p>
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
