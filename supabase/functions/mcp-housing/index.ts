// Revora MCP tool group "mcp-housing": rental properties and rental applications.
// Same shape as the other groups: the `mcp` router calls { action: "list" } and { action: "call", tool, args, ctx } with x-internal-key.
// ALSO PUBLIC (no key, used by order.html / sales pages): actions public_list, public_states, public_property, public_track, public_submit.
// Public actions never return company ids and only touch available properties. Card details are never handled here: the fee is paid outside
// (bank transfer / payment link), then the owner marks it paid with housing_application_update.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const admin = createClient(SUPABASE_URL, SERVICE_KEY);
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-internal-key, apikey, x-client-info"
};
const jres = (obj, status = 200)=>new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS
    }
  });
// Any ISO 4217 currency can be used, so a project can match the country its ads run in.
const CURRENCIES = new Set("AED AFN ALL AMD AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BWP BYN BZD CAD CDF CHF CLP CNY COP CRC CZK DJF DKK DOP DZD EGP ETB EUR FJD GBP GEL GHS GMD GNF GTQ GYD HKD HNL HUF IDR ILS INR IQD ISK JMD JOD JPY KES KGS KHR KRW KWD KYD KZT LAK LBP LKR LRD LSL MAD MDL MGA MKD MMK MNT MOP MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SEK SGD SLE SOS SRD SZL THB TJS TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VND VUV WST XAF XCD XOF XPF YER ZAR ZMW".split(" "));
const cur = (v, dflt = "USD")=>{
  const c = String(v ?? "").trim().toUpperCase() || dflt;
  if (!CURRENCIES.has(c)) throw new Error(`Unsupported currency "${c}". Use a 3-letter ISO code such as USD, GBP, CAD, EUR, NGN, GHS, KES, ZAR, AUD.`);
  return c;
};
const obj = (properties, required = [])=>({
    type: "object",
    properties,
    required,
    additionalProperties: false
  });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v)=>typeof v === "string" && UUID.test(v);
const str = (v, max = 500)=>v == null ? null : String(v).trim().slice(0, max) || null;
const num = (v)=>v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null;
// Owners, admins and media buyers have full access to every housing tool. Customer care can review applications.
const WRITE_ROLES = [
  "owner",
  "admin",
  "buyer"
];
const PROPERTY_ROLES = [
  "owner",
  "admin",
  "buyer"
];
const REVIEW_ROLES = [
  "owner",
  "admin",
  "buyer",
  "customer_care"
];
const need = (c, roles)=>{
  if (!roles.includes(c.role)) throw new Error("Your role can't do this. Ask the account owner.");
};
const PROP_FIELDS = [
  "title",
  "slug",
  "description",
  "state",
  "city",
  "address",
  "postal_code",
  "property_type",
  "monthly_rent",
  "currency",
  "bedrooms",
  "bathrooms",
  "sqft",
  "images",
  "availability",
  "available_from",
  "application_fee",
  "fee_disclosure",
  "application_url",
  "pet_policy",
  "parking",
  "amenities",
  "deposit",
  "lease_term",
  "extra",
  "sort_order"
];
const PUBLIC_PROP = "id, product_id, title, slug, description, state, city, address, postal_code, property_type, monthly_rent, currency, bedrooms, bathrooms, sqft, images, availability, available_from, application_fee, fee_disclosure, application_url, pet_policy, parking, amenities, deposit, lease_term, extra, sort_order";
async function ownProduct(c, id) {
  if (!isId(id)) throw new Error("product_id is required (a housing project id).");
  const { data } = await admin.from("products").select("id, product_name, product_type, currency, housing_settings").eq("id", id).eq("company_id", c.companyId).maybeSingle();
  if (!data) throw new Error("Project not found in your account.");
  if (data.product_type !== "housing") throw new Error("That product is not a housing project. Use housing_project_save to make it one.");
  return data;
}
function cleanProp(a, projectCurrency, isNew) {
  const o = {};
  for (const k of PROP_FIELDS)if (a[k] !== undefined) o[k] = a[k];
  if (o.title !== undefined) o.title = str(o.title, 200);
  if (isNew && !o.title) throw new Error("title is required.");
  if (o.state !== undefined) o.state = str(o.state, 80);
  if (isNew && !o.state) throw new Error("state is required (it groups the listing on state pages).");
  if (isNew && num(o.monthly_rent) == null) throw new Error("monthly_rent is required.");
  for (const k of [
    "monthly_rent",
    "application_fee",
    "deposit",
    "bedrooms",
    "bathrooms"
  ])if (o[k] !== undefined) {
    const n = num(o[k]);
    if (n != null && n < 0) throw new Error(`${k} cannot be negative.`);
    o[k] = n;
  }
  if (o.sqft !== undefined) o.sqft = num(o.sqft) == null ? null : Math.round(num(o.sqft));
  if (o.currency !== undefined || isNew) o.currency = cur(o.currency, projectCurrency);
  if (o.availability !== undefined && ![
    "available",
    "pending",
    "rented",
    "hidden"
  ].includes(o.availability)) throw new Error("availability must be available, pending, rented or hidden.");
  for (const k of [
    "images",
    "amenities"
  ])if (o[k] !== undefined && !Array.isArray(o[k])) throw new Error(`${k} must be a list.`);
  if (o.images) o.images = o.images.map((u)=>String(u)).filter((u)=>/^https:\/\//i.test(u)).slice(0, 30);
  for (const k of [
    "description",
    "address",
    "city",
    "postal_code",
    "property_type",
    "fee_disclosure",
    "application_url",
    "pet_policy",
    "parking",
    "lease_term",
    "slug"
  ])if (o[k] !== undefined) o[k] = str(o[k], 2000);
  if (o.slug) o.slug = String(o.slug).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  o.updated_at = new Date().toISOString();
  return o;
}
const TOOLS = [
  {
    name: "housing_project_save",
    title: "Create or update a housing project",
    write: true,
    description: "Create a Housing project (a product of type housing that holds many properties) or update one. Set currency to the 3-letter code of the country the ads run in (USD, GBP, CAD, EUR, NGN, GHS, KES, ZAR, AUD...). contact_phone is the call/text number shown on the thank-you page; payment_instructions is the text telling applicants how to pay the application fee. Bank details and a payment link are optional. PUTTING THE APPLICATION ON A SALES PAGE: the rental application is already built into the platform. Add <div data-rv-form></div> where the application should appear on the page and point the page's Apply buttons to that spot (e.g. #application). Never build your own application form or a 'setup pending' placeholder.",
    inputSchema: obj({
      product_id: {
        type: "string"
      },
      name: {
        type: "string"
      },
      currency: {
        type: "string",
        description: "ISO code, e.g. USD"
      },
      ads_country: {
        type: "string",
        description: "Country the ads run in, e.g. United States"
      },
      contact_phone: {
        type: "string"
      },
      payment_instructions: {
        type: "string"
      },
      payment_link_url: {
        type: "string"
      },
      bank_name: {
        type: "string"
      },
      bank_account_number: {
        type: "string"
      },
      bank_account_name: {
        type: "string"
      }
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    run: async (a, c)=>{
      need(c, WRITE_ROLES);
      const currency = a.currency !== undefined ? cur(a.currency) : undefined;
      const settingsPatch = {};
      if (a.ads_country !== undefined) settingsPatch.ads_country = str(a.ads_country, 80);
      if (a.contact_phone !== undefined) settingsPatch.contact_phone = str(a.contact_phone, 40);
      if (currency) settingsPatch.currency = currency;
      const cols = {};
      if (currency) cols.currency = currency;
      if (a.payment_instructions !== undefined) cols.payment_note = str(a.payment_instructions, 2000);
      for (const k of [
        "payment_link_url",
        "bank_name",
        "bank_account_number",
        "bank_account_name"
      ])if (a[k] !== undefined) cols[k] = str(a[k], 300);
      if (a.name !== undefined) cols.product_name = str(a.name, 200);
      if (a.product_id) {
        if (!isId(a.product_id)) throw new Error("product_id is not valid.");
        const { data: p } = await admin.from("products").select("id, housing_settings").eq("id", a.product_id).eq("company_id", c.companyId).maybeSingle();
        if (!p) throw new Error("Product not found in your account.");
        const { error } = await admin.from("products").update({
          ...cols,
          product_type: "housing",
          is_service: true,
          housing_settings: {
            ...p.housing_settings ?? {},
            ...settingsPatch
          }
        }).eq("id", p.id);
        if (error) throw new Error(error.message);
        return {
          ok: true,
          product_id: p.id,
          note: "Housing project updated."
        };
      }
      if (!cols.product_name) throw new Error("name is required to create a housing project.");
      // A media buyer owns the projects they create (same as create_product), so they can upload pictures and build pages for it.
      const { data, error } = await admin.from("products").insert({
        ...cols,
        currency: currency ?? "USD",
        company_id: c.companyId,
        created_by: c.userId,
        media_buyer_id: c.role === "buyer" ? c.mediaBuyerId : null,
        product_type: "housing",
        is_service: true,
        destination_type: "website",
        housing_settings: {
          currency: currency ?? "USD",
          ...settingsPatch
        }
      }).select("id").single();
      if (error) throw new Error(error.message);
      return {
        ok: true,
        product_id: data.id,
        note: "Housing project created. Add properties with housing_property_save. To show the rental application on a sales page, put <div data-rv-form></div> in the page (do not build your own form)."
      };
    }
  },
  {
    name: "housing_property_save",
    title: "Add or update a property listing",
    write: true,
    description: "Add a property to a housing project, or update one by id. One project can hold many properties. Rent and application fee are in the property's currency (defaults to the project's currency). Photos must be https image links; sending images replaces the whole photo list. availability: available, pending, rented or hidden (hidden listings are not shown publicly). application_fee 0 means no fee. Put any legally required fee notice in fee_disclosure. PUTTING THE APPLICATION ON A SALES PAGE: to open this listing's application on a page, add <div data-rv-form data-rv-property=\"<slug>\"></div> using the property's slug and point the page's Apply buttons to that div (e.g. #application). Without data-rv-property, a project with one property opens it directly and a project with several shows a picker. Ad links can also carry ?property=<slug>. Never build your own application form or a 'setup pending' placeholder; the platform provides it.",
    inputSchema: obj({
      id: {
        type: "string",
        description: "Property id to update; omit to create"
      },
      product_id: {
        type: "string"
      },
      title: {
        type: "string"
      },
      slug: {
        type: "string"
      },
      description: {
        type: "string"
      },
      state: {
        type: "string"
      },
      city: {
        type: "string"
      },
      address: {
        type: "string"
      },
      postal_code: {
        type: "string"
      },
      property_type: {
        type: "string"
      },
      monthly_rent: {
        type: "number"
      },
      currency: {
        type: "string"
      },
      bedrooms: {
        type: "number"
      },
      bathrooms: {
        type: "number"
      },
      sqft: {
        type: "number"
      },
      images: {
        type: "array",
        items: {
          type: "string"
        }
      },
      availability: {
        type: "string"
      },
      available_from: {
        type: "string"
      },
      application_fee: {
        type: "number"
      },
      fee_disclosure: {
        type: "string"
      },
      application_url: {
        type: "string"
      },
      pet_policy: {
        type: "string"
      },
      parking: {
        type: "string"
      },
      amenities: {
        type: "array",
        items: {
          type: "string"
        }
      },
      deposit: {
        type: "number"
      },
      lease_term: {
        type: "string"
      },
      extra: {
        type: "object"
      },
      sort_order: {
        type: "number"
      }
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    run: async (a, c)=>{
      need(c, PROPERTY_ROLES);
      if (a.id) {
        if (!isId(a.id)) throw new Error("id is not valid.");
        const { data: cur0 } = await admin.from("properties").select("id, product_id").eq("id", a.id).eq("company_id", c.companyId).maybeSingle();
        if (!cur0) throw new Error("Property not found in your account.");
        const prod = await ownProduct(c, cur0.product_id);
        const o = cleanProp(a, prod.currency ?? "USD", false);
        const { error } = await admin.from("properties").update(o).eq("id", a.id).eq("company_id", c.companyId);
        if (error) throw new Error(error.message);
        return {
          ok: true,
          id: a.id,
          note: "Property updated."
        };
      }
      const prod = await ownProduct(c, a.product_id);
      const o = cleanProp(a, prod.currency ?? "USD", true);
      const { data, error } = await admin.from("properties").insert({
        ...o,
        company_id: c.companyId,
        product_id: prod.id
      }).select("id, slug").single();
      if (error) throw new Error(error.message);
      return {
        ok: true,
        id: data.id,
        slug: data.slug,
        note: "Property added. To put its application on a sales page, add <div data-rv-form data-rv-property=\"" + (data.slug ?? "slug") + "\"></div> to the page (do not build your own form)."
      };
    }
  },
  {
    name: "housing_properties_list",
    title: "List properties",
    description: "List the properties in your housing projects, optionally for one project, state or availability. Includes how many applications each has.",
    inputSchema: obj({
      product_id: {
        type: "string"
      },
      state: {
        type: "string"
      },
      availability: {
        type: "string"
      },
      limit: {
        type: "number"
      }
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    run: async (a, c)=>{
      let q = admin.from("properties").select("*").eq("company_id", c.companyId).order("state").order("sort_order").limit(Math.min(Number(a.limit) || 100, 300));
      if (a.product_id) {
        if (!isId(a.product_id)) throw new Error("product_id is not valid.");
        q = q.eq("product_id", a.product_id);
      }
      if (a.state) q = q.ilike("state", String(a.state));
      if (a.availability) q = q.eq("availability", a.availability);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const ids = (data ?? []).map((p)=>p.id);
      const counts = {};
      if (ids.length) {
        const { data: ap } = await admin.from("applications").select("property_id").eq("company_id", c.companyId).in("property_id", ids).limit(5000);
        for (const r of ap ?? [])counts[r.property_id] = (counts[r.property_id] ?? 0) + 1;
      }
      return {
        count: (data ?? []).length,
        properties: (data ?? []).map((p)=>({
            ...p,
            applications: counts[p.id] ?? 0
          }))
      };
    }
  },
  {
    name: "housing_applications_list",
    title: "List rental applications",
    description: "List rental applications, newest first. Filter by project, property, state, fee_status (unpaid, paid, waived, refunded) or review_status (submitted, under_review, approved, declined).",
    inputSchema: obj({
      product_id: {
        type: "string"
      },
      property_id: {
        type: "string"
      },
      state: {
        type: "string"
      },
      fee_status: {
        type: "string"
      },
      review_status: {
        type: "string"
      },
      limit: {
        type: "number"
      }
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    run: async (a, c)=>{
      need(c, REVIEW_ROLES);
      let q = admin.from("applications").select("id, ref, product_id, property_id, applicant_name, applicant_email, applicant_phone, desired_move_in, occupants, answers, payment_method, fee_amount, currency, fee_status, review_status, payment_note, paid_at, possible_duplicate, emailed_at, email_error, created_at, properties(title, state, city, monthly_rent)").eq("company_id", c.companyId).order("created_at", {
        ascending: false
      }).limit(Math.min(Number(a.limit) || 50, 200));
      for (const k of [
        "product_id",
        "property_id"
      ])if (a[k]) {
        if (!isId(a[k])) throw new Error(`${k} is not valid.`);
        q = q.eq(k, a[k]);
      }
      if (a.fee_status) q = q.eq("fee_status", a.fee_status);
      if (a.review_status) q = q.eq("review_status", a.review_status);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      let rows = data ?? [];
      if (a.state) rows = rows.filter((r)=>String(r.properties?.state ?? "").toLowerCase() === String(a.state).toLowerCase());
      return {
        count: rows.length,
        applications: rows
      };
    }
  },
  {
    name: "housing_application_update",
    title: "Update an application",
    write: true,
    description: "Review an application or record the fee. Identify it by id or ref (e.g. APP-00012). Set fee_status to paid after the applicant sent their receipt, review_status to under_review, approved or declined, and optionally add a payment_note.",
    inputSchema: obj({
      id: {
        type: "string"
      },
      ref: {
        type: "string"
      },
      fee_status: {
        type: "string"
      },
      review_status: {
        type: "string"
      },
      payment_note: {
        type: "string"
      }
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    run: async (a, c)=>{
      need(c, REVIEW_ROLES);
      let q = admin.from("applications").select("id, product_id, property_id, fee_status").eq("company_id", c.companyId);
      if (a.id && isId(a.id)) q = q.eq("id", a.id);
      else if (a.ref) q = q.eq("ref", String(a.ref).toUpperCase());
      else throw new Error("Give the application id or ref.");
      const { data: ap } = await q.maybeSingle();
      if (!ap) throw new Error("Application not found in your account.");
      const o = {
        updated_at: new Date().toISOString()
      };
      if (a.fee_status !== undefined) {
        if (![
          "unpaid",
          "paid",
          "waived",
          "refunded"
        ].includes(a.fee_status)) throw new Error("fee_status must be unpaid, paid, waived or refunded.");
        o.fee_status = a.fee_status;
        o.paid_at = a.fee_status === "paid" ? new Date().toISOString() : null;
      }
      if (a.review_status !== undefined) {
        if (![
          "submitted",
          "under_review",
          "approved",
          "declined"
        ].includes(a.review_status)) throw new Error("review_status must be submitted, under_review, approved or declined.");
        o.review_status = a.review_status;
      }
      if (a.payment_note !== undefined) o.payment_note = str(a.payment_note, 1000);
      const { error } = await admin.from("applications").update(o).eq("id", ap.id);
      if (error) throw new Error(error.message);
      if (o.fee_status === "paid" && ap.fee_status !== "paid") await admin.from("housing_events").insert({
        company_id: c.companyId,
        product_id: ap.product_id,
        property_id: ap.property_id,
        application_id: ap.id,
        event: "fee_paid"
      });
      return {
        ok: true,
        id: ap.id
      };
    }
  },
  {
    name: "housing_stats",
    title: "Housing dashboard numbers",
    description: "Totals for housing: properties, applications, fees collected (per currency), applications to review, plus property views, application starts and submissions over the last N days (default 30), and applications by state.",
    inputSchema: obj({
      product_id: {
        type: "string"
      },
      days: {
        type: "number"
      }
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    run: async (a, c)=>{
      need(c, REVIEW_ROLES);
      const days = Math.min(Math.max(Number(a.days) || 30, 1), 365);
      const since = new Date(Date.now() - days * 86400000).toISOString();
      const pf = (q)=>a.product_id && isId(a.product_id) ? q.eq("product_id", a.product_id) : q;
      const [props, apps, evs] = await Promise.all([
        pf(admin.from("properties").select("id, availability").eq("company_id", c.companyId)).limit(5000),
        pf(admin.from("applications").select("fee_amount, currency, fee_status, review_status, properties(state)").eq("company_id", c.companyId)).limit(10000),
        pf(admin.from("housing_events").select("event").eq("company_id", c.companyId).gte("created_at", since)).limit(50000)
      ]);
      const P = props.data ?? [], A = apps.data ?? [], E = evs.data ?? [];
      const fees = {};
      const byState = {};
      for (const r of A){
        if (r.fee_status === "paid") fees[r.currency] = (fees[r.currency] ?? 0) + Number(r.fee_amount);
        const s = r.properties?.state ?? "Unknown";
        byState[s] = (byState[s] ?? 0) + 1;
      }
      const ev = (n)=>E.filter((x)=>x.event === n).length;
      return {
        properties: P.length,
        available: P.filter((p)=>p.availability === "available").length,
        applications: A.length,
        to_review: A.filter((r)=>r.review_status === "submitted" || r.review_status === "under_review").length,
        unpaid_fees: A.filter((r)=>r.fee_status === "unpaid").length,
        fees_collected: fees,
        applications_by_state: byState,
        last_days: days,
        property_views: ev("property_view"),
        application_starts: ev("application_start"),
        submissions: ev("application_submit"),
        fees_paid: ev("fee_paid"),
        tour_requests: ev("tour_request")
      };
    }
  },
  {
    name: "housing_tours_list",
    title: "List tour requests",
    description: "List tour requests, newest first. Filter by project, property, status (requested, confirmed, completed, no_show, cancelled) or from_date (YYYY-MM-DD, the tour day).",
    inputSchema: obj({
      product_id: {
        type: "string"
      },
      property_id: {
        type: "string"
      },
      status: {
        type: "string"
      },
      from_date: {
        type: "string"
      },
      limit: {
        type: "number"
      }
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    run: async (a, c)=>{
      need(c, REVIEW_ROLES);
      let q = admin.from("tours").select("id, ref, product_id, property_id, visitor_name, visitor_phone, visitor_email, tour_date, tour_time, notes, status, possible_duplicate, emailed_at, email_error, created_at, properties(title, state, city, address)").eq("company_id", c.companyId).order("tour_date", {
        ascending: true
      }).order("tour_time", {
        ascending: true
      }).limit(Math.min(Number(a.limit) || 50, 200));
      for (const k of [
        "product_id",
        "property_id"
      ])if (a[k]) {
        if (!isId(a[k])) throw new Error(`${k} is not valid.`);
        q = q.eq(k, a[k]);
      }
      if (a.status) q = q.eq("status", a.status);
      if (a.from_date) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(a.from_date))) throw new Error("from_date must look like 2026-11-22.");
        q = q.gte("tour_date", a.from_date);
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return {
        count: (data ?? []).length,
        tours: data ?? []
      };
    }
  },
  {
    name: "housing_tour_update",
    title: "Update a tour request",
    write: true,
    description: "Confirm, complete or cancel a tour. Identify it by id or ref (e.g. TOUR-00012). status is requested, confirmed, completed, no_show or cancelled.",
    inputSchema: obj({
      id: {
        type: "string"
      },
      ref: {
        type: "string"
      },
      status: {
        type: "string"
      }
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    run: async (a, c)=>{
      need(c, REVIEW_ROLES);
      let q = admin.from("tours").select("id").eq("company_id", c.companyId);
      if (a.id && isId(a.id)) q = q.eq("id", a.id);
      else if (a.ref) q = q.eq("ref", String(a.ref).toUpperCase());
      else throw new Error("Give the tour id or ref.");
      const { data: t } = await q.maybeSingle();
      if (!t) throw new Error("Tour not found in your account.");
      if (![
        "requested",
        "confirmed",
        "completed",
        "no_show",
        "cancelled"
      ].includes(a.status)) throw new Error("status must be requested, confirmed, completed, no_show or cancelled.");
      const { error } = await admin.from("tours").update({
        status: a.status,
        updated_at: new Date().toISOString()
      }).eq("id", t.id);
      if (error) throw new Error(error.message);
      return {
        ok: true,
        id: t.id
      };
    }
  }
];
const BY_NAME = new Map(TOOLS.map((t)=>[
    t.name,
    t
  ]));
// ---------- public actions (order.html / listing pages) ----------
async function publicProject(productId) {
  if (!isId(productId)) throw new Error("bad_product");
  const { data } = await admin.from("products").select("id, company_id, product_name, product_type, currency, housing_settings, bank_name, bank_account_number, bank_account_name, payment_note, payment_link_url").eq("id", productId).eq("product_type", "housing").maybeSingle();
  if (!data) throw new Error("not_found");
  return data;
}
const SSN = /\b\d{3}-?\d{2}-?\d{4}\b/;
function sanitizeAnswers(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out = {};
  for (const [k, val] of Object.entries(v).slice(0, 60)){
    const s = typeof val === "string" ? val.slice(0, 1000) : Array.isArray(val) ? val.map((x)=>String(x).slice(0, 200)).slice(0, 30) : typeof val === "number" || typeof val === "boolean" ? val : null;
    if (s == null) continue;
    if (JSON.stringify(s).match(SSN)) throw new Error("Please don't enter Social Security numbers or similar IDs here. The property manager will collect those through a secure screening step.");
    out[String(k).slice(0, 80)] = s;
  }
  return out;
}
async function publicAction(b) {
  const act = String(b.action);
  if (act === "public_list" || act === "public_states") {
    const p = await publicProject(b.product_id);
    let q = admin.from("properties").select(PUBLIC_PROP).eq("product_id", p.id).eq("availability", "available").order("sort_order").limit(300);
    if (act === "public_list" && b.state) q = q.ilike("state", String(b.state).slice(0, 80));
    const { data } = await q;
    const rows = data ?? [];
    if (act === "public_states") {
      const m = {};
      for (const r of rows)m[r.state] = (m[r.state] ?? 0) + 1;
      return {
        project: {
          id: p.id,
          name: p.product_name,
          currency: p.currency
        },
        states: Object.entries(m).map(([state, count])=>({
            state,
            count
          })).sort((x, y)=>x.state.localeCompare(y.state))
      };
    }
    return {
      project: {
        id: p.id,
        name: p.product_name,
        currency: p.currency,
        flow: flowOf(p),
        hero: typeof p.housing_settings?.hero_image === "string" && /^https:\/\//i.test(p.housing_settings.hero_image) ? p.housing_settings.hero_image : null
      },
      properties: rows
    };
  }
  if (act === "public_property") {
    const p = await publicProject(b.product_id);
    let q = admin.from("properties").select(PUBLIC_PROP).eq("product_id", p.id).neq("availability", "hidden");
    if (isId(b.property_id)) q = q.eq("id", b.property_id);
    else if (b.slug) q = q.eq("slug", String(b.slug).slice(0, 120));
    else throw new Error("property_id or slug required");
    const { data } = await q.maybeSingle();
    if (!data) throw new Error("not_found");
    return {
      project: {
        id: p.id,
        name: p.product_name,
        currency: p.currency,
        contact_phone: p.housing_settings?.contact_phone ?? null,
        flow: flowOf(p)
      },
      property: data
    };
  }
  if (act === "public_track") {
    if (![
      "property_view",
      "application_start"
    ].includes(b.event)) throw new Error("bad_event");
    const p = await publicProject(b.product_id);
    let state = null;
    let pid = null;
    if (isId(b.property_id)) {
      const { data } = await admin.from("properties").select("id, state").eq("id", b.property_id).eq("product_id", p.id).maybeSingle();
      if (data) {
        pid = data.id;
        state = data.state;
      }
    }
    await admin.from("housing_events").insert({
      company_id: p.company_id,
      product_id: p.id,
      property_id: pid,
      site_id: isId(b.site_id) ? b.site_id : null,
      event: b.event,
      state
    });
    return {
      ok: true
    };
  }
  if (act === "public_submit") {
    const p = await publicProject(b.product_id);
    if (!isId(b.property_id)) throw new Error("Please choose a property.");
    const { data: prop } = await admin.from("properties").select("id, title, state, monthly_rent, currency, application_fee, fee_disclosure, availability").eq("id", b.property_id).eq("product_id", p.id).maybeSingle();
    if (!prop || prop.availability !== "available") throw new Error("Sorry, this property is no longer available for applications.");
    const name = str(b.applicant_name, 200);
    const email = str(b.applicant_email, 200)?.toLowerCase() ?? null;
    const phone = str(b.applicant_phone, 40);
    if (!name) throw new Error("Full name is required.");
    if (!email && !phone) throw new Error("An email or phone number is required.");
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("That email address doesn't look right.");
    const answers = sanitizeAnswers(b.answers);
    const eventId = str(b.event_id, 120);
    if (eventId) {
      const { data: ex } = await admin.from("applications").select("ref").eq("event_id", eventId).maybeSingle();
      if (ex) return thanks(p, prop, ex.ref, str(b.payment_method, 60));
    }
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    let dupQ = admin.from("applications").select("id").eq("property_id", prop.id).gte("created_at", since).order("created_at").limit(1);
    dupQ = email && phone ? dupQ.or(`applicant_email.eq.${email},applicant_phone.eq.${phone}`) : email ? dupQ.eq("applicant_email", email) : dupQ.eq("applicant_phone", phone);
    const { data: dup } = await dupQ;
    const ins = {
      company_id: p.company_id,
      product_id: p.id,
      property_id: prop.id,
      site_id: isId(b.site_id) ? b.site_id : null,
      site_page_id: isId(b.site_page_id) ? b.site_page_id : null,
      applicant_name: name,
      applicant_email: email,
      applicant_phone: phone,
      desired_move_in: /^\d{4}-\d{2}-\d{2}$/.test(String(b.desired_move_in ?? "")) ? b.desired_move_in : null,
      occupants: num(b.occupants) == null ? null : Math.max(1, Math.min(30, Math.round(num(b.occupants)))),
      answers,
      payment_method: str(b.payment_method, 60),
      fee_amount: prop.application_fee ?? 0,
      currency: prop.currency,
      fee_status: Number(prop.application_fee) > 0 ? "unpaid" : "waived",
      possible_duplicate: !!dup?.length,
      duplicate_of: dup?.[0]?.id ?? null,
      event_id: eventId,
      fbclid: str(b.fbclid, 300)
    };
    const { data: row, error } = await admin.from("applications").insert(ins).select("id, ref").single();
    if (error) throw new Error("We couldn't save your application. Please try again.");
    await admin.from("housing_events").insert({
      company_id: p.company_id,
      product_id: p.id,
      property_id: prop.id,
      application_id: row.id,
      site_id: ins.site_id,
      event: "application_submit",
      state: prop.state
    });
    const out = thanks(p, prop, row.ref, ins.payment_method);
    out.emailed = Boolean(email && RESEND_API_KEY && RESEND_FROM);
    if (email) queueApplicationEmail(p, prop, row, name, email, out);
    return out;
  }
  if (act === "public_tour_slots") {
    const p = await publicProject(b.product_id);
    if (!isId(b.property_id)) throw new Error("Please choose a property.");
    const { data: prop } = await admin.from("properties").select("id, availability").eq("id", b.property_id).eq("product_id", p.id).maybeSingle();
    if (!prop || prop.availability !== "available") throw new Error("Sorry, this property is no longer available for tours.");
    const cfg = tourConfig(p);
    const days = tourDays(cfg);
    const { data: taken } = await admin.from("tours").select("tour_date, tour_time").eq("property_id", prop.id).in("status", ["requested", "confirmed"]).gte("tour_date", days[0] ?? "9999-01-01").lte("tour_date", days[days.length - 1] ?? "0001-01-01");
    const count = {};
    for (const r of taken ?? []) count[`${r.tour_date} ${r.tour_time}`] = (count[`${r.tour_date} ${r.tour_time}`] ?? 0) + 1;
    return {
      ok: true,
      slots: cfg.slots,
      capacity: cfg.capacity,
      days: days.map((d)=>({
          date: d,
          times: cfg.slots.map((t)=>({
              time: t,
              full: (count[`${d} ${t}`] ?? 0) >= cfg.capacity
            }))
        })),
      contact_phone: p.housing_settings?.contact_phone ?? null
    };
  }
  if (act === "public_tour") {
    const p = await publicProject(b.product_id);
    if (!isId(b.property_id)) throw new Error("Please choose a property.");
    const { data: prop } = await admin.from("properties").select("id, title, slug, address, city, state, availability, application_fee, currency").eq("id", b.property_id).eq("product_id", p.id).maybeSingle();
    if (!prop || prop.availability !== "available") throw new Error("Sorry, this property is no longer available for tours.");
    const name = str(b.visitor_name, 200);
    const email = str(b.visitor_email, 200)?.toLowerCase() ?? null;
    const phone = str(b.visitor_phone, 40);
    if (!name) throw new Error("Please enter your name.");
    if (!phone) throw new Error("Please enter a phone number so we can confirm your tour.");
    if (phone.replace(/\D/g, "").length < 10) throw new Error("Please enter a valid phone number.");
    if (!email) throw new Error("Please enter your email so we can send your confirmation and the link to apply.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("That email address doesn't look right.");
    const cfg = tourConfig(p);
    const date = String(b.tour_date ?? "");
    const time = String(b.tour_time ?? "");
    if (!tourDays(cfg).includes(date) || !cfg.slots.includes(time)) throw new Error("That time isn't available. Please pick another.");
    const eventId = str(b.event_id, 120);
    if (eventId) {
      const { data: ex } = await admin.from("tours").select("ref, tour_date, tour_time").eq("event_id", eventId).maybeSingle();
      if (ex) return tourThanks(p, prop, ex.ref, ex.tour_date, ex.tour_time);
    }
    const { count: used } = await admin.from("tours").select("id", { count: "exact", head: true }).eq("property_id", prop.id).eq("tour_date", date).eq("tour_time", time).in("status", ["requested", "confirmed"]);
    if ((used ?? 0) >= cfg.capacity) throw new Error("Sorry, that time was just taken. Please pick another.");
    const since = new Date(Date.now() - 14 * 86400000).toISOString();
    const { data: dup } = await admin.from("tours").select("id").eq("property_id", prop.id).eq("visitor_phone", phone).gte("created_at", since).in("status", ["requested", "confirmed"]).limit(1);
    const { data: row, error } = await admin.from("tours").insert({
      company_id: p.company_id,
      product_id: p.id,
      property_id: prop.id,
      site_id: isId(b.site_id) ? b.site_id : null,
      site_page_id: isId(b.site_page_id) ? b.site_page_id : null,
      visitor_name: name,
      visitor_phone: phone,
      visitor_email: email,
      tour_date: date,
      tour_time: time,
      notes: str(b.notes, 500),
      possible_duplicate: !!dup?.length,
      event_id: eventId,
      fbclid: str(b.fbclid, 300)
    }).select("id, ref").single();
    if (error) throw new Error("We couldn't save your tour request. Please try again.");
    await admin.from("housing_events").insert({
      company_id: p.company_id,
      product_id: p.id,
      property_id: prop.id,
      site_id: isId(b.site_id) ? b.site_id : null,
      event: "tour_request",
      state: prop.state
    });
    queueTourEmail(p, prop, row, name, email, date, time);
    return tourThanks(p, prop, row.ref, date, time);
  }
  throw new Error("bad_action");
}
// What visitors can do on the site: "both" (tour, then apply), "tour" (tour only) or "apply" (apply only). Set in Dashboard > Housing > Settings.
function flowOf(p) {
  const f = p.housing_settings?.flow;
  return f === "tour" || f === "apply" ? f : "both";
}
// ---------- tours: fixed slots ----------
// Project settings (products.housing_settings.tour) are all optional.
function tourConfig(p) {
  const t = p.housing_settings?.tour ?? {};
  const slots = (Array.isArray(t.slots) ? t.slots : [
    "10:00",
    "12:00",
    "14:00",
    "16:00"
  ]).map(String).filter((s)=>/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(s)).slice(0, 24).sort();
  return {
    slots: slots.length ? slots : [
      "10:00",
      "12:00",
      "14:00",
      "16:00"
    ],
    days: Array.isArray(t.days) && t.days.length ? t.days.map(Number).filter((d)=>d >= 0 && d <= 6) : [
      0,
      1,
      2,
      3,
      4,
      5,
      6
    ],
    advance_days: Math.min(Math.max(Number(t.advance_days) || 14, 1), 60),
    // 0 means "no limit": any time slot can take unlimited bookings.
    capacity: Number(t.capacity) === 0 ? 1000000 : Math.min(Math.max(Number(t.capacity) || 2, 1), 1000000)
  };
}
// Calendar days (YYYY-MM-DD) a visitor may book, starting tomorrow (so a same-day request never lands on a slot that has passed).
// Days are counted on the UTC calendar; the visitor's date picker uses the same list, so the two always agree.
function tourDays(cfg) {
  const out = [];
  const now = new Date();
  for(let i = 1; i <= cfg.advance_days; i++){
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + i));
    if (cfg.days.includes(d.getUTCDay())) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
// ---------- tour confirmation email (with the link to apply) ----------
// Needs two secrets on the project: RESEND_API_KEY and RESEND_FROM_EMAIL (an address on a domain verified in Resend,
// for example "SC Rentals <tours@yourdomain.com>"). Without them nothing is sent and the tour is flagged "email_not_configured".
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const RESEND_FROM = Deno.env.get("RESEND_FROM_EMAIL") ?? "";
const escH = (s)=>String(s ?? "").replace(/[&<>"']/g, (c)=>({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[c]);
function longDate(d, t) {
  const [y, m, dd] = String(d).split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, dd, 12)).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC"
  });
  const h = Number(String(t).slice(0, 2));
  return `${day} at ${h % 12 || 12}:${String(t).slice(3, 5)} ${h < 12 ? "AM" : "PM"}`;
}
// Where the public site lives: housing_settings.site_url if the owner set it, otherwise the published site's own address.
async function siteBase(p) {
  const s = p.housing_settings?.site_url;
  if (typeof s === "string" && /^https:\/\//i.test(s)) return s.replace(/\/+$/, "");
  const { data: site } = await admin.from("sites").select("id, slug").eq("company_id", p.company_id).eq("product_id", p.id).eq("status", "published").limit(1).maybeSingle();
  if (!site) return null;
  const { data: doms } = await admin.from("site_domains").select("hostname, site_id").eq("company_id", p.company_id).eq("status", "active");
  const d = (doms ?? []).find((x)=>x.site_id === site.id) ?? (doms ?? [])[0];
  if (d) return `https://${d.hostname}${d.site_id === site.id ? "" : `/s/${site.slug}`}`;
  return `https://revora-sites.vercel.app/s/${site.slug}`;
}
async function sendTourEmail(p, prop, row, name, email, date, time) {
  if (!RESEND_API_KEY || !RESEND_FROM) {
    await admin.from("tours").update({
      email_error: "email_not_configured"
    }).eq("id", row.id);
    return;
  }
  const s = p.housing_settings ?? {};
  const brand = String(s.brand || "SC Rentals");
  const base = await siteBase(p);
  const apply = base && prop.slug ? `${base}/home?property=${encodeURIComponent(prop.slug)}&apply=1#application` : null;
  const fee = Number(prop.application_fee) || 0;
  const where = [
    prop.address,
    prop.city,
    prop.state
  ].filter(Boolean).join(", ");
  const money = (n)=>`$${Number(n).toLocaleString("en-US")}`;
  const html = `<div style="background:#f5f6f8;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e5e8ee">
<div style="background:#0f2742;color:#fff;padding:20px 24px;font-size:18px;font-weight:700">${escH(brand)}</div>
<div style="padding:26px 24px">
<h1 style="margin:0 0 8px;font-size:22px;color:#0b1220">Your tour request is in, ${escH(String(name).split(" ")[0])}.</h1>
<p style="margin:0 0 18px;color:#475569;line-height:1.55">We have your request and will confirm it shortly.</p>
<div style="background:#f5f6f8;border-radius:12px;padding:16px 18px;margin:0 0 22px">
<div style="font-weight:700;color:#0b1220">${escH(prop.title)}</div>
${where ? `<div style="color:#64748b;font-size:14px">${escH(where)}</div>` : ""}
<div style="margin-top:10px;font-size:16px"><b>${escH(longDate(date, time))}</b></div>
<div style="color:#64748b;font-size:13px;margin-top:4px">Reference ${escH(row.ref)}</div>
</div>
<p style="margin:0 0 14px;color:#334155;line-height:1.55"><b>Love it? Apply now to hold your spot.</b>${fee > 0 ? ` The application fee is ${escH(money(fee))}; payment details are shown right after you apply.` : " There is no application fee."}</p>
${apply ? `<p style="margin:0 0 22px"><a href="${escH(apply)}" style="display:inline-block;background:#c2410c;color:#fff;text-decoration:none;font-weight:700;padding:14px 26px;border-radius:12px">Apply for this home</a></p>` : ""}
${s.contact_phone ? `<p style="margin:0;color:#475569;font-size:14px">Questions? Call or text ${escH(s.contact_phone)}.</p>` : ""}
</div>
<div style="padding:16px 24px;border-top:1px solid #e5e8ee;color:#94a3b8;font-size:12px">You received this because you requested a tour at ${escH(brand)}. Equal Housing Opportunity.</div>
</div></div>`;
  const payload = {
    from: RESEND_FROM,
    to: [
      email
    ],
    subject: `Your tour of ${prop.title}: ${longDate(date, time)}`,
    html
  };
  if (typeof s.reply_to === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.reply_to)) payload.reply_to = s.reply_to;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    const out = await res.json().catch(()=>({}));
    if (!res.ok) throw new Error(String(out?.message || `resend_${res.status}`).slice(0, 200));
    await admin.from("tours").update({
      emailed_at: new Date().toISOString(),
      email_error: null
    }).eq("id", row.id);
  } catch (e) {
    await admin.from("tours").update({
      email_error: String(e?.message || e).slice(0, 200)
    }).eq("id", row.id);
  }
}
// Application email: the same payment instructions the applicant sees on screen, plus their reference, so they keep it.
async function sendApplicationEmail(p, prop, row, name, email, t) {
  if (!RESEND_API_KEY || !RESEND_FROM) {
    await admin.from("applications").update({
      email_error: "email_not_configured"
    }).eq("id", row.id);
    return;
  }
  const s = p.housing_settings ?? {};
  const brand = String(s.brand || "SC Rentals");
  const fee = Number(t.fee?.amount) || 0;
  const money = (n)=>`$${Number(n).toLocaleString("en-US")}`;
  const pay = t.pay ?? null;
  const link = pay?.payment_link_url && /^https:\/\//i.test(pay.payment_link_url) ? pay.payment_link_url : null;
  const rows = pay ? [
    [
      "Bank",
      pay.bank_name
    ],
    [
      "Account number",
      pay.account_number
    ],
    [
      "Account name",
      pay.account_name
    ]
  ].filter((r)=>r[1]) : [];
  const payHtml = fee > 0 ? `<p style="margin:0 0 10px;color:#334155;line-height:1.55"><b>Next step: pay the ${escH(money(fee))} application fee.</b></p>
${pay?.instructions ? `<p style="margin:0 0 14px;color:#475569;line-height:1.55;white-space:pre-wrap">${escH(pay.instructions)}</p>` : ""}
${link ? `<p style="margin:0 0 16px"><a href="${escH(link)}" style="display:inline-block;background:#c2410c;color:#fff;text-decoration:none;font-weight:700;padding:14px 26px;border-radius:12px">Pay the application fee</a></p>` : ""}
${rows.length ? `<table style="border-collapse:collapse;margin:0 0 14px;font-size:15px">${rows.map((r)=>`<tr><td style="padding:4px 14px 4px 0;color:#64748b">${escH(r[0])}</td><td style="padding:4px 0;font-weight:700;color:#0b1220">${escH(r[1])}</td></tr>`).join("")}</table>` : ""}
${!pay?.instructions && !link && !rows.length ? `<p style="margin:0 0 14px;color:#475569">The property manager will contact you with payment details.</p>` : `<p style="margin:0 0 14px;color:#475569;line-height:1.55">Please use <b>${escH(row.ref)}</b> as your reference${s.contact_phone ? `, then call or text your receipt to ${escH(s.contact_phone)}` : ", then send your receipt to the property manager"}.</p>`}` : `<p style="margin:0 0 14px;color:#334155;line-height:1.55">No application fee is due. The property manager will be in touch.</p>`;
  const html = `<div style="background:#f5f6f8;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e5e8ee">
<div style="background:#0f2742;color:#fff;padding:20px 24px;font-size:18px;font-weight:700">${escH(brand)}</div>
<div style="padding:26px 24px">
<h1 style="margin:0 0 8px;font-size:22px;color:#0b1220">Application received, ${escH(String(name).split(" ")[0])}.</h1>
<p style="margin:0 0 18px;color:#475569;line-height:1.55">Thank you for applying. Here is what happens next.</p>
<div style="background:#f5f6f8;border-radius:12px;padding:16px 18px;margin:0 0 22px">
<div style="font-weight:700;color:#0b1220">${escH(prop.title)}</div>
<div style="color:#64748b;font-size:13px;margin-top:6px">Reference ${escH(row.ref)}</div>
</div>
${payHtml}
${t.fee?.disclosure ? `<p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.5">${escH(t.fee.disclosure)}</p>` : ""}
</div>
<div style="padding:16px 24px;border-top:1px solid #e5e8ee;color:#94a3b8;font-size:12px">You received this because you applied at ${escH(brand)}. Please never email us ID or Social Security numbers. Equal Housing Opportunity.</div>
</div></div>`;
  const payload = {
    from: RESEND_FROM,
    to: [
      email
    ],
    subject: `Your application for ${prop.title} (${row.ref})`,
    html
  };
  if (typeof s.reply_to === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.reply_to)) payload.reply_to = s.reply_to;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    const o = await res.json().catch(()=>({}));
    if (!res.ok) throw new Error(String(o?.message || `resend_${res.status}`).slice(0, 200));
    await admin.from("applications").update({
      emailed_at: new Date().toISOString(),
      email_error: null
    }).eq("id", row.id);
  } catch (e) {
    await admin.from("applications").update({
      email_error: String(e?.message || e).slice(0, 200)
    }).eq("id", row.id);
  }
}
function queueApplicationEmail(p, prop, row, name, email, t) {
  const job = sendApplicationEmail(p, prop, row, name, email, t).catch((e)=>console.error("application email", e));
  try {
    globalThis.EdgeRuntime?.waitUntil?.(job);
  } catch  {}
}
// Fire and forget: the visitor's booking never waits for (or fails because of) the email.
function queueTourEmail(p, prop, row, name, email, date, time) {
  const job = sendTourEmail(p, prop, row, name, email, date, time).catch((e)=>console.error("tour email", e));
  try {
    globalThis.EdgeRuntime?.waitUntil?.(job);
  } catch  {}
}
function tourThanks(p, prop, ref, date, time) {
  return {
    ok: true,
    ref,
    property: {
      id: prop.id,
      title: prop.title
    },
    tour_date: date,
    tour_time: time,
    contact_phone: p.housing_settings?.contact_phone ?? null,
    flow: flowOf(p),
    emailed: Boolean(RESEND_API_KEY && RESEND_FROM),
    message: "Your tour request is in. We'll text you to confirm."
  };
}
// The thank-you / payment screen: what was applied for, the fee, how to pay, and who to call or text with the receipt.
function thanks(p, prop, ref, method) {
  const s = p.housing_settings ?? {};
  return {
    ok: true,
    ref,
    property: {
      id: prop.id,
      title: prop.title,
      state: prop.state,
      monthly_rent: prop.monthly_rent,
      currency: prop.currency
    },
    fee: {
      amount: prop.application_fee ?? 0,
      currency: prop.currency,
      disclosure: prop.fee_disclosure ?? null,
      status: Number(prop.application_fee) > 0 ? "unpaid" : "waived",
      method
    },
    pay: Number(prop.application_fee) > 0 ? {
      instructions: p.payment_note ?? null,
      payment_link_url: p.payment_link_url ?? null,
      bank_name: p.bank_name ?? null,
      account_number: p.bank_account_number ?? null,
      account_name: p.bank_account_name ?? null,
      reference_to_use: ref
    } : null,
    contact_phone: s.contact_phone ?? null,
    message: "Your application has been submitted. Pay the application fee, then call or text your receipt to the number shown. If you haven't paid, the property manager may contact you to complete payment."
  };
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response(null, {
    status: 204,
    headers: CORS
  });
  let b = null;
  try {
    b = await req.json();
  } catch  {
    b = null;
  }
  if (!b) return jres({
    error: "bad_request"
  }, 400);
  if (typeof b.action === "string" && b.action.startsWith("public_")) {
    try {
      return jres(await publicAction(b));
    } catch (e) {
      return jres({
        error: e.message
      }, 400);
    }
  }
  const key = req.headers.get("x-internal-key") ?? "";
  if (!SERVICE_KEY || key.length !== SERVICE_KEY.length || key !== SERVICE_KEY) return jres({
    error: "forbidden"
  }, 403);
  if (b.action === "list") return jres({
    group: "mcp-housing",
    tools: TOOLS.map((t)=>({
        name: t.name,
        title: t.title,
        description: t.description,
        inputSchema: t.inputSchema,
        annotations: t.annotations,
        write: t.write
      }))
  });
  if (b.action === "call") {
    const t = BY_NAME.get(String(b.tool ?? ""));
    if (!t) return jres({
      error: "unknown_tool"
    }, 404);
    let out;
    try {
      out = await t.run(b.args && typeof b.args === "object" ? b.args : {}, b.ctx);
    } catch (e) {
      out = {
        error: e.message
      };
    }
    return jres({
      out
    });
  }
  return jres({
    error: "bad_action"
  }, 400);
});
