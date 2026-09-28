import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GRAPH_API_VERSION = "v22.0";
const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN");
const RAW_AD_ACCOUNT_ID = Deno.env.get("META_AD_ACCOUNT_ID");
const META_AD_ACCOUNT_ID = RAW_AD_ACCOUNT_ID && RAW_AD_ACCOUNT_ID.startsWith("act_")
  ? RAW_AD_ACCOUNT_ID
  : `act_${RAW_AD_ACCOUNT_ID}`;
const INSPECTOR_KEY = Deno.env.get("META_INSPECTOR_KEY");
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const headers = { "Content-Type": "application/json" };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers });
}

async function graph(path: string, params: Record<string, string> = {}) {
  const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${path}`);
  url.searchParams.set("access_token", META_ACCESS_TOKEN!);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(data));
  return data;
}

async function allPages(path: string, params: Record<string, string>) {
  const rows: unknown[] = [];
  let page = await graph(path, params);
  rows.push(...(page.data ?? []));
  while (page.paging?.next) {
    const response = await fetch(page.paging.next);
    page = await response.json();
    rows.push(...(page.data ?? []));
  }
  return rows;
}

async function graphErrorSafe(path: string, params: Record<string, string> = {}) {
  try {
    return { ok: true, data: await graph(path, params) };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

async function getPageAccessToken(pageId: string) {
  const pages = await graph("me/accounts", {
    fields: "id,name,access_token,tasks",
    limit: "100",
  });
  const page = (pages.data ?? []).find((item: any) => String(item.id) === String(pageId));
  if (!page?.access_token) throw new Error(`No Page Access Token returned for Page ${pageId}`);
  return page.access_token as string;
}

Deno.serve(async (request) => {
  if (request.method !== "GET") return json({ error: "Read-only endpoint: GET required" }, 405);
  if (!META_ACCESS_TOKEN || !META_AD_ACCOUNT_ID || !INSPECTOR_KEY) {
    return json({ error: "Inspector is not configured" }, 500);
  }
  if (request.headers.get("x-inspector-key") !== INSPECTOR_KEY) {
    return json({ error: "Unauthorized" }, 401);
  }

  try {
    const tokenIdentity = await graphErrorSafe("me", { fields: "id,name" });
    const accessiblePages = await graphErrorSafe("me/accounts", {
      fields: "id,name,tasks",
      limit: "100",
    });
    const configuredPage = await graphErrorSafe(String(Deno.env.get("META_PAGE_ID")), {
      fields: "id,name",
    });
    const pageId = Deno.env.get("META_PAGE_ID");
    let pageAccessToken = "";
    let pageTokenError = "";
    try {
      if (pageId) pageAccessToken = await getPageAccessToken(pageId);
    } catch (error) {
      pageTokenError = String(error);
    }

    const campaigns = await allPages(`${META_AD_ACCOUNT_ID}/campaigns`, {
      fields: "id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time,created_time",
      limit: "100",
    });
    const active = campaigns.filter((campaign: any) =>
      ["ACTIVE", "IN_PROCESS", "WITH_ISSUES", "PAUSED"].includes(campaign.effective_status ?? campaign.status),
    );
    const details = [];

    for (const campaign of active as any[]) {
      const adsets = await allPages(`${campaign.id}/adsets`, {
        fields: "id,name,status,effective_status,daily_budget,optimization_goal,billing_event,bid_strategy,targeting,promoted_object,placement",
        limit: "100",
      });
      const adsetDetails = [];
      for (const adset of adsets as any[]) {
        const ads = await allPages(`${adset.id}/ads`, {
          fields: "id,name,status,effective_status,creative{id,name,object_story_spec,asset_feed_spec},tracking_specs",
          limit: "100",
        });
        adsetDetails.push({ ...adset, ads });
      }
      details.push({ ...campaign, adsets: adsetDetails });
    }

    let leadForms: unknown[] = [];
    let leadFormsError = "";
    let formLeads: unknown[] = [];
    let formLeadsError = "";
    if (pageId && pageAccessToken) {
      try {
        const formUrl = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${pageId}/leadgen_forms`);
        formUrl.searchParams.set("access_token", pageAccessToken);
        formUrl.searchParams.set("fields", "id,name,status,locale,created_time");
        formUrl.searchParams.set("limit", "100");
        const formResponse = await fetch(formUrl);
        const formData = await formResponse.json();
        if (!formResponse.ok) throw new Error(JSON.stringify(formData));
        leadForms = formData.data ?? [];
        const formId = String((leadForms[0] as any)?.id ?? "");
        if (formId) {
          const leadsUrl = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${formId}/leads`);
          leadsUrl.searchParams.set("fields", "id,created_time,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,form_name");
          leadsUrl.searchParams.set("access_token", pageAccessToken);
          const leadsResponse = await fetch(leadsUrl);
          const leadsData = await leadsResponse.json();
          if (!leadsResponse.ok) throw new Error(JSON.stringify(leadsData));
          formLeads = leadsData.data ?? [];
        }
      } catch (error) {
        formLeadsError = String(error);
        if (!leadForms.length) leadFormsError = formLeadsError;
      }
    } else if (pageTokenError) {
      leadFormsError = pageTokenError;
    }

    const { data: recentLeadEvents, error: leadEventsError } = await supabase
      .from("event_logs")
      .select("event_id,event_name,event_source,sent_to_meta,created_at,custom_data,meta_response")
      .eq("event_name", "Lead")
      .order("created_at", { ascending: false })
      .limit(20);

    return json({
      account_id: META_AD_ACCOUNT_ID,
      token_identity: tokenIdentity,
      accessible_pages: accessiblePages,
      configured_page: configuredPage,
      page_token_resolved: Boolean(pageAccessToken),
      lead_forms: leadForms,
      lead_forms_error: leadFormsError || undefined,
      form_leads: formLeads,
      form_leads_error: formLeadsError || undefined,
      recent_lead_events: recentLeadEvents ?? [],
      recent_lead_events_error: leadEventsError?.message,
      all_campaigns: campaigns,
      active_campaigns: details,
    });
  } catch (error) {
    console.error("Meta campaign inspector error:", error);
    return json({ error: "Meta campaign query failed", detail: String(error) }, 502);
  }
});
