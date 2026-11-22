import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
// Internal (staff-facing) email alerts via Resend, for the non-urgent half
// of the funding-request lifecycle -- "submitted" and "decided" -- that
// doesn't need to interrupt someone's phone the way send-internal-whatsapp's
// low-balance/payment-confirmed/transfer-result alerts do. Recipients are
// looked up by auth email (supabase.auth.admin.getUserById), not a
// separately-stored address, so there's nothing to keep in sync.
//
//   POST { type: "fund_request_submitted" | "fund_request_decided", fund_request_id }
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
// Must be on a domain verified in Resend -- resend.com/domains. Defaults to
// their sandbox sender, which only delivers to the Resend account owner's
// own inbox; override via secret once a real domain is verified.
const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") ?? "alerts@onresend.com";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const fmt = (n)=>new Intl.NumberFormat("en-NG").format(Number(n ?? 0));
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
async function sendEmail(to, subject, html) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: RESEND_FROM_EMAIL,
      to,
      subject,
      html
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || `Resend send failed (${res.status})`);
  return data;
}

// Branded shell shared by report and alert emails (same look as the sign-in emails).
const LOGO = "https://revoracrm.online/images/brands/revora-logo-64.png";
const esc = (v)=>String(v ?? "").replace(/[&<>"']/g, (c)=>({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function brandedHtml(title, lines, cta) {
  const P = "font-size:15px;line-height:1.6;color:#55524a;margin:0 0 10px 0;";
  const body = (lines ?? []).map((l)=>`<p style="${P}">${esc(l)}</p>`).join("");
  const btn = cta?.url ? `<p style="margin:22px 0 6px 0;"><a href="${esc(cta.url)}" style="display:inline-block;background:#1877F2;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 26px;border-radius:99px;">${esc(cta.label || "Open Revora")}</a></p>` : "";
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f5f5f2;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f2;padding:28px 12px;"><tr><td align="center"><table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background:#ffffff;border:1px solid #e7e3da;border-radius:18px;"><tr><td style="padding:26px 30px 6px 30px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;"><img src="${LOGO}" width="30" height="30" alt="" style="vertical-align:middle;border-radius:8px;border:0;"> <span style="font-size:19px;font-weight:700;color:#14130f;vertical-align:middle;margin-left:6px;">Revora</span></td></tr><tr><td style="padding:14px 30px 28px 30px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#14130f;"><h1 style="font-size:22px;line-height:1.25;margin:10px 0 12px 0;">${esc(title)}</h1>${body}${btn}</td></tr></table><table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;"><tr><td style="padding:16px 30px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#8c887c;text-align:center;">Sent by Revora. You can turn these emails off in Settings.<br>revoracrm.online</td></tr></table></td></tr></table></body></html>`;
}

// New-device sign-in alert helpers (used by type "login_alert").
function describeUa(ua) {
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "a browser";
  const os = /Windows/.test(ua) ? "Windows" : /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "a device";
  return { browser, os, label: `${browser} on ${os}` };
}
async function shaShort(str) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(b)].map((x)=>x.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
async function adminEmails(companyId) {
  const { data: profiles } = await supabase.from("profiles").select("id").eq("company_id", companyId).in("role", [
    "owner",
    "admin"
  ]);
  const emails = [];
  for (const p of profiles ?? []){
    const { data } = await supabase.auth.admin.getUserById(p.id);
    if (data?.user?.email) emails.push(data.user.email);
  }
  return emails;
}
async function buyerEmail(mediaBuyerId) {
  const { data: profile } = await supabase.from("profiles").select("id").eq("media_buyer_id", mediaBuyerId).eq("role", "buyer").maybeSingle();
  if (!profile) return null;
  const { data } = await supabase.auth.admin.getUserById(profile.id);
  return data?.user?.email ?? null;
}
async function sendToMany(emails, subject, html) {
  const results = {};
  for (const email of emails){
    try {
      await sendEmail(email, subject, html);
      results[email] = "sent";
    } catch (err) {
      results[email] = `error: ${err.message}`;
    }
  }
  return results;
}
const SVC_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
async function getCaller(req, admin) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  if (SVC_KEY && token === SVC_KEY) return {
    service: true,
    company_id: null,
    role: null
  };
  const { data } = await admin.auth.getUser(token);
  if (data?.user) {
    const { data: p } = await admin.from("profiles").select("company_id, role").eq("id", data.user.id).maybeSingle();
    return p?.company_id ? {
      service: false,
      company_id: p.company_id,
      role: p.role
    } : null;
  }
  try {
    const r = await fetch(`${Deno.env.get("SUPABASE_URL") ?? ""}/auth/v1/admin/users?per_page=1`, {
      headers: {
        apikey: token,
        Authorization: `Bearer ${token}`
      }
    });
    if (r.status === 200) return {
      service: true,
      company_id: null,
      role: null
    };
  } catch  {}
  return null;
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
  if (!RESEND_API_KEY) return json({
    error: "RESEND_API_KEY isn't configured yet."
  }, 500);
  try {
    if (!await getCaller(req, supabase)) return json({
      error: "Not signed in"
    }, 401);
    const reqBody = await req.json();
    const { type, fund_request_id } = reqBody;
    // The login page calls this right after a successful sign-in with the person's own session. First device is recorded quietly;
    // a later unrecognised device (browser + system + country) gets one "New sign-in" email.
    if (type === "login_alert") {
      const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
      const { data: u } = await supabase.auth.getUser(token);
      if (!u?.user) return json({ error: "Not signed in" }, 401);
      const ua = req.headers.get("user-agent") ?? "";
      const country = (req.headers.get("cf-ipcountry") ?? req.headers.get("x-vercel-ip-country") ?? "").toUpperCase().slice(0, 2) || null;
      const dv = describeUa(ua);
      const fp = await shaShort(`${dv.browser}|${dv.os}|${country ?? ""}`);
      const { count } = await supabase.from("login_devices").select("id", { count: "exact", head: true }).eq("user_id", u.user.id);
      const { data: known } = await supabase.from("login_devices").select("id").eq("user_id", u.user.id).eq("fingerprint", fp).maybeSingle();
      if (known) { await supabase.from("login_devices").update({ last_seen: new Date().toISOString() }).eq("id", known.id); return json({ ok: true, new_device: false, alerted: false }); }
      const seenBefore = (count ?? 0) > 0;
      await supabase.from("login_devices").insert({ user_id: u.user.id, fingerprint: fp, device: dv.label, country, alerted_at: seenBefore ? new Date().toISOString() : null });
      if (!seenBefore) return json({ ok: true, new_device: true, alerted: false });
      const { data: pr } = await supabase.from("profiles").select("login_alerts").eq("id", u.user.id).maybeSingle();
      if (pr?.login_alerts === false || !u.user.email) return json({ ok: true, new_device: true, alerted: false });
      const when = new Date().toLocaleString("en-GB", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" });
      const html = brandedHtml("New sign-in to your account", [`Device: ${dv.label}`, `Country: ${country ?? "unknown"}`, `Time: ${when} (Lagos)`, "If this was you, you don't need to do anything.", "If it wasn't you, reset your password now so nobody else can get in."], { url: "https://dash.revoracrm.online/login", label: "Secure my account" });
      await sendEmail(u.user.email, "New sign-in to your Revora account", html);
      return json({ ok: true, new_device: true, alerted: true });
    }
    // Report and alert emails, sent by our own jobs only (service key). Recipient = one person, or the owners/admins of a company.
    if (type === "user_email") {
      const caller = await getCaller(req, supabase);
      if (!caller?.service) return json({ error: "Not allowed" }, 403);
      const pref = reqBody.pref === "login_alerts" ? "login_alerts" : "email_reports";
      let ids = [];
      if (reqBody.user_id) ids = [String(reqBody.user_id)];
      else if (reqBody.company_admins) {
        const { data: ps } = await supabase.from("profiles").select("id").eq("company_id", String(reqBody.company_admins)).in("role", ["owner", "admin"]);
        ids = (ps ?? []).map((x)=>x.id);
      }
      const { data: prefs } = ids.length ? await supabase.from("profiles").select(`id, role, ${pref}`).in("id", ids) : { data: [] };
      const okIds = (prefs ?? []).filter((x)=>x[pref] !== false && (!reqBody.only_role || x.role === reqBody.only_role)).map((x)=>x.id);
      const emails = [];
      for (const id of okIds) { const { data } = await supabase.auth.admin.getUserById(id); if (data?.user?.email) emails.push(data.user.email); }
      const html = brandedHtml(String(reqBody.title ?? "Revora"), Array.isArray(reqBody.lines) ? reqBody.lines : [], reqBody.cta_url ? { url: reqBody.cta_url, label: reqBody.cta_label } : null);
      return json({ ok: true, results: await sendToMany(emails, String(reqBody.subject ?? reqBody.title ?? "Revora"), html) });
    }
    if (type === "fund_request_submitted") {
      const { data: fr } = await supabase.from("fund_requests").select("id, amount_naira, note, company_id, media_buyers(name)").eq("id", fund_request_id).maybeSingle();
      if (!fr) return json({
        error: "Funding request not found"
      }, 404);
      const emails = await adminEmails(fr.company_id);
      const buyerName = fr.media_buyers?.name || "A buyer";
      const results = await sendToMany(emails, `Funding request: NGN ${fmt(fr.amount_naira)} from ${buyerName}`, `<p><strong>${buyerName}</strong> requested <strong>NGN ${fmt(fr.amount_naira)}</strong> in funding.</p><p>Note: ${fr.note ? fr.note : "(none)"}</p><p>Approve or decline it from the Wallet tab.</p>`);
      return json({
        ok: true,
        results
      });
    }
    if (type === "fund_request_decided") {
      const { data: fr } = await supabase.from("fund_requests").select("id, amount_naira, status, media_buyer_id").eq("id", fund_request_id).maybeSingle();
      if (!fr) return json({
        error: "Funding request not found"
      }, 404);
      const email = fr.media_buyer_id ? await buyerEmail(fr.media_buyer_id) : null;
      if (!email) return json({
        ok: true,
        results: {}
      });
      const results = await sendToMany([
        email
      ], `Your funding request was ${fr.status}`, `<p>Your funding request for <strong>NGN ${fmt(fr.amount_naira)}</strong> was <strong>${fr.status}</strong>.</p>${fr.status === "approved" ? `<p>You can now send it from the Wallet tab.</p>` : ""}`);
      return json({
        ok: true,
        results
      });
    }
    return json({
      error: `Unknown type: ${type}`
    }, 400);
  } catch (err) {
    console.error("send-internal-email error:", err);
    return json({
      error: err.message
    }, 500);
  }
});
