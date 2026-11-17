import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
// Revora MCP tool group: PLAN BUILDER + AD READER/EDITOR.
//
// 1. ADS PER AD SET (overrides of plan_campaign and update_plan from mcp-ads): an ad set can run its OWN ads.
//    Saved on the plan as ai_plans.plan.adsets[n].ad_numbers; ai-auto-launch-tests creates only the chosen ads in each ad set.
//    Identical ads (same creative + same copy) in the ads list are removed.
// 2. DRAFTS: list_plans, get_plan, add_ad_set, and update_plan can also rewrite copy (copies_edit), add a copy (copies_add) and add a creative (asset_ids_add).
// 3. LIVE ADS: get_ads and edit_ad.
// 4. get_playbook: mcp-ads' playbook plus a short addendum that teaches the assistant these tools.
// 5. ONE DRAFT PER JOB: plan_campaign refuses a second draft for the same product within 24 hours unless new_plan is true.
// 6. SPECIAL AD CATEGORY: plan_campaign and update_plan take special_ad_category; ai-auto-launch-tests sends it to Meta.
// 7. CURRENCY AND COUNTRIES: budgets are counted in the AD ACCOUNT's currency (not always naira). The plan records its currency
//    (ai_plans.plan.currency) and the launcher refuses a plan whose currency does not match the account. Each ad set can name its own
//    countries (plan.adsets[n].countries) and city radius in km or miles. search_locations finds city and state keys in any country.
//    The naira floor inside ai-chat (1500) is only a placeholder for non-naira accounts: the real budget is written onto the plan right after.
//
// The mcp router lists this group BEFORE mcp-ads, so the overrides win. Like the other groups it answers
// { action: "list" } and { action: "call", tool, args, ctx } and only accepts the internal key.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SHARED_META_TOKEN = Deno.env.get("META_ACCESS_TOKEN") ?? "";
const admin = createClient(SUPABASE_URL, SERVICE_KEY);
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-internal-key"
};
const jres = (obj, status = 200)=>new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS
    }
  });
const safeEqKey = (a, b)=>{
  if (!b || a.length !== b.length) return false;
  let d = 0;
  for(let i = 0; i < a.length; i++)d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};
const MAX_ADS = 12; // the most different ads (creative + copy) one plan can hold, and the most ads one ad set can run
const MAX_ADSETS = 6;
const MAX_COPIES = 8;
const SPECIAL_CATS = [
  "NONE",
  "HOUSING",
  "EMPLOYMENT",
  "FINANCIAL_PRODUCTS_SERVICES"
];
const CAT_DESC = "Meta special ad category. HOUSING for apartment/house rentals or sales, real estate, mortgages. EMPLOYMENT for job vacancies and hiring. FINANCIAL_PRODUCTS_SERVICES for loans, credit and similar. NONE for everything else. Leave out to use the product's default. These categories force a wider audience: age 18-65, all genders, no interest targeting, city radius of at least 25 km (16 miles). Tell the person their audience was widened.";
const DRAFT_GUARD_HOURS = 24;
const GRAPH = "https://graph.facebook.com/v21.0";
const OVERRIDES = new Set([
  "plan_campaign",
  "update_plan",
  "get_playbook"
]);
const UUID = /^[0-9a-f-]{36}$/i;
const PLACEMENT_KEYS = [
  "fb_feed",
  "fb_reels",
  "fb_stories",
  "fb_marketplace",
  "fb_search",
  "fb_profile",
  "ig_feed",
  "ig_reels",
  "ig_stories",
  "ig_explore",
  "ig_profile",
  "threads",
  "wa_status",
  "an"
];
// CURRENCY. Only currencies whose Meta minor unit is 100 are verified (the launcher multiplies budgets by 100).
const CURRENCIES = [
  "NGN",
  "USD",
  "EUR",
  "GBP",
  "CAD",
  "AUD",
  "NZD",
  "ZAR",
  "GHS",
  "KES",
  "AED",
  "INR",
  "SGD",
  "CHF"
];
const SYM = {
  NGN: "\u20a6",
  USD: "$",
  EUR: "\u20ac",
  GBP: "\u00a3",
  CAD: "CA$",
  AUD: "A$",
  NZD: "NZ$",
  ZAR: "R",
  GHS: "GH\u20b5",
  KES: "KSh ",
  AED: "AED ",
  INR: "\u20b9",
  SGD: "S$",
  CHF: "CHF "
};
const money = (cur, n)=>`${SYM[cur] ?? cur + " "}${Number(n).toLocaleString("en-US")}`;
const NAIRA_FLOOR = 1500; // ai-chat refuses less than this: used only as a placeholder for non-naira accounts
const MAX_FOREIGN_BUDGET = 10000; // daily budget cap per ad set for non-naira accounts, a guard against typos
const BUDGET_DESC = "Daily budget of THIS ad set in the AD ACCOUNT's own currency (for a US dollar account 2 means $2; for a naira account 1500 means \u20a61,500). Always pass budget_currency too.";
const BUDGET_CURRENCY_DESC = "The 3-letter currency the person stated the budget in, for example USD or NGN. Required whenever a budget is passed. It must match the ad account's currency or nothing is saved.";
const COUNTRIES_DESC = "Optional. Two-letter country codes this ad set targets, for example [US] or [GH]. Without it the ad set targets Nigeria. States and cities are looked up inside the chosen country, so give exactly ONE country when you also pass states or cities.";
const CITIES_DESC = "Optional. Cities from search_locations (kind city): each {key, name, region, radius, distance_unit}. distance_unit is kilometer or mile. Radius 10-80 km or 6-50 miles, default 17 km.";
const CITY_ITEM = {
  type: "object",
  properties: {
    key: {
      type: "string"
    },
    name: {
      type: "string"
    },
    region: {
      type: "string"
    },
    radius: {
      type: "number"
    },
    distance_unit: {
      type: "string",
      enum: [
        "kilometer",
        "mile"
      ]
    }
  }
};
const toPair = (x)=>({
    asset_id: String(x?.asset_id ?? "").trim(),
    copy_index: Math.round(Number(x?.copy_index) || 0)
  });
const validId = (id)=>UUID.test(id) || /^product:[0-9a-f-]{36}:(photo|ad)$/i.test(id);
const cleanSets = (sets)=>sets.map((s)=>{
    if (!s || typeof s !== "object") return s;
    const { ads: _ads, ...rest } = s;
    return rest;
  });
const trunc = (v, n)=>String(v ?? "").trim().slice(0, n);
const clamp = (n, lo, hi)=>Math.min(Math.max(n, lo), hi);
const canWrite = (c)=>[
    "owner",
    "admin",
    "buyer"
  ].includes(c?.role);
const isAdmin = (c)=>c?.role === "owner" || c?.role === "admin";
const has = (v)=>v !== undefined && v !== null;
const normCountries = (raw)=>[
    ...new Set((Array.isArray(raw) ? raw : []).map((x)=>String(x).trim().toUpperCase()).filter((x)=>/^[A-Z]{2}$/.test(x)))
  ].slice(0, 10);
const normCities = (raw)=>(Array.isArray(raw) ? raw : []).filter((x)=>/^\d+$/.test(String(x?.key))).map((x)=>{
    const mile = /^mi/i.test(String(x?.distance_unit ?? x?.unit ?? ""));
    const r = Number(x?.radius);
    return {
      key: String(x.key),
      name: String(x.name || ""),
      region: String(x.region || ""),
      radius: mile ? clamp(Math.round(r) || 10, 6, 50) : clamp(Math.round(r) || 17, 10, 80),
      distance_unit: mile ? "mile" : "kilometer"
    };
  }).slice(0, 10);
// The person's budget must be in the currency the account bills in. Returns an answer to hand back, or null when all is fine.
function currencyMismatch(given, actual, what) {
  const g = String(given ?? "").trim().toUpperCase();
  if (!g) {
    return actual === "NGN" ? null : {
      needs_info: true,
      message: `This ${what} bills in ${actual}, so budgets are counted in ${actual}. Nothing was saved. Ask the person for the daily budget in ${actual} (or convert it and say so), then call again with budget_currency ${actual}.`
    };
  }
  if (g !== actual) return {
    needs_info: true,
    message: `The budget was given in ${g} but this ${what} bills in ${actual}. Nothing was saved. Ask the person for the budget in ${actual}, then call again with budget_currency ${actual}.`
  };
  return null;
}
function dedupe(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const pairs = [];
  for (const x of list){
    const p = toPair(x);
    const k = `${p.asset_id}|${p.copy_index}`;
    if (!seen.has(k)) {
      seen.add(k);
      pairs.push(p);
    }
  }
  return {
    pairs,
    removed: list.length - pairs.length
  };
}
function noteDuplicates(out, n) {
  if (!n || !out || typeof out !== "object" || out.error || out.needs_info) return out;
  const msg = `${n} duplicate ad${n === 1 ? "" : "s"} (same creative and same copy) ${n === 1 ? "was" : "were"} removed, so the plan has no identical ads. Tell the person.`;
  return {
    ...out,
    duplicates_removed: n,
    next: (out.next ? out.next + " " : "") + msg
  };
}
// ── calls into mcp-ads ──
async function adsGroup(payload) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/mcp-ads`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-key": SERVICE_KEY
    },
    body: JSON.stringify(payload)
  });
  const t = await r.text();
  try {
    return JSON.parse(t);
  } catch  {
    throw new Error(`mcp-ads answered ${r.status}`);
  }
}
async function viaAds(tool, args, ctx) {
  const j = await adsGroup({
    action: "call",
    tool,
    args,
    ctx
  });
  return j?.out ?? {
    error: j?.error ?? "The tool did not answer."
  };
}
// ── tool definitions ──
const str = (d)=>({
    type: "string",
    description: d
  });
const OBJ = (properties, required = [])=>({
    type: "object",
    properties,
    required,
    additionalProperties: false
  });
const adsList = (what)=>({
    type: "array",
    description: what,
    items: {
      type: "object",
      properties: {
        asset_id: {
          type: "string",
          description: "Creative id from list_ad_creatives"
        },
        copy_index: {
          type: "number",
          description: "Which copy version, starting at 0"
        }
      },
      required: [
        "asset_id",
        "copy_index"
      ]
    }
  });
const CURRENCY_NOTE = " CURRENCY AND COUNTRY: budgets are in the AD ACCOUNT's own currency, not always naira. Pass budget_currency (for example USD) every time you pass a budget, and say budgets back with their currency symbol. Ad sets target Nigeria unless you pass countries (for example [US]); when you pass states or cities give exactly ONE country, and find city keys with search_locations. US states can be given by name or two-letter code.";
const PLAN_NOTE = " STRUCTURE: the default is 1 campaign, 1 ad set, 1 ad. Pass exactly ONE ad per ad set unless the person asked for more, and never list the same creative and copy twice (repeats are removed). ADS PER AD SET: by default every ad set runs the same ads (the top-level ads list). To give an ad set its OWN ads (for example ONE ad per ad set), put ads inside that ad set in adsets: ads=[{asset_id, copy_index}]. An ad set without its own ads list uses the top-level ads list, so pass one in that case. Use exactly what the person asked for and tell them how many ads each ad set gets. Up to 12 ads per ad set, and at most 12 different ads (creative + copy) in the whole plan. CHANGING A DRAFT: if the person already has an open draft and asks for ANY change (name, budget, audience, placements, ads, copy, creatives, start or end time), never plan again: call list_plans, then get_plan, then update_plan on the SAME plan_id (add_ad_set to add an ad set). A second plan_campaign for the same product within 24 hours is refused; pass new_plan true ONLY when the person asks for a separate, extra campaign." + CURRENCY_NOTE;
const UPDATE_NOTE = " ADS PER AD SET: to change which ads one ad set runs (for example cut 4 ads down to 1 per ad set), put ads=[{asset_id, copy_index}] inside that ad set in adsets (same order as the plan). It REPLACES that ad set's ads. COPY AND CREATIVES OF A DRAFT: copies_edit rewrites the text, headline or description of an existing copy version; copies_add adds a new copy version (use its index in ads afterwards); asset_ids_add adds a creative (from list_ad_creatives, same product) to the plan. To add an ad set use add_ad_set. Read the draft first with get_plan, change only what the person asked for, and say back how many ads each ad set now has. The start_time and end_time of a draft can be changed here too: edit the SAME plan, do not plan again. Only a different product, destination or objective needs a new plan: cancel_plan the old draft first, then plan_campaign." + CURRENCY_NOTE;
const NEW_PLAN_DESC = "Leave out. True ONLY when the person explicitly asked for a separate, extra campaign even though they already have an open draft for this product. To change an existing draft use update_plan instead.";
function patchDef(t) {
  if (t?.name === "get_playbook") return {
    ...t,
    description: String(t?.description ?? "") + " It also explains how to read and edit drafts and live ads."
  };
  const schema = JSON.parse(JSON.stringify(t?.inputSchema ?? {}));
  const isPlan = t?.name === "plan_campaign";
  const item = schema?.properties?.adsets?.items;
  if (item && typeof item === "object") {
    item.properties = {
      ...item.properties ?? {},
      ads: adsList(isPlan ? "Optional. The ads THIS ad set runs, one entry per ad. Leave out to use the top-level ads list." : "Optional. REPLACES the ads this ad set runs, one entry per ad (use one entry for a single ad)."),
      budget_naira: {
        type: "number",
        description: BUDGET_DESC
      },
      countries: {
        type: "array",
        items: {
          type: "string"
        },
        description: COUNTRIES_DESC
      },
      cities: {
        type: "array",
        items: CITY_ITEM,
        description: CITIES_DESC
      }
    };
  }
  if (isPlan && schema?.properties) schema.properties.new_plan = {
    type: "boolean",
    description: NEW_PLAN_DESC
  };
  if (schema?.properties) {
    schema.properties.special_ad_category = {
      type: "string",
      enum: SPECIAL_CATS,
      description: CAT_DESC
    };
    schema.properties.budget_currency = {
      type: "string",
      description: BUDGET_CURRENCY_DESC
    };
  }
  if (!isPlan && schema?.properties) {
    schema.properties.copies_edit = {
      type: "array",
      description: "Rewrite existing copy versions of the draft. Only the fields you send change.",
      items: {
        type: "object",
        properties: {
          copy_index: {
            type: "number",
            description: "Which copy version, starting at 0"
          },
          primary_text: {
            type: "string"
          },
          headline: {
            type: "string"
          },
          description: {
            type: "string"
          }
        },
        required: [
          "copy_index"
        ]
      }
    };
    schema.properties.copies_add = {
      type: "array",
      description: "Add new copy versions to the draft (up to 8 in total). They get the next free copy_index.",
      items: {
        type: "object",
        properties: {
          primary_text: {
            type: "string"
          },
          headline: {
            type: "string"
          },
          description: {
            type: "string"
          }
        },
        required: [
          "primary_text"
        ]
      }
    };
    schema.properties.asset_ids_add = {
      type: "array",
      items: {
        type: "string"
      },
      description: "Creative ids (from list_ad_creatives, same product as the plan) to add to the draft so ad sets can use them."
    };
  }
  // The old wording told assistants to cancel and plan again to move the start time, which made them start over. update_plan takes start_time now.
  const base = String(t?.description ?? "").replace(/\s*To change the start time, cancel the plan and plan it again\./i, "");
  return {
    ...t,
    description: base + (isPlan ? PLAN_NOTE : UPDATE_NOTE),
    inputSchema: schema
  };
}
const NEW_DEFS = [
  {
    name: "list_plans",
    title: "My campaign drafts",
    description: "The person's saved campaign plans (drafts by default) with name, product, number of ad sets and total ads. Call this FIRST whenever the person wants to change, continue, review or launch a campaign that was planned earlier (also in a new conversation) instead of planning again, then call get_plan with its plan_id.",
    inputSchema: OBJ({
      status: {
        type: "string",
        enum: [
          "draft",
          "launched",
          "cancelled",
          "all"
        ],
        description: "Default draft."
      },
      limit: {
        type: "number",
        description: "How many, default 10, max 25."
      }
    }),
    annotations: {
      readOnlyHint: true
    },
    write: false
  },
  {
    name: "get_plan",
    title: "Read a draft campaign in full",
    description: "Everything in one draft plan: campaign settings, its currency, every ad set (budget, countries, audience, placements and which ads it runs), every ad with its FULL primary text, headline, description and the creative image or video link, and every copy version. Always call this before changing a draft, and again after a change to confirm it.",
    inputSchema: OBJ({
      plan_id: str("Plan id from plan_campaign or list_plans")
    }, [
      "plan_id"
    ]),
    annotations: {
      readOnlyHint: true
    },
    write: false
  },
  {
    name: "add_ad_set",
    title: "Add an ad set to a draft",
    description: "Add one ad set to a draft plan (up to 6). It starts as a copy of an existing ad set's audience and settings, and you can override the label, budget, ages, gender, countries, states, cities, interests and placements. ADS: by default the new ad set gets exactly ONE ad (the first ad of the ad set it copies). Pass copy_ads true to give it all the ads of the source ad set, or ads=[{asset_id, copy_index}] to choose them. Creatives and copies must already be in the plan (add them with update_plan asset_ids_add / copies_add). Returns the whole draft so you can say how many ads each ad set has.",
    inputSchema: OBJ({
      plan_id: str("Draft plan id"),
      copy_from: {
        type: "number",
        description: "Which ad set to copy, 1 for the first. Default 1."
      },
      label: str("Short name for the new ad set (max 40 characters)"),
      budget_naira: {
        type: "number",
        description: BUDGET_DESC + " Naira plans need at least 1500. Defaults to the copied ad set's."
      },
      budget_currency: {
        type: "string",
        description: BUDGET_CURRENCY_DESC
      },
      age_min: {
        type: "number"
      },
      age_max: {
        type: "number"
      },
      gender: {
        type: "string",
        enum: [
          "all",
          "male",
          "female"
        ]
      },
      countries: {
        type: "array",
        items: {
          type: "string"
        },
        description: COUNTRIES_DESC
      },
      states: {
        type: "array",
        items: {
          type: "string"
        }
      },
      cities: {
        type: "array",
        items: CITY_ITEM,
        description: CITIES_DESC
      },
      interests: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: {
              type: "string"
            },
            name: {
              type: "string"
            }
          }
        }
      },
      placements: {
        type: "array",
        items: {
          type: "string",
          enum: [
            ...PLACEMENT_KEYS,
            "automatic"
          ]
        }
      },
      ads: adsList("Optional. The ads this new ad set runs, one entry per ad."),
      copy_ads: {
        type: "boolean",
        description: "True = the new ad set runs all the ads of the ad set it copies."
      }
    }, [
      "plan_id"
    ]),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false
    },
    write: true
  },
  {
    name: "search_locations",
    title: "Find cities and states in any country",
    description: "Look up real Meta location keys for ANY country: cities (kind city) or states/regions (kind region), for example the US city Charleston, or the region South Carolina. Pass country as a two-letter code (US, GH, NG ...). Use the returned key and name exactly when you pass cities to plan_campaign, update_plan or add_ad_set. States can also be passed by name (or the two-letter code for the US) in states without a lookup, but a lookup shows whether the name exists.",
    inputSchema: OBJ({
      query: str("Name to search, for example Charleston"),
      country: str("Two-letter country code, for example US"),
      kind: {
        type: "string",
        enum: [
          "city",
          "region"
        ],
        description: "city (default) or region (state)"
      },
      ad_account_id: str("Optional ad account id from list_ad_accounts")
    }, [
      "query",
      "country"
    ]),
    annotations: {
      readOnlyHint: true,
      openWorldHint: true
    },
    write: false
  },
  {
    name: "get_ads",
    title: "Read live ads in full (copy, headline, creative)",
    description: "Read ads straight from Meta with their FULL text: primary text, headline, description, button, link, and the image or video link (plus the video id). Pass ad_id (or ad_ids, max 10), or adset_id to read every ad in an ad set, or campaign_id to read every ad in a campaign (max 25). Use the Meta ids from get_live_ads. Call this before edit_ad, and when the person asks what an ad says or looks like.",
    inputSchema: OBJ({
      ad_account_id: str("Which ad account (id from list_ad_accounts). Optional: it is found from the ad id when the person has several."),
      ad_id: str("One Meta ad id"),
      ad_ids: {
        type: "array",
        items: {
          type: "string"
        },
        description: "Several Meta ad ids (max 10)"
      },
      adset_id: str("Read all ads of this ad set"),
      campaign_id: str("Read all ads of this campaign")
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: true
    },
    write: false
  },
  {
    name: "edit_ad",
    title: "Edit a live ad's copy, headline or creative",
    description: "Change an ad that already exists on Meta, live or paused: primary_text, headline, description, cta (button type such as SHOP_NOW or LEARN_MORE; not for message ads), link (website ads only), name, and/or creative_id to swap the picture or video for another creative of the same kind (from list_ad_creatives). Meta cannot edit an ad's creative in place, so this makes a new creative with the change and points the ad at it. The ad keeps its id, ad set and history, but Meta may re-review it and delivery can briefly return to learning. Always call get_ads first, change only what the person asked for, and say back what is now set. Dynamic creative, carousel and boosted-post ads cannot be edited here.",
    inputSchema: OBJ({
      ad_account_id: str("Which ad account. Optional: it is found from the ad id when the person has several."),
      ad_id: str("Meta ad id from get_live_ads or get_ads"),
      primary_text: str("New main text of the ad"),
      headline: str("New headline (empty string removes it)"),
      description: str("New description (empty string removes it)"),
      cta: str("New button type, for example SHOP_NOW, LEARN_MORE, SIGN_UP, ORDER_NOW. Not for WhatsApp, Messenger or Instagram message ads."),
      link: str("New website link (https). Website ads only."),
      creative_id: str("Creative id from list_ad_creatives to swap in. Image ads take an image, video ads take a video."),
      name: str("New ad name"),
      reason: str("One short sentence: why this change")
    }, [
      "ad_id",
      "reason"
    ]),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true
    },
    write: true
  }
];
const ADDENDUM = `

SPECIAL AD CATEGORY: apartment or house rentals and sales, real estate and mortgages are HOUSING. Job vacancies and hiring are EMPLOYMENT. Pass special_ad_category on plan_campaign (or change it with update_plan). If the product has a default category it is used when you leave it out. For these categories Meta fixes the audience to age 18-65, all genders, no interest targeting and a city radius of at least 25 km (16 miles): say so plainly, and never promise narrower targeting.

CURRENCY AND COUNTRIES: Revora is not only for Nigeria. Budgets are counted in the AD ACCOUNT's own currency (a US account counts in dollars: 2 means $2, never naira). Whenever you pass a budget, also pass budget_currency (USD, NGN ...) and say the amount back with its symbol. A plan whose currency does not match its account is refused. Ad sets target Nigeria unless you pass countries on the ad set (for example [US]). With states or cities give exactly ONE country on that ad set; US states can be named or given as two-letter codes (SC). Use search_locations to find city and state keys in any country, and tell the person the city radius you set (km or miles). Audience size estimates only work for Nigeria. Kill rules and the dashboard cards still count in naira, so for a non-naira account judge results by the real currency in get_live_ads.

EDITING RULE: when the person already has a draft and asks for ANY change to it, continue THAT draft: call list_plans (find it, also in a new conversation), get_plan, then update_plan on the same plan_id (add_ad_set to add an ad set). Never call plan_campaign again for it: a second plan for the same product within 24 hours is refused unless the person asked for a separate, extra campaign (new_plan true). A different product, destination or objective is a new campaign: cancel_plan the old draft first.

DRAFTS AND LIVE ADS: READING AND EDITING. The default structure is 1 campaign, 1 ad set, 1 ad. Pass exactly one ad per ad set unless the person asks for more, never list the same creative and copy twice, and always say how many ads each ad set gets. To find a draft call list_plans, then get_plan: it shows every ad set, every ad with its full primary text, headline and description, the creative image or video link, and which ads each ad set runs. To change a draft use update_plan (budget, ages, states, countries, cities, placements, remove an ad set, ads inside an ad set, copies_edit to rewrite copy or a headline, copies_add for a new copy version, asset_ids_add for a new creative) and add_ad_set to add an ad set (it gets one ad unless asked otherwise). After any change call get_plan again and say back what is now set. To see a LIVE ad, or every ad in an ad set or campaign, call get_ads: full primary text, headline, description, button, link and the image or video link. To change a live ad call edit_ad (text, headline, description, button, link, or swap the picture or video with a creative id from list_ad_creatives): Meta makes a new creative version and may re-review the ad, so say that. Always read first (get_plan or get_ads), change only what was asked, and show the person the new text. Scaling works the same on live ads: set_budget (about 20 percent at a time), duplicate_ad for winners, update_object, set_status.`;
// ── Meta helpers (live ads) ──
const metaErr = (j, status)=>{
  const e = j?.error;
  if (!e) return `Meta error ${status}`;
  return [
    e.error_user_title,
    e.error_user_msg || e.message,
    e.code ? `(Meta code ${e.code}${e.error_subcode ? "/" + e.error_subcode : ""})` : ""
  ].filter(Boolean).join(" ");
};
async function gGet(path, params, token) {
  const r = await fetch(`${GRAPH}/${path}?${new URLSearchParams({
    ...params,
    access_token: token
  })}`);
  const j = await r.json().catch(()=>null);
  if (!r.ok || j?.error) throw new Error(metaErr(j, r.status));
  return j;
}
async function gPost(id, fields, token) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(fields))body.set(k, v !== null && typeof v === "object" ? JSON.stringify(v) : String(v));
  body.set("access_token", token);
  const r = await fetch(`${GRAPH}/${id}`, {
    method: "POST",
    body
  });
  const j = await r.json().catch(()=>null);
  if (!r.ok || j?.error || j?.success === false) throw new Error(metaErr(j, r.status));
  return j;
}
async function myAccounts(c) {
  let q = admin.from("ad_accounts").select("id, name, nickname, media_buyer_id").eq("company_id", c.companyId);
  if (c.role === "buyer") q = q.eq("media_buyer_id", c.mediaBuyerId);
  const { data } = await q;
  return data ?? [];
}
async function buildCtx(accountId) {
  const { data: row } = await admin.from("ad_accounts").select("id, name, nickname, meta_ad_account_id, meta_connection_id").eq("id", accountId).maybeSingle();
  const actId = String(row?.meta_ad_account_id ?? "").replace(/^act_/, "");
  if (!/^\d+$/.test(actId)) return {
    error: "This ad account is not connected to Meta."
  };
  let token = SHARED_META_TOKEN;
  if (row?.meta_connection_id) {
    const { data: conn } = await admin.from("meta_connections").select("access_token, status").eq("id", row.meta_connection_id).maybeSingle();
    if (conn?.status === "active" && conn.access_token) token = conn.access_token;
  }
  if (!token) return {
    error: "No working Meta connection for this ad account. Reconnect it in Revora."
  };
  return {
    actId,
    token,
    name: row?.nickname || row?.name || accountId,
    accountId
  };
}
// The ad account for a call: the one named, the only one, or (when the person has several) the one that owns the Meta object.
async function metaCtxFor(a, c, objectId) {
  const list = await myAccounts(c);
  const want = String(a?.ad_account_id ?? "");
  if (want) {
    const hit = list.find((x)=>x.id === want);
    return hit ? buildCtx(hit.id) : {
      error: "That ad account was not found or is not yours. Call list_ad_accounts."
    };
  }
  if (!list.length) return {
    error: "This person has no ad account connected yet."
  };
  if (list.length === 1) return buildCtx(list[0].id);
  if (objectId) {
    for (const acc of list.slice(0, 8)){
      const m = await buildCtx(acc.id);
      if (m.error) continue;
      try {
        const o = await gGet(objectId, {
          fields: "account_id"
        }, m.token);
        if (String(o.account_id ?? "").replace(/^act_/, "") === m.actId) return m;
      } catch  {}
    }
    return {
      error: "Could not find that item in any of your ad accounts. Pass ad_account_id (from list_ad_accounts)."
    };
  }
  return {
    error: "More than one ad account. Ask which one, using list_ad_accounts, then pass ad_account_id."
  };
}
// The account (row id) a plan call is for: the one named, or the only one. Empty when it cannot be told (mcp-ads then asks the person).
async function accountIdFor(a, c) {
  const list = await myAccounts(c);
  const want = String(a?.ad_account_id ?? "");
  if (want) return list.find((x)=>x.id === want)?.id ?? "";
  return list.length === 1 ? list[0].id : "";
}
// The currency an ad account bills in: saved on the account, else read once from Meta and saved.
async function currencyOf(accountId) {
  const { data } = await admin.from("ad_accounts").select("currency").eq("id", accountId).maybeSingle();
  const have = String(data?.currency ?? "").trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(have)) return {
    currency: have
  };
  const m = await buildCtx(accountId);
  if (m.error) return {
    error: m.error
  };
  try {
    const j = await gGet(`act_${m.actId}`, {
      fields: "currency"
    }, m.token);
    const cur = String(j?.currency ?? "").trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(cur)) {
      await admin.from("ad_accounts").update({
        currency: cur
      }).eq("id", accountId);
      return {
        currency: cur
      };
    }
    return {
      error: "Could not read this ad account's currency from Meta, so nothing was planned."
    };
  } catch (e) {
    return {
      error: "Could not read this ad account's currency from Meta, so nothing was planned: " + e.message
    };
  }
}
const AD_FIELDS = "id,name,status,effective_status,adset_id,campaign_id,account_id,creative{id,name,object_story_spec,asset_feed_spec,effective_object_story_id,image_url,thumbnail_url,call_to_action_type,title,body}";
async function adDetail(ad, token) {
  const cr = ad?.creative ?? {};
  const spec = cr.object_story_spec ?? null;
  const ld = spec?.link_data, vd = spec?.video_data;
  const data = vd ?? ld ?? {};
  const cta = data.call_to_action ?? null;
  const out = {
    ad_id: ad.id,
    name: ad.name,
    status: ad.status,
    effective_status: ad.effective_status,
    adset_id: ad.adset_id,
    campaign_id: ad.campaign_id,
    creative_id: cr.id ?? null,
    creative_name: cr.name ?? null,
    kind: vd ? "video" : ld ? "image" : cr.asset_feed_spec ? "dynamic" : "unknown",
    primary_text: data.message ?? cr.body ?? null,
    headline: ld?.name ?? vd?.title ?? cr.title ?? null,
    description: ld?.description ?? vd?.link_description ?? null,
    button: cta?.type ?? cr.call_to_action_type ?? null,
    link: ld?.link ?? cta?.value?.link ?? null,
    message_destination: cta?.value?.app_destination ?? null,
    image_url: cr.image_url ?? ld?.picture ?? vd?.image_url ?? null,
    thumbnail_url: cr.thumbnail_url ?? null,
    video_id: vd?.video_id ?? null,
    page_id: spec?.page_id ?? null,
    instagram_user_id: spec?.instagram_user_id ?? null
  };
  if (cr.asset_feed_spec) {
    const t = (arr)=>Array.isArray(arr) ? arr.map((x)=>x?.text).filter(Boolean) : [];
    out.dynamic_creative = {
      primary_texts: t(cr.asset_feed_spec.bodies),
      headlines: t(cr.asset_feed_spec.titles),
      descriptions: t(cr.asset_feed_spec.descriptions),
      note: "Meta mixes these texts and pictures itself. This kind of ad cannot be edited with edit_ad."
    };
  }
  if (!spec && cr.effective_object_story_id) out.uses_existing_post = cr.effective_object_story_id;
  if (vd?.video_id) {
    try {
      const v = await gGet(String(vd.video_id), {
        fields: "source,picture,length,permalink_url"
      }, token);
      out.video_url = v.source ?? null;
      out.video_thumbnail = v.picture ?? null;
      out.video_seconds = v.length ?? null;
      if (v.permalink_url) out.video_page_link = `https://www.facebook.com${v.permalink_url}`;
    } catch  {
      out.video_url = null;
      out.video_note = "Meta did not give a playable link for this video. The thumbnail_url is still available.";
    }
  }
  return out;
}
async function getAds(a, c) {
  const adIds = Array.isArray(a?.ad_ids) && a.ad_ids.length ? a.ad_ids.map(String) : a?.ad_id ? [
    String(a.ad_id)
  ] : [];
  const parent = String(a?.adset_id ?? a?.campaign_id ?? "");
  if (!adIds.length && !parent) return {
    error: "Give ad_id (or ad_ids), or adset_id, or campaign_id: the Meta ids from get_live_ads."
  };
  if ([
    ...adIds,
    ...parent ? [
      parent
    ] : []
  ].some((i)=>!/^\d+$/.test(i))) return {
    error: "The ids must be the Meta ids from get_live_ads."
  };
  if (adIds.length > 10) return {
    error: "Read at most 10 ads at a time, or pass adset_id / campaign_id."
  };
  const m = await metaCtxFor(a, c, adIds[0] ?? parent);
  if (m.error) return m;
  try {
    let rows;
    if (adIds.length) rows = await Promise.all(adIds.map((id)=>gGet(id, {
        fields: AD_FIELDS
      }, m.token)));
    else rows = (await gGet(`${parent}/ads`, {
      fields: AD_FIELDS,
      limit: "25"
    }, m.token)).data ?? [];
    rows = rows.filter((r)=>String(r.account_id ?? "").replace(/^act_/, "") === m.actId);
    if (!rows.length) return {
      error: "No ads found there in this ad account."
    };
    const ads = await Promise.all(rows.slice(0, 25).map((r)=>adDetail(r, m.token)));
    return {
      account: m.name,
      count: ads.length,
      ads,
      note: "These are the live texts and creative links. Show the person the primary text and headline in full when they ask, and use image_url, thumbnail_url or video_url for the picture or video. To change an ad use edit_ad."
    };
  } catch (e) {
    return {
      error: e.message
    };
  }
}
const CTA_RE = /^[A-Z][A-Z_]{2,39}$/;
async function editAd(a, c) {
  if (!canWrite(c)) return {
    error: "Only owners, admins and media buyers can edit ads."
  };
  const adId = String(a?.ad_id ?? "");
  if (!/^\d+$/.test(adId)) return {
    error: "ad_id must be the Meta ad id from get_live_ads or get_ads."
  };
  const newName = has(a?.name) ? trunc(a.name, 200) : "";
  const creativeWanted = has(a?.creative_id) && String(a.creative_id).trim() ? String(a.creative_id).trim() : "";
  const creativeChange = has(a?.primary_text) || has(a?.headline) || has(a?.description) || has(a?.cta) || has(a?.link) || !!creativeWanted;
  if (!creativeChange && !newName) return {
    error: "Nothing to change. Pass primary_text, headline, description, cta, link, creative_id or name."
  };
  if (has(a?.primary_text) && !trunc(a.primary_text, 2000)) return {
    error: "primary_text cannot be empty."
  };
  if (has(a?.cta) && !CTA_RE.test(String(a.cta).trim().toUpperCase())) return {
    error: "cta must be a Meta button type such as SHOP_NOW, LEARN_MORE, SIGN_UP or ORDER_NOW."
  };
  if (has(a?.link) && !/^https:\/\/\S+$/.test(String(a.link).trim())) return {
    error: "link must be a full https:// address."
  };
  const m = await metaCtxFor(a, c, adId);
  if (m.error) return m;
  try {
    const cur = await gGet(adId, {
      fields: "account_id,name,status,creative{id,name,object_story_spec,asset_feed_spec,effective_object_story_id}"
    }, m.token);
    if (String(cur.account_id ?? "").replace(/^act_/, "") !== m.actId) return {
      error: "That ad is not in this ad account."
    };
    const payload = {};
    const changed = [];
    if (newName) {
      payload.name = newName;
      changed.push("name");
    }
    if (creativeChange) {
      const cr = cur.creative ?? {};
      if (cr.asset_feed_spec) return {
        error: "This ad uses Meta's dynamic creative (several texts and pictures mixed by Meta), which cannot be edited here. Edit it in Ads Manager, or make a new ad."
      };
      if (!cr.object_story_spec) return {
        error: "This ad is built on an existing post, so its text cannot be edited here. Make a new ad instead."
      };
      const spec = JSON.parse(JSON.stringify(cr.object_story_spec));
      const key = spec.video_data ? "video_data" : spec.link_data ? "link_data" : null;
      if (!key) return {
        error: "This ad type (photo post, carousel or other) cannot be edited here. Make a new ad instead."
      };
      const d = spec[key];
      if (d.child_attachments) return {
        error: "Carousel ads cannot be edited here. Edit it in Ads Manager, or make a new ad."
      };
      if (has(a?.primary_text)) {
        d.message = trunc(a.primary_text, 2000);
        changed.push("primary text");
      }
      if (has(a?.headline)) {
        const h = trunc(a.headline, 200);
        const f = key === "video_data" ? "title" : "name";
        if (h) d[f] = h;
        else delete d[f];
        changed.push("headline");
      }
      if (has(a?.description)) {
        const t = trunc(a.description, 200);
        const f = key === "video_data" ? "link_description" : "description";
        if (t) d[f] = t;
        else delete d[f];
        changed.push("description");
      }
      const isMsgAd = !!d.call_to_action?.value?.app_destination;
      if (has(a?.cta)) {
        if (isMsgAd) return {
          error: "The button of a WhatsApp, Messenger or Instagram message ad is fixed by its destination and cannot be changed."
        };
        const link = d.link ?? d.call_to_action?.value?.link;
        d.call_to_action = {
          ...d.call_to_action ?? {},
          type: String(a.cta).trim().toUpperCase()
        };
        if (!d.call_to_action.value && link) d.call_to_action.value = {
          link
        };
        changed.push("button");
      }
      if (has(a?.link)) {
        if (isMsgAd) return {
          error: "A message ad has no website link to change."
        };
        const url = String(a.link).trim();
        if (key === "link_data") d.link = url;
        if (d.call_to_action) d.call_to_action.value = {
          ...d.call_to_action.value ?? {},
          link: url
        };
        else if (key === "video_data") d.call_to_action = {
          type: "LEARN_MORE",
          value: {
            link: url
          }
        };
        changed.push("link");
      }
      if (creativeWanted) {
        if (!UUID.test(creativeWanted)) return {
          error: "creative_id must be the id from list_ad_creatives."
        };
        const { data: asset } = await admin.from("creative_assets").select("id, file_name, public_url, asset_type, meta_video_id, product_id, ad_account_id").eq("id", creativeWanted).eq("company_id", c.companyId).maybeSingle();
        if (!asset?.public_url) return {
          error: "That creative was not found."
        };
        if (c.role === "buyer" && asset.product_id) {
          const { data: p } = await admin.from("products").select("media_buyer_id").eq("id", asset.product_id).maybeSingle();
          if (p?.media_buyer_id !== c.mediaBuyerId) return {
            error: "A media buyer can only use creatives of their own products."
          };
        }
        const isVideoAsset = asset.asset_type === "video";
        if (isVideoAsset !== (key === "video_data")) return {
          error: `This is ${key === "video_data" ? "a video" : "an image"} ad, so it can only be switched to another ${key === "video_data" ? "video" : "image"}. To change the type, make a new ad.`
        };
        if (isVideoAsset) {
          let vid = asset.meta_video_id && asset.ad_account_id === m.accountId ? String(asset.meta_video_id) : "";
          if (!vid) {
            const up = await fetch(`${GRAPH}/act_${m.actId}/advideos`, {
              method: "POST",
              body: new URLSearchParams({
                file_url: asset.public_url,
                access_token: m.token
              })
            });
            const uj = await up.json().catch(()=>null);
            if (!uj?.id) return {
              error: "Meta could not take the video: " + metaErr(uj, up.status)
            };
            vid = String(uj.id);
          }
          delete d.image_url;
          delete d.image_hash;
          d.video_id = vid;
        } else {
          delete d.image_hash;
          delete d.image_crops;
          d.picture = asset.public_url;
        }
        changed.push(isVideoAsset ? "video" : "picture");
      }
      const res = await fetch(`${GRAPH}/act_${m.actId}/adcreatives`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: `${trunc(cr.name || cur.name, 150)}-edit-${Date.now()}`,
          object_story_spec: spec,
          contextual_multi_ads: {
            enroll_status: "OPT_OUT"
          },
          access_token: m.token
        })
      });
      const j = await res.json().catch(()=>null);
      if (!j?.id) return {
        error: "Meta refused the new version of the ad: " + metaErr(j, res.status) + " The ad was not changed."
      };
      payload.creative = {
        creative_id: j.id
      };
    }
    await gPost(adId, payload, m.token);
    const after = await gGet(adId, {
      fields: AD_FIELDS
    }, m.token);
    return {
      ok: true,
      edited: true,
      changed,
      ad: await adDetail(after, m.token),
      note: creativeChange ? "Changed. Meta made a new creative version for this ad, so it may show In review for a short while and delivery can briefly return to learning. Say back the new text to the person." : "Changed."
    };
  } catch (e) {
    return {
      error: e.message
    };
  }
}
// ── locations in any country ──
async function searchLocations(a, c) {
  const q = trunc(a?.query, 80);
  const cc = String(a?.country ?? "").trim().toUpperCase();
  if (!q) return {
    error: "Give the name to search for."
  };
  if (!/^[A-Z]{2}$/.test(cc)) return {
    error: "country must be a two-letter code such as US, GH or NG."
  };
  const kind = a?.kind === "region" ? "region" : "city";
  const list = await myAccounts(c);
  const want = String(a?.ad_account_id ?? "");
  const accId = want ? list.find((x)=>x.id === want)?.id ?? "" : list[0]?.id ?? "";
  if (!accId) return {
    error: want ? "That ad account was not found or is not yours. Call list_ad_accounts." : "This person has no ad account connected yet."
  };
  const m = await buildCtx(accId);
  if (m.error) return m;
  try {
    const j = await gGet("search", {
      type: "adgeolocation",
      location_types: JSON.stringify([
        kind
      ]),
      country_code: cc,
      q,
      limit: "10"
    }, m.token);
    const locations = (Array.isArray(j?.data) ? j.data : []).map((x)=>({
        key: String(x.key),
        name: x.name,
        type: x.type,
        region: x.region ?? null,
        country_code: x.country_code ?? cc,
        supports_city: x.supports_city ?? null
      }));
    return {
      country: cc,
      kind,
      count: locations.length,
      locations,
      note: locations.length ? kind === "city" ? "Pass a city as {key, name, region, radius, distance_unit} in cities, with that ad set's countries set to this one country." : "For a state or region you can pass its name in states with the ad set's countries set to this country." : "Nothing found. Try another spelling or kind."
    };
  } catch (e) {
    return {
      error: e.message
    };
  }
}
// ── plans (drafts) ──
const masterOf = (plan)=>{
  const nCopies = Array.isArray(plan?.copies) ? plan.copies.length : 0;
  if (Array.isArray(plan?.ads) && plan.ads.length) return plan.ads.map(toPair);
  return (Array.isArray(plan?.asset_ids) ? plan.asset_ids : []).map((id, j)=>({
      asset_id: String(id),
      copy_index: nCopies ? j % nCopies : 0
    }));
};
const numbersOf = (plan, master)=>(Array.isArray(plan?.adsets) ? plan.adsets : []).map((s)=>Array.isArray(s?.ad_numbers) && s.ad_numbers.length ? s.ad_numbers.map(Number) : master.map((_, k)=>k + 1));
async function loadPlan(planId, c) {
  if (!UUID.test(planId)) return {
    error: "plan_id must be the id from plan_campaign or list_plans."
  };
  const { data: row } = await admin.from("ai_plans").select("id, plan, status, user_id, created_at").eq("id", planId).eq("company_id", c.companyId).maybeSingle();
  if (!row?.plan) return {
    error: "That plan was not found on this account."
  };
  if (row.user_id !== c.userId && !isAdmin(c)) return {
    error: "This plan belongs to someone else."
  };
  return {
    row
  };
}
async function planView(row, c) {
  const plan = row.plan ?? {};
  const cur = String(plan.currency ?? "NGN").toUpperCase();
  const foreign = cur !== "NGN";
  const master = masterOf(plan);
  const nums = numbersOf(plan, master);
  const ids = [
    ...new Set([
      ...master.map((m)=>m.asset_id),
      ...Array.isArray(plan.asset_ids) ? plan.asset_ids.map(String) : []
    ])
  ].filter((x)=>UUID.test(x));
  const { data: files } = ids.length ? await admin.from("creative_assets").select("id, file_name, public_url, asset_type").eq("company_id", c.companyId).in("id", ids) : {
    data: []
  };
  const fileOf = new Map((files ?? []).map((f)=>[
      f.id,
      f
    ]));
  const copies = (Array.isArray(plan.copies) ? plan.copies : []).map((cp, i)=>({
      copy_index: i,
      primary_text: cp?.primary_text ?? null,
      headline: cp?.headline || null,
      description: cp?.description || null
    }));
  const ads = master.map((m, k)=>{
    const f = fileOf.get(m.asset_id);
    const cp = copies[m.copy_index];
    return {
      ad_number: k + 1,
      creative_id: m.asset_id,
      creative_file: f?.file_name ?? null,
      creative_type: f?.asset_type ?? null,
      creative_link: f?.public_url ?? null,
      copy_index: m.copy_index,
      primary_text: cp?.primary_text ?? null,
      headline: cp?.headline ?? null,
      description: cp?.description ?? null
    };
  });
  const sets = (Array.isArray(plan.adsets) ? plan.adsets : []).map((s, i)=>({
      ad_set_number: i + 1,
      label: s?.label,
      ...foreign ? {
        daily_budget: s?.budget_naira,
        currency: cur
      } : {
        daily_budget_naira: s?.budget_naira
      },
      age_min: s?.age_min,
      age_max: s?.age_max,
      gender: s?.gender,
      countries: Array.isArray(s?.countries) && s.countries.length ? s.countries : [
        "NG"
      ],
      states: s?.states ?? [],
      cities: (s?.cities ?? []).map((x)=>x?.name),
      cities_detail: (s?.cities ?? []).map((x)=>({
          name: x?.name,
          radius: x?.radius,
          unit: x?.distance_unit ?? "kilometer"
        })),
      interests: (s?.interests ?? []).map((x)=>x?.name),
      placements: s?.placements ?? plan.placements ?? "automatic",
      ad_numbers: nums[i],
      ads_count: nums[i]?.length ?? 0
    }));
  const { data: opt } = await admin.from("ai_plan_options").select("start_time, end_time").eq("plan_id", row.id).maybeSingle();
  const totalBudget = sets.reduce((n, s)=>n + (Number(foreign ? s.daily_budget : s.daily_budget_naira) || 0), 0);
  return {
    plan_id: row.id,
    status: row.status,
    campaign_name: plan.campaign_name,
    product: plan.product_name,
    destination: plan.destination,
    objective: plan.objective,
    special_ad_category: plan.special_ad_category ?? "NONE",
    currency: cur,
    budget_type: plan.budget_type,
    created_paused: plan.launch_paused === true,
    starts: opt?.start_time ?? plan.scheduled_for ?? null,
    ends: opt?.end_time ?? plan.campaign_end_date ?? null,
    ...foreign ? {
      total_daily_budget: totalBudget
    } : {
      total_daily_budget_naira: totalBudget
    },
    ad_sets: sets,
    total_ads: sets.reduce((n, s)=>n + s.ads_count, 0),
    ads,
    copies,
    warnings: (Array.isArray(plan.warnings) ? plan.warnings : []).filter((w)=>!foreign || !String(w).includes("\u20a6"))
  };
}
async function listPlans(a, c) {
  const status = [
    "draft",
    "launched",
    "cancelled",
    "all"
  ].includes(String(a?.status)) ? String(a.status) : "draft";
  let q = admin.from("ai_plans").select("id, status, created_at, user_id, plan").eq("company_id", c.companyId).order("created_at", {
    ascending: false
  }).limit(clamp(Math.round(Number(a?.limit)) || 10, 1, 25));
  if (status !== "all") q = q.eq("status", status);
  if (!isAdmin(c)) q = q.eq("user_id", c.userId);
  const { data } = await q;
  const plans = (data ?? []).map((r)=>{
    const master = masterOf(r.plan);
    const nums = numbersOf(r.plan, master);
    const cur = String(r.plan?.currency ?? "NGN").toUpperCase();
    const total = (r.plan?.adsets ?? []).reduce((n, s)=>n + (Number(s?.budget_naira) || 0), 0);
    return {
      plan_id: r.id,
      status: r.status,
      created: r.created_at,
      campaign_name: r.plan?.campaign_name,
      product: r.plan?.product_name,
      budget_type: r.plan?.budget_type,
      ad_sets: nums.length,
      total_ads: nums.reduce((n, x)=>n + x.length, 0),
      currency: cur,
      ...cur === "NGN" ? {
        daily_budget_naira: total
      } : {
        daily_budget: total
      }
    };
  });
  return {
    status,
    count: plans.length,
    plans,
    next: plans.length ? "Call get_plan with a plan_id to read one in full." : "No plans found."
  };
}
async function getPlan(a, c) {
  const L = await loadPlan(String(a?.plan_id ?? ""), c);
  if (L.error) return L;
  return planView(L.row, c);
}
// ── add_ad_set ──
function checkPlacements(raw) {
  if (!Array.isArray(raw) || !raw.length) return {};
  const asked = [
    ...new Set(raw.map((x)=>String(x).trim().toLowerCase()).filter(Boolean))
  ];
  if (asked.includes("automatic")) return asked.length === 1 ? {
    list: [
      "automatic"
    ]
  } : {
    error: "automatic cannot be combined with other placements. Send [automatic] alone, or a list of keys."
  };
  const bad = asked.filter((k)=>!PLACEMENT_KEYS.includes(k));
  if (bad.length) return {
    error: `These are not valid placements: ${bad.join(", ")}. Valid keys: ${PLACEMENT_KEYS.join(", ")}, or [automatic].`
  };
  return {
    list: asked
  };
}
async function addAdSet(a, c) {
  if (!canWrite(c)) return {
    error: "Only owners, admins and media buyers can change plans."
  };
  const L = await loadPlan(String(a?.plan_id ?? ""), c);
  if (L.error) return L;
  const row = L.row;
  if (row.status !== "draft") return {
    error: "That draft plan was not found, or it can no longer be changed."
  };
  const plan = row.plan;
  const planCur = String(plan.currency ?? "NGN").toUpperCase();
  const foreign = planCur !== "NGN";
  if (has(a?.budget_naira)) {
    const bc = currencyMismatch(a?.budget_currency, planCur, "plan");
    if (bc) return bc;
  }
  const sets = Array.isArray(plan.adsets) ? plan.adsets : [];
  if (sets.length >= MAX_ADSETS) return {
    error: `A plan holds at most ${MAX_ADSETS} ad sets.`
  };
  const fromNo = Math.round(Number(a?.copy_from)) || 1;
  const src = sets[fromNo - 1];
  if (!src) return {
    error: `There is no ad set ${fromNo} in this plan (it has ${sets.length}).`
  };
  const master = masterOf(plan);
  const nums = numbersOf(plan, master);
  const assetIds = (Array.isArray(plan.asset_ids) ? plan.asset_ids : []).map(String);
  const nCopies = Array.isArray(plan.copies) ? plan.copies.length : 0;
  // Pin every ad set to the ads it has now, so adding one never changes another.
  plan.adsets = sets.map((s, i)=>Array.isArray(s?.ad_numbers) && s.ad_numbers.length ? s : {
      ...s,
      ad_numbers: nums[i]
    });
  let newNums;
  if (Array.isArray(a?.ads) && a.ads.length) {
    newNums = [];
    for (const raw of a.ads.slice(0, MAX_ADS)){
      const p = toPair(raw);
      if (!assetIds.includes(p.asset_id)) return {
        error: "That creative is not part of this plan. Add it first with update_plan asset_ids_add, then call add_ad_set again."
      };
      if (p.copy_index < 0 || p.copy_index >= nCopies) return {
        error: `copy_index must be between 0 and ${Math.max(nCopies - 1, 0)}. To use a new copy, add it first with update_plan copies_add.`
      };
      let k = master.findIndex((m)=>m.asset_id === p.asset_id && m.copy_index === p.copy_index);
      if (k < 0) {
        if (master.length >= MAX_ADS) return {
          error: `A plan can hold at most ${MAX_ADS} different ads (creative + copy). Reuse one that is already in the plan.`
        };
        master.push(p);
        k = master.length - 1;
      }
      newNums.push(k + 1);
    }
  } else if (a?.copy_ads === true) newNums = [
    ...nums[fromNo - 1]
  ];
  else newNums = [
    nums[fromNo - 1][0]
  ];
  if (!newNums.length || newNums.some((n)=>!Number.isFinite(n))) return {
    error: "The ad set you copy from has no ads to copy. Pass ads for the new ad set."
  };
  const ns = JSON.parse(JSON.stringify(src));
  delete ns.__remove;
  ns.label = trunc(a?.label ?? `${src.label} copy`, 40) || `Ad set ${sets.length + 1}`;
  if (`${plan.product_name} \u00b7 ${ns.label} \u00b7 Ad ${master.length}`.length > 120) return {
    error: "That ad set name is too long for the product name. Use a shorter label (every ad is named product \u00b7 ad set \u00b7 Ad N)."
  };
  if (has(a?.budget_naira)) {
    if (foreign) {
      const b = Number(a.budget_naira);
      if (!(b >= 1) || b > MAX_FOREIGN_BUDGET) return {
        error: `budget_naira must be between 1 and ${MAX_FOREIGN_BUDGET.toLocaleString("en-US")} ${planCur} (this plan's currency): the daily budget the person stated.`
      };
      ns.budget_naira = Math.round(b * 100) / 100;
    } else {
      const b = Math.round(Number(a.budget_naira));
      if (!(b >= 1500)) return {
        error: "budget_naira must be at least 1500 naira: the daily budget the person stated."
      };
      ns.budget_naira = clamp(b, 1500, 5e5);
    }
  }
  if (has(a?.age_min)) ns.age_min = clamp(Math.round(Number(a.age_min)) || 18, 18, 65);
  if (has(a?.age_max)) ns.age_max = clamp(Math.round(Number(a.age_max)) || 65, 18, 65);
  if (Number(ns.age_min) > Number(ns.age_max)) return {
    error: "age_min cannot be above age_max."
  };
  if ([
    "all",
    "male",
    "female"
  ].includes(a?.gender)) ns.gender = a.gender;
  if (Array.isArray(a?.countries)) {
    const cs = normCountries(a.countries);
    if (cs.length) ns.countries = cs;
    else delete ns.countries;
  }
  if (Array.isArray(a?.states)) ns.states = a.states.map((s)=>String(s).replace(/ state$/i, "").trim()).filter(Boolean).slice(0, 12);
  if (Array.isArray(a?.cities)) ns.cities = normCities(a.cities);
  if ((ns.states?.length || ns.cities?.length) && Array.isArray(ns.countries) && ns.countries.length > 1) return {
    error: "When an ad set names states or cities it can only have ONE country. Pass one country, or clear the states and cities."
  };
  if (Array.isArray(a?.interests)) ns.interests = a.interests.filter((x)=>/^\d+$/.test(String(x?.id))).map((x)=>({
      id: String(x.id),
      name: String(x.name || "")
    })).slice(0, 8);
  const pl = checkPlacements(a?.placements);
  if (pl.error) return {
    error: pl.error
  };
  if (pl.list) ns.placements = pl.list;
  ns.ad_numbers = [
    ...new Set(newNums)
  ];
  const sig = (s)=>JSON.stringify([
      s.age_min,
      s.age_max,
      s.gender,
      s.countries ?? null,
      s.states,
      (s.cities ?? []).map((x)=>x.key),
      (s.interests ?? []).map((x)=>x.id),
      s.placements ?? null
    ]);
  const same = sig(ns) === sig(src);
  plan.adsets.push(ns);
  plan.ads = master;
  const { error } = await admin.from("ai_plans").update({
    plan
  }).eq("id", row.id).eq("company_id", c.companyId);
  if (error) return {
    error: "Could not save the new ad set: " + error.message
  };
  const view = await planView({
    ...row,
    plan
  }, c);
  return {
    ok: true,
    added_ad_set: ns.label,
    ads_in_new_ad_set: ns.ad_numbers.length,
    ...same ? {
      warning: "The new ad set has the same audience and placements as the one it copies, so the two ad sets will compete against each other for the same people. Change the audience, ages or placements, or tell the person."
    } : {},
    ...view,
    next: `Say plainly how many ads EACH ad set has (see ad_sets). The total is ${view.total_ads}. The draft is not live until the person launches it.`
  };
}
// ── what the person sees: ad counts that match the per-ad-set choice ──
async function decorate(out, c) {
  const pid = String(out?.plan_id ?? "");
  if (!UUID.test(pid)) return out;
  const { data: row } = await admin.from("ai_plans").select("plan").eq("id", pid).eq("company_id", c.companyId).maybeSingle();
  const plan = row?.plan;
  const sets = Array.isArray(plan?.adsets) ? plan.adsets : [];
  if (!sets.some((s)=>Array.isArray(s?.ad_numbers) && s.ad_numbers.length)) return out;
  const master = Array.isArray(plan?.ads) ? plan.ads.map(toPair) : [];
  const nums = sets.map((s)=>Array.isArray(s?.ad_numbers) && s.ad_numbers.length ? s.ad_numbers.map(Number) : master.map((_, k)=>k + 1));
  const total = nums.reduce((n, x)=>n + x.length, 0);
  const ids = [
    ...new Set(master.map((m)=>m.asset_id))
  ].filter((x)=>UUID.test(x));
  const { data: files } = ids.length ? await admin.from("creative_assets").select("id, file_name").eq("company_id", c.companyId).in("id", ids) : {
    data: []
  };
  const nameOf = new Map((files ?? []).map((f)=>[
      f.id,
      f.file_name
    ]));
  const per = sets.map((s, i)=>({
      ad_set: s?.label ?? `Ad set ${i + 1}`,
      ads_count: nums[i].length,
      ads: nums[i].map((n)=>{
        const m = master[n - 1];
        return {
          number: n,
          creative: nameOf.get(m?.asset_id) ?? m?.asset_id,
          copy_index: m?.copy_index
        };
      })
    }));
  const res = {
    ...out,
    total_ads: total,
    ads_per_ad_set: per
  };
  if (typeof out.summary === "string") res.summary = out.summary.replace(/ \u00b7 \d+ ads? \u00b7 /, ` \u00b7 ${total} ad${total === 1 ? "" : "s"} \u00b7 `);
  if (typeof out.creatives === "string") res.creatives = per.map((p)=>`${p.ad_set}: ${p.ads_count} ad${p.ads_count === 1 ? "" : "s"}`).join("; ");
  if (Array.isArray(out.ad_sets)) res.ad_sets = out.ad_sets.map((s, i)=>({
      ...s,
      ads_count: per[i]?.ads_count
    }));
  res.next = (out.next ? out.next + " " : "") + `ADS PER AD SET: say plainly how many ads EACH ad set gets (see ads_per_ad_set). The total is ${total} ad${total === 1 ? "" : "s"}.`;
  return res;
}
// What the assistant is shown for a plan: amounts in the plan's own currency (cur is empty for naira plans), no Nigeria-only reach estimates for ad sets abroad.
function shapeOut(out, plan, cur) {
  if (!out || typeof out !== "object") return out;
  const sets = Array.isArray(plan?.adsets) ? plan.adsets : [];
  const total = sets.reduce((n, s)=>n + (Number(s?.budget_naira) || 0), 0);
  const res = {
    ...out
  };
  let abroad = false;
  if (Array.isArray(out.ad_sets)) {
    res.ad_sets = out.ad_sets.map((s, i)=>{
      const { daily_budget_naira: dn, estimated_reach: er, ...rest } = s ?? {};
      const ps = sets[i] ?? {};
      const ab = Array.isArray(ps.countries) && ps.countries.length > 0;
      if (ab) abroad = true;
      return {
        ...rest,
        ...cur ? {
          daily_budget: ps.budget_naira,
          currency: cur
        } : {
          daily_budget_naira: dn
        },
        ...ab ? {
          countries: ps.countries
        } : {},
        estimated_reach: cur || ab ? null : er
      };
    });
  }
  let next = out.next ? String(out.next) + " " : "";
  if (cur) {
    res.currency = cur;
    res.total_daily_budget = total;
    if (typeof out.summary === "string") {
      const parts = out.summary.split(" \u00b7 ").filter((p)=>!p.includes("\u20a6"));
      res.summary = [
        parts[0],
        `${money(cur, total)}/day total`,
        ...parts.slice(1)
      ].filter(Boolean).join(" \u00b7 ");
    }
    if (Array.isArray(out.warnings)) res.warnings = out.warnings.filter((w)=>!String(w).includes("\u20a6"));
    if (res.your_kill_rule !== undefined) {
      delete res.your_kill_rule;
      next += "The person's kill rules are saved in naira, so they are not shown for this account's currency. ";
    }
    next += `CURRENCY: every budget here is in ${cur} (the ad account's currency). Say amounts with ${SYM[cur] ?? cur} and never with the naira sign.`;
  }
  if (abroad) next += ` Audience size estimates only work for Nigeria, so none is shown for the ad sets abroad.`;
  if (next) res.next = next.trim();
  return res;
}
// ── one draft per job ──
// If the person already has an open draft for the same product from the last 24 hours, do not save a second one:
// hand the assistant that draft so it continues it with get_plan + update_plan. new_plan true overrides it.
const sameName = (x, y)=>String(x ?? "").trim().toLowerCase() === String(y ?? "").trim().toLowerCase();
async function openDraftGuard(a, c) {
  if (a?.new_plan === true || !trunc(a?.product_name, 200) || !c?.userId) return null;
  const since = new Date(Date.now() - DRAFT_GUARD_HOURS * 3600_000).toISOString();
  const { data } = await admin.from("ai_plans").select("id, plan, created_at").eq("company_id", c.companyId).eq("user_id", c.userId).eq("status", "draft").gte("created_at", since).order("created_at", {
    ascending: false
  }).limit(10);
  const hit = (data ?? []).find((r)=>sameName(r.plan?.product_name, a.product_name));
  if (!hit) return null;
  const nums = numbersOf(hit.plan, masterOf(hit.plan));
  const ads = nums.reduce((n, x)=>n + x.length, 0);
  const name = hit.plan?.campaign_name ?? hit.plan?.product_name ?? "your draft";
  return {
    needs_info: true,
    blocked: "open_draft_exists",
    existing_plan_id: hit.id,
    existing_campaign_name: name,
    existing_ad_sets: nums.length,
    existing_total_ads: ads,
    created: hit.created_at,
    message: `Nothing was saved. The person already has an open draft for ${a.product_name}: "${name}" (plan_id ${hit.id}, ${nums.length} ad set${nums.length === 1 ? "" : "s"}, ${ads} ad${ads === 1 ? "" : "s"}). Continue THAT draft instead of planning again: call get_plan with that plan_id, then update_plan to change it (name, budgets, audience, placements, start_time or end_time, copies_edit / copies_add, asset_ids_add, ads inside an ad set; add_ad_set to add an ad set, or remove:true to drop one). Only if the person explicitly asked for a separate, extra campaign, call plan_campaign again with new_plan true. If they want that draft thrown away, call cancel_plan on it first.`
  };
}
// ── special ad category ──
// Saves the category on a plan that mcp-ads has just created (the launcher reads it from ai_plans.plan.special_ad_category).
async function stampCategory(out, cat, c) {
  if (!cat || !out || out.error || out.needs_info || !UUID.test(String(out.plan_id ?? ""))) return out;
  const { data: row } = await admin.from("ai_plans").select("plan").eq("id", out.plan_id).eq("company_id", c.companyId).maybeSingle();
  if (!row?.plan) return out;
  await admin.from("ai_plans").update({
    plan: {
      ...row.plan,
      special_ad_category: cat
    }
  }).eq("id", out.plan_id).eq("company_id", c.companyId);
  return {
    ...out,
    special_ad_category: cat
  };
}
// ── plan_campaign ──
async function planCampaignCore(a0, c) {
  if (!c?.companyId) return {
    error: "No company on this login yet."
  };
  const blocked = await openDraftGuard(a0, c);
  if (blocked) return blocked;
  const { new_plan: _newPlan, special_ad_category: rawCat, ...a } = a0 ?? {};
  const cat = has(rawCat) ? String(rawCat).toUpperCase() : "";
  if (cat && !SPECIAL_CATS.includes(cat)) return {
    needs_info: true,
    message: `special_ad_category must be one of ${SPECIAL_CATS.join(", ")}.`
  };
  const sets = Array.isArray(a?.adsets) ? a.adsets : [];
  const own = sets.slice(0, 6).map((s)=>s && Array.isArray(s.ads) ? s.ads : null);
  if (!own.some((x)=>x && x.length)) {
    // Same creative + same copy twice is a pure duplicate ad: drop the repeats instead of launching identical ads.
    const dd = Array.isArray(a?.ads) && a.ads.length ? dedupe(a.ads.slice(0, MAX_ADS * 2)) : {
      pairs: null,
      removed: 0
    };
    const out = await viaAds("plan_campaign", {
      ...a,
      ...dd.pairs ? {
        ads: dd.pairs
      } : {},
      adsets: cleanSets(sets)
    }, c);
    return noteDuplicates(await stampCategory(out, cat, c), dd.removed);
  }
  const empty = own.findIndex((x)=>x && !x.length);
  if (empty >= 0) return {
    needs_info: true,
    message: `Ad set ${empty + 1} has an empty ads list. Every ad set needs at least one ad.`
  };
  const top = dedupe(Array.isArray(a?.ads) ? a.ads.slice(0, MAX_ADS * 2) : []).pairs.slice(0, MAX_ADS);
  const noOwn = own.findIndex((x)=>!x);
  if (noOwn >= 0 && !top.length) return {
    needs_info: true,
    message: `Ad set ${noOwn + 1} has no ads list of its own and there is no top-level ads list for it. Give every ad set its own ads, or also pass a top-level ads list for the ad sets without one.`
  };
  const master = [];
  const at = new Map();
  const put = (p)=>{
    const k = `${p.asset_id}|${p.copy_index}`;
    if (!at.has(k)) {
      master.push(p);
      at.set(k, master.length);
    }
    return at.get(k);
  };
  const numbers = [];
  let dups = 0;
  for (const [i, x] of own.entries()){
    const list = (x ?? top).slice(0, MAX_ADS).map(toPair);
    if (list.some((p)=>!validId(p.asset_id) || p.copy_index < 0)) return {
      needs_info: true,
      message: `Ad set ${i + 1}: every ad needs a creative id from list_ad_creatives and a copy_index of 0 or more.`
    };
    const uniq = [
      ...new Set(list.map(put))
    ];
    dups += list.length - uniq.length;
    numbers.push(uniq);
  }
  if (master.length > MAX_ADS) return {
    needs_info: true,
    message: `This plan uses ${master.length} different ads (creative + copy pairs) across its ad sets, and the limit is ${MAX_ADS}. Reuse the same ad in several ad sets, or use fewer different ones.`
  };
  // Keep ad set names short: every ad is named "product \u00b7 ad set \u00b7 Ad N" and the launcher reads N from the end of that name.
  const args = {
    ...a,
    ads: master,
    asset_ids: [
      ...new Set([
        ...master.map((p)=>p.asset_id),
        ...Array.isArray(a?.asset_ids) ? a.asset_ids.map(String) : []
      ])
    ],
    adsets: cleanSets(sets).map((s)=>s && typeof s === "object" && s.label ? {
        ...s,
        label: String(s.label).slice(0, 40)
      } : s)
  };
  const out = await viaAds("plan_campaign", args, c);
  if (!out || out.error || out.needs_info || !UUID.test(String(out.plan_id ?? ""))) return out;
  const { data: row } = await admin.from("ai_plans").select("plan").eq("id", out.plan_id).eq("company_id", c.companyId).maybeSingle();
  const plan = row?.plan;
  const fail = (why)=>({
      error: `The plan was saved but its ads per ad set could not be attached (${why}), so nothing was applied. Cancel that plan (cancel_plan) and plan it again.`,
      plan_id: out.plan_id
    });
  if (!plan) return fail("plan not found");
  if (!Array.isArray(plan.ads) || plan.ads.length !== master.length) return fail("the ads did not line up");
  plan.adsets = (plan.adsets ?? []).map((s, i)=>({
      ...s,
      ad_numbers: numbers[i] ?? master.map((_, k)=>k + 1)
    }));
  if (cat) plan.special_ad_category = cat;
  const { error } = await admin.from("ai_plans").update({
    plan
  }).eq("id", out.plan_id).eq("company_id", c.companyId);
  if (error) return fail(error.message);
  const decorated = await decorate(out, c);
  return noteDuplicates(cat ? {
    ...decorated,
    special_ad_category: cat
  } : decorated, dups);
}
// Currency, budget and country handling around the core planner. Naira accounts without countries go through exactly as before.
async function planCampaign(a0, c) {
  if (!c?.companyId) return {
    error: "No company on this login yet."
  };
  const accountId = await accountIdFor(a0, c);
  let cur = "NGN";
  if (accountId) {
    const r = await currencyOf(accountId);
    if (r.error) return {
      error: r.error
    };
    cur = r.currency;
    if (!CURRENCIES.includes(cur)) return {
      error: `This ad account bills in ${cur}, which is not verified for launching yet. Nothing was planned.`
    };
    const bc = currencyMismatch(a0?.budget_currency, cur, "ad account");
    if (bc) return bc;
  }
  const foreign = cur !== "NGN";
  const sets = (Array.isArray(a0?.adsets) ? a0.adsets : []).slice(0, MAX_ADSETS);
  const extras = sets.map((s)=>({
      countries: normCountries(s?.countries),
      cities: Array.isArray(s?.cities) ? normCities(s.cities) : []
    }));
  for (const [i, e] of extras.entries()){
    if (e.countries.length > 1 && (Array.isArray(sets[i]?.states) && sets[i].states.length || e.cities.length)) return {
      needs_info: true,
      message: `Ad set ${i + 1} names states or cities but also several countries. Give exactly ONE country on that ad set, or remove the states and cities.`
    };
  }
  const real = [];
  if (foreign) {
    for (const [i, s] of sets.entries()){
      const b = Number(s?.budget_naira);
      if (!(b >= 1) || b > MAX_FOREIGN_BUDGET) return {
        needs_info: true,
        message: `Ad set ${i + 1}: the daily budget must be between 1 and ${MAX_FOREIGN_BUDGET.toLocaleString("en-US")} ${cur}, stated by the person. Ask for it; never pick one yourself.`
      };
      real.push(Math.round(b * 100) / 100);
    }
  }
  const { budget_currency: _bc, ...rest } = a0 ?? {};
  const args = foreign ? {
    ...rest,
    adsets: (Array.isArray(rest.adsets) ? rest.adsets : []).map((s)=>s && typeof s === "object" ? {
        ...s,
        budget_naira: NAIRA_FLOOR
      } : s)
  } : rest;
  const out = await planCampaignCore(args, c);
  const needs = foreign || extras.some((e)=>e.countries.length || e.cities.length);
  if (!needs || !out || out.error || out.needs_info || !UUID.test(String(out.plan_id ?? ""))) return out;
  const { data: row } = await admin.from("ai_plans").select("plan").eq("id", out.plan_id).eq("company_id", c.companyId).maybeSingle();
  const plan = row?.plan;
  const fail = (why)=>({
      error: `The plan was saved but its ${foreign ? "currency, budget, " : ""}countries or cities could not be attached (${why}), so nothing was applied. Cancel that plan (cancel_plan) and plan it again.`,
      plan_id: out.plan_id
    });
  if (!plan) return fail("plan not found");
  const planSets = Array.isArray(plan.adsets) ? plan.adsets : [];
  if (planSets.length !== extras.length) return fail("the ad sets did not line up");
  plan.adsets = planSets.map((s, i)=>{
    const n = {
      ...s
    };
    if (foreign) n.budget_naira = real[i];
    if (extras[i].countries.length) n.countries = extras[i].countries;
    if (extras[i].cities.length) n.cities = extras[i].cities;
    return n;
  });
  if (foreign) {
    plan.currency = cur;
    plan.warnings = (Array.isArray(plan.warnings) ? plan.warnings : []).filter((w)=>!String(w).includes("\u20a6"));
  }
  const { error } = await admin.from("ai_plans").update({
    plan
  }).eq("id", out.plan_id).eq("company_id", c.companyId);
  if (error) return fail(error.message);
  return shapeOut(out, plan, foreign ? cur : "");
}
// ── update_plan ──
async function updatePlanCore(a, c) {
  if (!c?.companyId) return {
    error: "No company on this login yet."
  };
  const planId = String(a?.plan_id ?? "");
  const sets = Array.isArray(a?.adsets) ? a.adsets : [];
  const copyEdits = Array.isArray(a?.copies_edit) ? a.copies_edit : [];
  const copyAdds = Array.isArray(a?.copies_add) ? a.copies_add : [];
  const assetAdds = (Array.isArray(a?.asset_ids_add) ? a.asset_ids_add : []).map(String);
  const wantsAds = sets.some((s)=>s && typeof s === "object" && Object.hasOwn(s, "ads"));
  const wants = wantsAds || copyEdits.length > 0 || copyAdds.length > 0 || assetAdds.length > 0;
  const changes = [];
  if (wants) {
    if (!UUID.test(planId)) return {
      error: "plan_id must be the id from plan_campaign."
    };
    const { data: row } = await admin.from("ai_plans").select("plan, status, user_id").eq("id", planId).eq("company_id", c.companyId).maybeSingle();
    if (!row?.plan || row.status !== "draft") return {
      error: "That draft plan was not found, or it can no longer be changed."
    };
    if (row.user_id !== c.userId && !isAdmin(c)) return {
      error: "This plan belongs to someone else."
    };
    const plan = row.plan;
    if (!Array.isArray(plan.copies)) plan.copies = [];
    if (!Array.isArray(plan.asset_ids)) plan.asset_ids = [];
    // Make the plan's ads explicit BEFORE copies or creatives are added, so the default pairing never shifts.
    const master = masterOf(plan);
    const before = master.length;
    for (const id of assetAdds){
      if (!UUID.test(id)) return {
        error: `"${id}" is not a creative id. Use the id from list_ad_creatives.`
      };
      if (plan.asset_ids.map(String).includes(id)) continue;
      const { data: r2 } = await admin.from("creative_assets").select("id, public_url").eq("id", id).eq("company_id", c.companyId).maybeSingle();
      if (!r2) return {
        error: `Creative ${id} was not found.`
      };
      const { data: grp } = await admin.from("creative_assets").select("product_id").eq("company_id", c.companyId).eq("public_url", r2.public_url);
      const pids = [
        ...new Set((grp ?? []).map((g)=>g.product_id).filter(Boolean))
      ];
      if (pids.length && plan.product_id && !pids.includes(plan.product_id)) return {
        error: `That creative belongs to a different product than this plan's (${plan.product_name}). Pick one from list_ad_creatives for that product.`
      };
      if (plan.asset_ids.length >= MAX_ADS) return {
        error: `A plan can hold at most ${MAX_ADS} creatives.`
      };
      plan.asset_ids.push(id);
      changes.push(`Creative ${id} added to the plan (use it in an ad set with ads=[{asset_id, copy_index}])`);
    }
    for (const [i, cp] of copyAdds.entries()){
      const pt = trunc(cp?.primary_text, 2000);
      if (pt.length < 30) return {
        error: `New copy ${i + 1}: primary_text must be at least 30 characters.`
      };
      if (plan.copies.length >= MAX_COPIES) return {
        error: `A plan holds at most ${MAX_COPIES} copy versions.`
      };
      plan.copies.push({
        primary_text: pt,
        headline: trunc(cp?.headline, 200),
        description: trunc(cp?.description, 200)
      });
      changes.push(`Copy ${plan.copies.length - 1} added (use copy_index ${plan.copies.length - 1} in ads)`);
    }
    for (const ed of copyEdits){
      const k = Math.round(Number(ed?.copy_index));
      if (!Number.isInteger(k) || k < 0 || k >= plan.copies.length) return {
        error: `copy_index must be a whole number from 0 to ${Math.max(plan.copies.length - 1, 0)}.`
      };
      const cp = plan.copies[k];
      if (has(ed?.primary_text)) {
        const pt = trunc(ed.primary_text, 2000);
        if (pt.length < 30) return {
          error: `Copy ${k}: primary_text must be at least 30 characters.`
        };
        cp.primary_text = pt;
      }
      if (has(ed?.headline)) cp.headline = trunc(ed.headline, 200);
      if (has(ed?.description)) cp.description = trunc(ed.description, 200);
      changes.push(`Copy ${k} rewritten`);
    }
    if (wantsAds) {
      const assetIds = plan.asset_ids.map(String);
      const nCopies = plan.copies.length;
      // Before the first per-ad-set choice, pin every ad set to the ads it has now, so a change for one ad set never changes another.
      plan.adsets = (Array.isArray(plan.adsets) ? plan.adsets : []).map((s)=>Array.isArray(s?.ad_numbers) && s.ad_numbers.length ? s : {
          ...s,
          ad_numbers: Array.from({
            length: before
          }, (_, k)=>k + 1)
        });
      for (const [i, s] of sets.entries()){
        if (!s || typeof s !== "object" || !Object.hasOwn(s, "ads") || s.remove === true) continue;
        if (i >= plan.adsets.length) return {
          error: `This plan has ${plan.adsets.length} ad set(s), so there is no ad set ${i + 1}.`
        };
        const list = (Array.isArray(s.ads) ? s.ads : []).slice(0, MAX_ADS).map(toPair);
        if (!list.length) return {
          error: `Ad set ${i + 1}: give at least one ad (a creative id and a copy_index), or remove the ad set.`
        };
        const nums = [];
        for (const p of list){
          if (!assetIds.includes(p.asset_id)) return {
            error: `Ad set ${i + 1}: that creative is not part of this plan. The plan's creatives are: ${assetIds.join(", ")}. Add a new one first with asset_ids_add.`
          };
          if (p.copy_index < 0 || p.copy_index >= nCopies) return {
            error: `Ad set ${i + 1}: copy_index must be between 0 and ${Math.max(nCopies - 1, 0)}. Add a new copy first with copies_add.`
          };
          let k = master.findIndex((m)=>m.asset_id === p.asset_id && m.copy_index === p.copy_index);
          if (k < 0) {
            if (master.length >= MAX_ADS) return {
              error: `A plan can hold at most ${MAX_ADS} different ads (creative + copy). Reuse one that is already in the plan.`
            };
            master.push(p);
            k = master.length - 1;
          }
          nums.push(k + 1);
        }
        plan.adsets[i] = {
          ...plan.adsets[i],
          ad_numbers: [
            ...new Set(nums)
          ]
        };
        changes.push(`Ad set ${i + 1} now runs ${[
          ...new Set(nums)
        ].length} ad(s)`);
      }
    }
    plan.ads = master;
    const { error } = await admin.from("ai_plans").update({
      plan
    }).eq("id", planId).eq("company_id", c.companyId);
    if (error) return {
      error: "Could not save the change to the draft: " + error.message
    };
  }
  // Special ad category of an existing draft: saved on the plan here; mcp-ads never sees it.
  const { special_ad_category: newCat, ...passThrough } = a;
  if (has(newCat)) {
    const cat = String(newCat).toUpperCase();
    if (!SPECIAL_CATS.includes(cat)) return {
      error: `special_ad_category must be one of ${SPECIAL_CATS.join(", ")}.`
    };
    const L0 = await loadPlan(planId, c);
    if (L0.error) return L0;
    if (L0.row.status !== "draft") return {
      error: "That draft plan was not found, or it can no longer be changed."
    };
    await admin.from("ai_plans").update({
      plan: {
        ...L0.row.plan,
        special_ad_category: cat
      }
    }).eq("id", planId).eq("company_id", c.companyId);
    changes.push(`Special ad category set to ${cat}`);
    if (!wants && !sets.length && Object.keys(passThrough).every((k)=>k === "plan_id")) {
      const L1 = await loadPlan(planId, c);
      return {
        ok: true,
        changes,
        ...L1.row ? await planView(L1.row, c) : {}
      };
    }
  }
  const out = await viaAds("update_plan", {
    ...passThrough,
    adsets: cleanSets(sets)
  }, c);
  if (!out || out.error || out.needs_info) return out;
  const dec = await decorate(out, c);
  if (!wants && !changes.length) return dec;
  const L = await loadPlan(planId, c);
  return {
    ...dec,
    changes,
    ...L.row ? {
      plan_now: await planView(L.row, c)
    } : {}
  };
}
// Currency, budget, country and city handling around the core update. ai-chat floors every budget it is given at 1500 naira, so for a plan in
// another currency the budget is kept away from it and written onto the plan afterwards. Naira plans without countries go through as before.
async function updatePlan(a, c) {
  if (!c?.companyId) return {
    error: "No company on this login yet."
  };
  const planId = String(a?.plan_id ?? "");
  const { budget_currency: bcur, ...a1 } = a ?? {};
  const sets = Array.isArray(a?.adsets) ? a.adsets : [];
  let row = null;
  if (UUID.test(planId)) {
    const r = await admin.from("ai_plans").select("plan, status, user_id").eq("id", planId).eq("company_id", c.companyId).maybeSingle();
    row = r.data;
  }
  const okRow = !!(row?.plan && row.status === "draft" && (row.user_id === c.userId || isAdmin(c)));
  if (!okRow) return updatePlanCore(a1, c);
  const pcur = String(row.plan.currency ?? "NGN").toUpperCase();
  const cur = pcur !== "NGN" ? pcur : "";
  const n0 = Array.isArray(row.plan.adsets) ? row.plan.adsets.length : 0;
  const wantsBudget = sets.some((s)=>s && typeof s === "object" && has(s.budget_naira));
  if (wantsBudget) {
    const bc = currencyMismatch(bcur, pcur, "plan");
    if (bc) return bc;
  }
  const real = [];
  const patch = [];
  const removed = [];
  for (const [i, s] of sets.entries()){
    const ok = s && typeof s === "object";
    removed[i] = !!(ok && s.remove === true && n0 > 1);
    patch[i] = {
      countries: ok && Array.isArray(s.countries) ? normCountries(s.countries) : null,
      cities: ok && Array.isArray(s.cities) ? normCities(s.cities) : null
    };
    if (cur && ok && has(s.budget_naira) && !removed[i]) {
      const b = Number(s.budget_naira);
      if (!(b >= 1) || b > MAX_FOREIGN_BUDGET) return {
        needs_info: true,
        message: `Ad set ${i + 1}: the daily budget must be between 1 and ${MAX_FOREIGN_BUDGET.toLocaleString("en-US")} ${cur}, stated by the person.`
      };
      real[i] = Math.round(b * 100) / 100;
    }
    if (ok && patch[i].countries && patch[i].countries.length > 1) {
      const planSet = (row.plan.adsets ?? [])[i] ?? {};
      const st = Array.isArray(s.states) ? s.states : planSet.states ?? [];
      const ct = patch[i].cities ?? planSet.cities ?? [];
      if (st.length || ct.length) return {
        needs_info: true,
        message: `Ad set ${i + 1} names states or cities but also several countries. Give exactly ONE country on that ad set, or remove the states and cities.`
      };
    }
  }
  const stripped = sets.map((s)=>{
    if (!s || typeof s !== "object") return s;
    const { countries: _c, cities: _ci, ...r } = s;
    if (cur) delete r.budget_naira;
    return r;
  });
  const out = await updatePlanCore({
    ...a1,
    ...Array.isArray(a?.adsets) ? {
      adsets: stripped
    } : {}
  }, c);
  if (!out || out.error || out.needs_info) return out;
  const touched = real.some((x)=>x !== undefined) || patch.some((p)=>p.countries || p.cities);
  const L = await loadPlan(planId, c);
  if (L.error || !L.row?.plan) return out;
  const plan = L.row.plan;
  if (touched) {
    const idx = [];
    let j = 0;
    for(let i = 0; i < n0; i++)idx[i] = removed[i] ? -1 : j++;
    const list = Array.isArray(plan.adsets) ? plan.adsets : [];
    for(let i = 0; i < sets.length && i < n0; i++){
      const t = idx[i];
      if (t === undefined || t < 0 || !list[t]) continue;
      const n = {
        ...list[t]
      };
      if (real[i] !== undefined) n.budget_naira = real[i];
      if (patch[i].countries) {
        if (patch[i].countries.length) n.countries = patch[i].countries;
        else delete n.countries;
      }
      if (patch[i].cities) n.cities = patch[i].cities;
      list[t] = n;
    }
    plan.adsets = list;
    const { error } = await admin.from("ai_plans").update({
      plan
    }).eq("id", planId).eq("company_id", c.companyId);
    if (error) return {
      error: "The draft was changed but its budget, countries or cities could not be saved: " + error.message + " Read it with get_plan and try again.",
      plan_id: planId
    };
  }
  const shaped = shapeOut(out, plan, cur);
  if (shaped.plan_now) shaped.plan_now = await planView({
    ...L.row,
    plan
  }, c);
  return shaped;
}
const playbook = async (_a, c)=>{
  const out = await viaAds("get_playbook", {}, c);
  return typeof out?.playbook === "string" ? {
    ...out,
    playbook: out.playbook + ADDENDUM
  } : out;
};
const RUN = {
  plan_campaign: planCampaign,
  update_plan: updatePlan,
  get_playbook: playbook,
  list_plans: listPlans,
  get_plan: getPlan,
  add_ad_set: addAdSet,
  search_locations: searchLocations,
  get_ads: getAds,
  edit_ad: editAd
};
const safeCall = async (tool, args, c)=>{
  try {
    if (tool !== "get_playbook" && !c?.companyId) return {
      error: "No company on this login yet."
    };
    return await RUN[tool](args, c);
  } catch (e) {
    return {
      error: e.message
    };
  }
};
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response(null, {
    status: 204,
    headers: CORS
  });
  if (!safeEqKey(req.headers.get("x-internal-key") ?? "", SERVICE_KEY)) return jres({
    error: "forbidden"
  }, 403);
  let b = {};
  try {
    b = await req.json();
  } catch  {
    return jres({
      error: "bad_request"
    }, 400);
  }
  if (b?.action === "list") {
    try {
      const j = await adsGroup({
        action: "list"
      });
      const tools = (Array.isArray(j?.tools) ? j.tools : []).filter((t)=>OVERRIDES.has(t?.name)).map(patchDef);
      return jres({
        group: "mcp-plan",
        tools: [
          ...tools,
          ...NEW_DEFS
        ]
      });
    } catch (e) {
      return jres({
        error: e.message
      }, 502);
    }
  }
  if (b?.action === "call") {
    const tool = String(b?.tool ?? "");
    if (!Object.hasOwn(RUN, tool)) return jres({
      error: "unknown_tool"
    }, 404);
    return jres({
      out: await safeCall(tool, b?.args && typeof b.args === "object" ? b.args : {}, b.ctx)
    });
  }
  return jres({
    error: "bad_action"
  }, 400);
});
