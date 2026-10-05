import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

// Web Push (PWA notifications) for staff, served from the WhatsApp webhook
// function because the project is at its edge-function limit. Nothing here
// touches the webhook logic: handle() only claims a request if it is
//
//   GET  ?action=public_key                 -> { publicKey }   (the browser needs it to subscribe)
//   POST { type: "test" }  + a USER token   -> pushes a test to that user's own devices
//   POST { audience, category, notification } + the SERVICE-ROLE key (other server code):
//        audience:     { company_id, roles?: string[], user_ids?: string[], media_buyer_id? }
//        category:     "messages" | ... (a device that switched that category off is skipped)
//        notification: { title, body, url, tag?, badgeCount? }
//
// and returns null for everything else (Meta's webhook calls), which carry on as before.
//
// The VAPID signing key pair is generated here on first use and kept in
// app_secrets (service role only), so no secret ever has to be pasted anywhere.

const VAPID_SUBJECT = "https://metaautomationads.vercel.app";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

type Subscription = { id: string; endpoint: string; p256dh: string; auth: string; prefs: Record<string, boolean> | null };
export type Audience = { company_id?: string; roles?: string[]; user_ids?: string[]; media_buyer_id?: string | null };
export type Notification = { title: string; body?: string; url?: string; tag?: string; badgeCount?: number };

// `admin` is a service-role Supabase client; `sender` is web-push (injectable for tests).
export function createPush(admin: any, serviceKey: string, sender: any = webpush) {
  async function getVapid(): Promise<{ publicKey: string; privateKey: string }> {
    const read = async () => {
      const { data } = await admin.from("app_secrets").select("key, value").in("key", ["vapid_public", "vapid_private"]);
      const m = Object.fromEntries((data ?? []).map((r: any) => [r.key, r.value]));
      return m.vapid_public && m.vapid_private ? { publicKey: m.vapid_public, privateKey: m.vapid_private } : null;
    };
    const existing = await read();
    if (existing) return existing;

    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    const pub = new Uint8Array(65);
    pub[0] = 4;
    pub.set(fromB64url(jwk.x!), 1);
    pub.set(fromB64url(jwk.y!), 33);
    // ignoreDuplicates: if two requests race on first use, the first key pair wins for both.
    await admin.from("app_secrets").upsert(
      [{ key: "vapid_public", value: b64url(pub) }, { key: "vapid_private", value: jwk.d! }],
      { onConflict: "key", ignoreDuplicates: true },
    );
    const stored = await read();
    if (!stored) throw new Error("could not store VAPID keys");
    return stored;
  }

  async function sendToSubscriptions(subs: Subscription[], payload: Record<string, unknown>) {
    const vapid = await getVapid();
    const body = JSON.stringify(payload);
    let sent = 0, failed = 0;
    const dead: string[] = [];
    await Promise.all(subs.map(async (s) => {
      try {
        await sender.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
          { vapidDetails: { subject: VAPID_SUBJECT, publicKey: vapid.publicKey, privateKey: vapid.privateKey }, TTL: 60 * 60 * 24, urgency: "high" },
        );
        sent++;
      } catch (err: any) {
        failed++;
        // 404/410 = the user uninstalled / revoked permission: drop the dead subscription.
        if (err?.statusCode === 404 || err?.statusCode === 410) dead.push(s.id);
        else console.error("push failed:", err?.statusCode, err?.body ?? err?.message);
      }
    }));
    if (dead.length) await admin.from("push_subscriptions").delete().in("id", dead);
    return { sent, failed, removed: dead.length };
  }

  async function resolveUserIds(a: Audience): Promise<string[]> {
    const ids = new Set<string>(a.user_ids ?? []);
    if (a.company_id) {
      if (a.roles?.length) {
        const { data } = await admin.from("profiles").select("id").eq("company_id", a.company_id).in("role", a.roles);
        (data ?? []).forEach((p: any) => ids.add(p.id));
      }
      if (a.media_buyer_id) {
        const { data } = await admin.from("profiles").select("id").eq("company_id", a.company_id).eq("media_buyer_id", a.media_buyer_id);
        (data ?? []).forEach((p: any) => ids.add(p.id));
      }
    }
    return [...ids];
  }

  async function toAudience(audience: Audience, category: string | undefined, n: Notification) {
    const userIds = await resolveUserIds(audience);
    if (!userIds.length) return { sent: 0, failed: 0, removed: 0, note: "no recipients" };
    const { data: subs } = await admin.from("push_subscriptions").select("id, endpoint, p256dh, auth, prefs").in("user_id", userIds);
    const wanted = (subs ?? []).filter((s: any) => !category || s.prefs?.[category] !== false);
    if (!wanted.length) return { sent: 0, failed: 0, removed: 0, note: "no subscribed devices" };
    return sendToSubscriptions(wanted as Subscription[], {
      title: String(n.title).slice(0, 80),
      body: String(n.body ?? "").slice(0, 160),
      url: n.url || "/dashboard_new.html",
      tag: n.tag,
      badgeCount: n.badgeCount,
      timestamp: Date.now(),
    });
  }

  // Returns a Response if this request is a push request, otherwise null.
  async function handle(req: Request): Promise<Response | null> {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

    if (req.method === "GET") {
      if (url.searchParams.get("action") !== "public_key") return null;
      try { return json({ publicKey: (await getVapid()).publicKey }); }
      catch (err: any) { console.error("public_key error:", err); return json({ error: err?.message ?? "error" }, 500); }
    }
    if (req.method !== "POST") return null;

    // Peek at the body without consuming it (Meta's webhook handler reads it next).
    const body = await req.clone().json().catch(() => null);
    if (!body || typeof body !== "object" || !(body.type === "test" || body.audience)) return null;

    try {
      const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
      const isService = token.length > 0 && token === serviceKey;

      // A signed-in user may only ask for a test push to their own devices.
      if (!isService) {
        const { data: u } = await admin.auth.getUser(token);
        if (!u?.user) return json({ error: "unauthorized" }, 401);
        if (body.type !== "test") return json({ error: "forbidden" }, 403);
        const { data: subs } = await admin.from("push_subscriptions").select("id, endpoint, p256dh, auth, prefs").eq("user_id", u.user.id);
        if (!subs?.length) return json({ error: "No device is subscribed. Turn notifications on first." }, 400);
        return json(await sendToSubscriptions(subs as Subscription[], {
          title: "Notifications are on ✅",
          body: "You'll get alerts for new messages and activity here.",
          url: "/dashboard_new.html",
          tag: "test",
          timestamp: Date.now(),
        }));
      }

      if (!body.audience || !body.notification?.title) return json({ error: "audience and notification.title are required" }, 400);
      return json(await toAudience(body.audience, body.category, body.notification));
    } catch (err: any) {
      console.error("push error:", err);
      return json({ error: err?.message ?? "error" }, 500);
    }
  }

  return { handle, toAudience, getVapid };
}

export function createPushFromEnv() {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return createPush(createClient(url, key), key);
}
