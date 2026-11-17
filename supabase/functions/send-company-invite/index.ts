import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") ?? "";
const DASHBOARD_BASE_URL = (Deno.env.get("DASHBOARD_BASE_URL") ?? "").replace(/\/+$/, "");
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey"
      }
    });
  }
  if (req.method !== "POST") return json({
    error: "POST only"
  }, 405);
  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL || !DASHBOARD_BASE_URL) {
    return json({
      error: "Email sending isn't configured yet -- RESEND_API_KEY, RESEND_FROM_EMAIL and DASHBOARD_BASE_URL need to be set as Supabase edge function secrets."
    }, 500);
  }
  try {
    const { access_token, token, email } = await req.json();
    if (!access_token || !token || !email) return json({
      error: "access_token, token and email are required"
    }, 400);
    const { data: { user }, error: authErr } = await supabase.auth.getUser(access_token);
    if (authErr || !user) return json({
      error: "Not signed in."
    }, 401);
    const { data: callerProfile } = await supabase.from("profiles").select("role, company_id").eq("id", user.id).maybeSingle();
    if (!callerProfile || ![
      "owner",
      "admin"
    ].includes(callerProfile.role)) {
      return json({
        error: "Only an owner or admin can send invites."
      }, 403);
    }
    const { data: invite } = await supabase.from("company_invites").select("id, role, email, company_id, used_at, expires_at").eq("token", token).maybeSingle();
    if (!invite) return json({
      error: "Invite not found."
    }, 404);
    if (invite.company_id !== callerProfile.company_id) return json({
      error: "That invite doesn't belong to your company."
    }, 403);
    if (invite.used_at) return json({
      error: "This invite has already been used."
    }, 400);
    if (invite.email && invite.email.toLowerCase() !== String(email).toLowerCase()) {
      return json({
        error: "That email doesn't match this invite."
      }, 400);
    }
    const { data: company } = await supabase.from("companies").select("name").eq("id", invite.company_id).maybeSingle();
    const companyName = company?.name || "the team";
    const joinUrl = `${DASHBOARD_BASE_URL}/setup-company.html?invite=${encodeURIComponent(token)}`;
    const roleLabel = {
      buyer: "Media Buyer",
      admin: "Admin",
      customer_care: "Customer Care",
      delivery_agent: "Delivery Agent"
    }[invite.role] || invite.role;
    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: RESEND_FROM_EMAIL,
        to: [
          email
        ],
        subject: `You've been invited to join ${companyName}`,
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">
            <h2 style="margin:0 0 12px;">You're invited to join ${companyName}</h2>
            <p style="color:#444;">You've been invited as a <strong>${roleLabel}</strong>. Click below to set your name and password -- you'll land straight in the dashboard.</p>
            <p style="margin:24px 0;"><a href="${joinUrl}" style="background:#1a9e75;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;">Accept invite</a></p>
            <p style="color:#888;font-size:12px;">Or paste this link into your browser: ${joinUrl}</p>
            <p style="color:#aaa;font-size:11px;">This link expires after a while -- if it's expired, ask whoever invited you to send a new one.</p>
          </div>
        `
      })
    });
    const resendData = await resendRes.json();
    if (!resendRes.ok) throw new Error(resendData?.message || "Resend rejected the email.");
    return json({
      ok: true,
      id: resendData.id
    });
  } catch (err) {
    console.error("send-company-invite error:", err);
    return json({
      error: err.message
    }, 500);
  }
});
