import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GRAPH_API_VERSION = "v22.0";
const META_ACCESS_TOKEN = Deno.env.get("META_PAGE_ACCESS_TOKEN") ?? Deno.env.get("META_ACCESS_TOKEN");
const META_PIXEL_ID = Deno.env.get("META_PIXEL_ID");
const META_PAGE_ID = Deno.env.get("META_PAGE_ID");
const VERIFY_TOKEN = Deno.env.get("META_LEAD_VERIFY_TOKEN") ?? Deno.env.get("WEBHOOK_VERIFY_TOKEN");
const CRM_NAME = Deno.env.get("META_LEAD_CRM_NAME") ?? "CloudERP CRM";
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers });
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value.trim().toLowerCase());
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizePhone(value: string) {
  return value.replace(/[\s()+-]/g, "");
}

function fieldValue(fields: Record<string, string>, ...names: string[]) {
  const key = Object.keys(fields).find((candidate) => names.includes(candidate.toLowerCase()));
  return key ? fields[key] : "";
}

function fullName(fields: Record<string, string>) {
  const explicit = fieldValue(fields, "full_name", "full name", "name");
  if (explicit) return explicit;
  return [
    fieldValue(fields, "first_name", "firstname"),
    fieldValue(fields, "last_name", "lastname"),
  ].filter(Boolean).join(" ") || null;
}

async function getLead(leadgenId: string) {
  const pageId = Deno.env.get("META_PAGE_ID");
  const pagesUrl = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/me/accounts`);
  pagesUrl.searchParams.set("fields", "id,access_token");
  pagesUrl.searchParams.set("limit", "100");
  pagesUrl.searchParams.set("access_token", META_ACCESS_TOKEN!);
  const pagesResponse = await fetch(pagesUrl);
  const pages = await pagesResponse.json();
  const page = (pages.data ?? []).find((item: any) => String(item.id) === String(pageId));
  if (!pagesResponse.ok || !page?.access_token) throw new Error(`Page access token lookup failed: ${JSON.stringify(pages)}`);

  const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${leadgenId}`);
  url.searchParams.set("fields", "id,created_time,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id");
  url.searchParams.set("access_token", page.access_token);
  const result = await fetch(url);
  const data = await result.json();
  if (!result.ok) throw new Error(`Meta lead lookup failed: ${JSON.stringify(data)}`);
  return data;
}

async function sendLeadToMeta(lead: any, fields: Record<string, string>) {
  const email = fieldValue(fields, "email", "e-mail");
  const phone = fieldValue(fields, "phone_number", "phone", "mobile_phone");
  const firstName = fieldValue(fields, "first_name", "firstname");
  const lastName = fieldValue(fields, "last_name", "lastname");
  const city = fieldValue(fields, "city", "town", "town_city");
  const state = fieldValue(fields, "state", "region", "province");
  const userData: Record<string, unknown> = { lead_id: Number(lead.id) || lead.id };

  if (email) userData.em = [await sha256(email)];
  if (phone) userData.ph = [await sha256(normalizePhone(phone))];
  if (firstName) userData.fn = [await sha256(firstName)];
  if (lastName) userData.ln = [await sha256(lastName)];
  if (city) userData.ct = [await sha256(city)];
  if (state) userData.st = [await sha256(state)];

  const payload = {
    data: [{
      event_name: "Lead",
      event_time: Math.floor(new Date(lead.created_time ?? Date.now()).getTime() / 1000),
      action_source: "system_generated",
      custom_data: { event_source: "crm", lead_event_source: CRM_NAME },
      user_data: userData,
    }],
  };

  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${META_PIXEL_ID}/events?access_token=${encodeURIComponent(META_ACCESS_TOKEN!)}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
  );
  const result = await response.json();
  if (!response.ok) throw new Error(`Meta Lead CAPI failed: ${JSON.stringify(result)}`);
  return result;
}

Deno.serve(async (request) => {
  const url = new URL(request.url);

  if (request.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === VERIFY_TOKEN && challenge) return new Response(challenge, { status: 200 });
    return new Response("Forbidden", { status: 403 });
  }

  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!META_ACCESS_TOKEN || !META_PIXEL_ID || !META_PAGE_ID || !VERIFY_TOKEN) {
    console.error("Missing Meta lead webhook secrets");
    return json({ error: "Lead webhook is not configured" }, 500);
  }

  try {
    const body = await request.json();
    if (body.object !== "page") return json({ received: true });

    for (const entry of body.entry ?? []) {
      if (String(entry.id) !== String(META_PAGE_ID)) continue;
      for (const change of entry.changes ?? []) {
        const leadgenId = change.value?.leadgen_id;
        if (!leadgenId) continue;

        const lead = await getLead(String(leadgenId));
        const eventId = `lead-${lead.id}`;
        const { data: existing } = await supabase
          .from("event_logs")
          .select("event_id")
          .eq("event_id", eventId)
          .maybeSingle();
        if (existing) continue;

        const fields = Object.fromEntries((lead.field_data ?? []).map((field: any) => [
          String(field.name).toLowerCase(), Array.isArray(field.values) ? String(field.values[0] ?? "") : "",
        ]));
        const firstName = fieldValue(fields, "first_name", "firstname");
        const lastName = fieldValue(fields, "last_name", "lastname");
        const city = fieldValue(fields, "city", "town", "town_city");
        const state = fieldValue(fields, "state", "region", "province");
        const address = fieldValue(fields, "street_address", "address", "full_address");
        const { error: leadSaveError } = await supabase.from("leads").upsert({
          lead_id: String(lead.id),
          full_name: fullName(fields),
          first_name: firstName || null,
          last_name: lastName || null,
          email: fieldValue(fields, "email", "e-mail") || null,
          phone: fieldValue(fields, "phone_number", "phone", "mobile_phone") || null,
          state: state || null,
          city: city || null,
          address: address || null,
          form_id: lead.form_id ?? null,
          form_name: CRM_NAME,
          campaign_id: lead.campaign_id ?? null,
          campaign_name: lead.campaign_name ?? null,
          adset_id: lead.adset_id ?? null,
          adset_name: lead.adset_name ?? null,
          ad_id: lead.ad_id ?? null,
          ad_name: lead.ad_name ?? null,
          raw_fields: fields,
          status: "new",
          updated_at: new Date().toISOString(),
        }, { onConflict: "lead_id" });
        if (leadSaveError) throw leadSaveError;

        const capiResponse = await sendLeadToMeta(lead, fields);

        const { error } = await supabase.from("event_logs").upsert({
          event_name: "Lead",
          event_id: eventId,
          event_source: "server",
          user_data: { lead_id: lead.id },
          custom_data: {
            event_source: "crm",
            lead_event_source: CRM_NAME,
            lead: { ...lead, field_data: undefined },
            field_names: Object.keys(fields),
          },
          sent_to_meta: true,
          meta_response: capiResponse,
          meta_event_id: eventId,
        }, { onConflict: "event_id" });
        if (error) throw error;
      }
    }

    return json({ received: true });
  } catch (error) {
    console.error("Meta lead webhook error:", error);
    return json({ error: "Lead processing failed" }, 500);
  }
});
