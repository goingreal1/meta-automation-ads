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
    const reqBody = await req.json();
    const { type, fund_request_id } = reqBody;
    // Sign-in lockdown. The login page never gets a session from the password alone:
    //   login_start  {email, password}       -> checks the password, emails a 6-digit code
    //   login_verify {email, password, code} -> checks the code, then leaves a one-time pass that the database sign-in gate needs
    //   check_password {password} (signed in) -> re-checks the person's own password for sensitive actions
    // The Supabase sign-in gate (rv_access_token_hook) refuses every password sign-in that has no pass, so knowing the password is not enough.
    if (type === "login_start" || type === "login_verify" || type === "check_password") {
      const email = String(reqBody.email ?? "").trim().toLowerCase();
      let ownerId = null;
      if (type === "check_password") {
        const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
        const { data: me } = await supabase.auth.getUser(token);
        if (!me?.user?.email) return json({ ok: false, error: "Not signed in" }, 401);
        ownerId = me.user.id;
        reqBody.email = me.user.email;
      }
      const pw = String(reqBody.password ?? "");
      const em = type === "check_password" ? String(reqBody.email).toLowerCase() : email;
      if (!em || !pw) return json({ ok: false, error: "Enter your email and password." }, 400);
      const { data: chk } = await supabase.rpc("rv_login_check", { p_email: em, p_password: pw });
      if (chk?.status === "locked") return json({ ok: false, error: "Too many tries. Wait 15 minutes, then try again." }, 429);
      if (chk?.status !== "ok") return json({ ok: false, error: "Wrong email or password." }, 401);
      const uid = chk.user_id;
      if (type === "check_password") return json({ ok: uid === ownerId });
      const pepper = SVC_KEY.slice(-12);
      const hashOf = (code)=>shaShort(`${code}|${uid}|${pepper}`);
      if (type === "login_verify") {
        const { data: row } = await supabase.from("login_codes").select("*").eq("user_id", uid).maybeSingle();
        if (!row || new Date(row.expires_at).getTime() < Date.now()) return json({ ok: false, error: "That code has expired. Send a new one." }, 400);
        if ((row.attempts ?? 0) >= 5) { await supabase.from("login_codes").delete().eq("user_id", uid); return json({ ok: false, error: "Too many wrong tries. Send a new code." }, 429); }
        const good = (await hashOf(String(reqBody.code ?? "").replace(/\D/g, ""))) === row.code_hash;
        if (!good) { await supabase.from("login_codes").update({ attempts: (row.attempts ?? 0) + 1 }).eq("user_id", uid); return json({ ok: false, error: "That code isn't right." }, 400); }
        await supabase.from("login_codes").delete().eq("user_id", uid);
        await supabase.from("login_grants").insert({ user_id: uid, expires_at: new Date(Date.now() + 90000).toISOString() });
        return json({ ok: true });
      }
      // login_start
      const { data: prev } = await supabase.from("login_codes").select("created_at").eq("user_id", uid).maybeSingle();
      if (prev && Date.now() - new Date(prev.created_at).getTime() < 20000) return json({ ok: true, sent: false, wait: true });
      const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
      await supabase.from("login_codes").upsert({ user_id: uid, code_hash: await hashOf(code), expires_at: new Date(Date.now() + 10 * 60000).toISOString(), attempts: 0, created_at: new Date().toISOString() });
      const ua = req.headers.get("user-agent") ?? "";
      const country = (req.headers.get("cf-ipcountry") ?? req.headers.get("x-vercel-ip-country") ?? "").toUpperCase().slice(0, 2) || null;
      const dv = describeUa(ua);
      const fp = await shaShort(`${dv.browser}|${dv.os}|${country ?? ""}`);
      const { count } = await supabase.from("login_devices").select("id", { count: "exact", head: true }).eq("user_id", uid);
      const { data: known } = await supabase.from("login_devices").select("id").eq("user_id", uid).eq("fingerprint", fp).maybeSingle();
      if (known) await supabase.from("login_devices").update({ last_seen: new Date().toISOString() }).eq("id", known.id);
      else await supabase.from("login_devices").insert({ user_id: uid, fingerprint: fp, device: dv.label, country, alerted_at: (count ?? 0) > 0 ? new Date().toISOString() : null });
      const isNew = !known && (count ?? 0) > 0;
      const when = new Date().toLocaleString("en-GB", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" });
      const html = brandedHtml(`Your sign-in code: ${code}`, ["Enter this code to finish signing in. It works once and expires in 10 minutes.", `Device: ${dv.label}${isNew ? " (new to this account)" : ""}`, `Country: ${country ?? "unknown"}`, `Time: ${when} (Lagos)`, "If this wasn't you, someone has your password. Don't share the code, and reset your password now."], { url: "https://dash.revoracrm.online/login", label: "Secure my account" });
      try { await sendEmail(em, `${code} is your Revora sign-in code`, html); }
      catch (e) { console.error("login code email failed:", e); return json({ ok: false, error: "We couldn't send the code. Try again in a minute." }, 502); }
      return json({ ok: true, sent: true, new_device: isNew });
    }
    if (!await getCaller(req, supabase)) return json({
      error: "Not signed in"
    }, 401);
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
