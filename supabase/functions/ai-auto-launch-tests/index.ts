import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const META_GRAPH_BASE = "https://graph.facebook.com/v21.0";
async function getCaller(req, admin) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  if (SUPABASE_SERVICE_ROLE_KEY && token === SUPABASE_SERVICE_ROLE_KEY) return {
    service: true,
    company_id: null,
    role: null
  };
  const { data } = await admin.auth.getUser(token);
  if (!data?.user) return null;
  const { data: p } = await admin.from("profiles").select("company_id, role").eq("id", data.user.id).maybeSingle();
  if (!p?.company_id) return null;
  return {
    service: false,
    company_id: p.company_id,
    role: p.role
  };
}
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info"
};
// CURRENCY. Meta takes budgets in the ad account's own currency, in minor units (x100). Only currencies whose minor unit is 100 are verified here.
const VERIFIED_CURRENCIES = [
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
const CURRENCY_SYMBOLS = {
  NGN: "₦",
  USD: "$",
  EUR: "€",
  GBP: "£",
  CAD: "CA$",
  AUD: "A$",
  NZD: "NZ$",
  ZAR: "R",
  GHS: "GH₵",
  KES: "KSh ",
  AED: "AED ",
  INR: "₹",
  SGD: "S$",
  CHF: "CHF "
};
const money = (cur, n)=>`${CURRENCY_SYMBOLS[cur] ?? `${cur} `}${Number(n).toLocaleString("en-US")}`;
async function getAccountCurrency(supabase, accountRowId, actId) {
  const { data } = await supabase.from("ad_accounts").select("currency, billing_mode").eq("id", accountRowId).maybeSingle();
  const billing_mode = data?.billing_mode ?? null;
  const have = String(data?.currency ?? "").trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(have)) return {
    currency: have,
    billing_mode
  };
  try {
    const r = await fetch(`${META_GRAPH_BASE}/act_${actId}?fields=currency&access_token=${META_ACCESS_TOKEN}`);
    const j = await r.json();
    const cur = String(j?.currency ?? "").trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(cur)) {
      await supabase.from("ad_accounts").update({
        currency: cur
      }).eq("id", accountRowId);
      return {
        currency: cur,
        billing_mode
      };
    }
    return {
      error: `Could not read this ad account's currency from Meta, so nothing was launched. ${j?.error?.message ?? ""}`.trim()
    };
  } catch (err) {
    return {
      error: `Could not read this ad account's currency from Meta, so nothing was launched. ${err?.message ?? err}`
    };
  }
}
const US_STATES = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  DC: "District of Columbia",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming"
};
// The countries an ad set runs in: the plan's own choice, else the saved config's countries, else Nigeria (as before).
const effectiveCountries = (c)=>c?.plan_countries?.length ? c.plan_countries : c?.geo_type === "countries" && Array.isArray(c?.countries) && c.countries.length ? c.countries.map((x)=>String(x).toUpperCase()) : [
    "NG"
  ];
// Meta needs a thumbnail (image_url or image_hash) on every video ad creative.
// After a video is uploaded Meta processes it for a while, then generates thumbnails.
// We wait for Meta (polling) and use its own preferred thumbnail.
const sleep = (ms)=>new Promise((r)=>setTimeout(r, ms));
async function waitForVideoThumbnail(videoId, maxWaitMs = 90 * 1e3) {
  const deadline = Date.now() + maxWaitMs;
  let lastStatus = "unknown";
  while(Date.now() < deadline){
    try {
      const sRes = await fetch(`${META_GRAPH_BASE}/${videoId}?fields=status,picture&access_token=${META_ACCESS_TOKEN}`);
      const s = await sRes.json();
      const vs = s?.status?.video_status;
      if (vs) lastStatus = vs;
      if (vs === "error") {
        console.error("Meta video processing error:", s.status);
        return {
          error: `Meta could not process the video ${videoId}: ${JSON.stringify(s.status)}`
        };
      }
      if (vs === "ready") {
        const tRes = await fetch(`${META_GRAPH_BASE}/${videoId}/thumbnails?fields=uri,is_preferred&access_token=${META_ACCESS_TOKEN}`);
        const t = await tRes.json();
        const list = Array.isArray(t?.data) ? t.data : [];
        const pick = list.find((x)=>x?.is_preferred && x?.uri) || list.find((x)=>x?.uri);
        if (pick?.uri) return {
          thumbnailUrl: pick.uri
        };
        if (s?.picture) return {
          thumbnailUrl: s.picture
        };
      }
    } catch (err) {
      console.error("waitForVideoThumbnail error:", err);
    }
    await sleep(4e3);
  }
  return {
    error: `Meta has not finished processing video ${videoId} (status: ${lastStatus}) so no thumbnail is available yet. Try again in a minute.`
  };
}
async function ensureMetaMedia(supabase, accountId, creative, maxWaitMs = 90 * 1e3) {
  const isVideo = creative.asset_type === "video";
  let videoId = creative.meta_video_id || null;
  // Already sent to THIS ad account's library (by an earlier launch or by the pre-upload when the plan was made)?
  if (!videoId && isVideo && creative.ad_account_id && creative.public_url) {
    const { data: hit } = await supabase.from("meta_video_cache").select("meta_video_id").eq("ad_account_id", creative.ad_account_id).eq("public_url", creative.public_url).maybeSingle();
    if (hit?.meta_video_id) {
      videoId = hit.meta_video_id;
      await supabase.from("creative_assets").update({
        meta_video_id: videoId
      }).eq("id", creative.id);
    }
  }
  if (!videoId) {
    if (!isVideo) {
      return {
        imageUrl: creative.public_url
      };
    }
    try {
      const params = new URLSearchParams({
        file_url: creative.public_url,
        access_token: META_ACCESS_TOKEN
      });
      const res = await fetch(`${META_GRAPH_BASE}/act_${accountId}/advideos`, {
        method: "POST",
        body: params
      });
      const data = await res.json();
      if (!data.id) {
        console.error("Video upload failed:", data);
        return {
          error: JSON.stringify(data.error || data)
        };
      }
      await supabase.from("creative_assets").update({
        meta_video_id: data.id
      }).eq("id", creative.id);
      videoId = data.id;
      if (creative.ad_account_id && creative.public_url) await supabase.from("meta_video_cache").upsert({
        ad_account_id: creative.ad_account_id,
        public_url: creative.public_url,
        meta_video_id: data.id
      }, {
        onConflict: "ad_account_id,public_url"
      });
    } catch (err) {
      console.error("ensureMetaMedia error:", err);
      return {
        error: err.message || String(err)
      };
    }
  }
  const thumb = await waitForVideoThumbnail(videoId, maxWaitMs);
  if (thumb.error) return {
    error: thumb.error
  };
  return {
    videoId,
    thumbnailUrl: thumb.thumbnailUrl
  };
}
async function createAdCreative(accountId, pageId, igUserId, creative, media, destinationLink, ctaType, destinationType, productName) {
  try {
    // Carousel: 2-10 swipeable cards, each with its own picture, headline and (optional) link.
    if (creative.asset_type === "carousel") {
      const cards = Array.isArray(creative.carousel_cards) ? creative.carousel_cards.filter((x)=>x?.image_url).slice(0, 10) : [];
      if (cards.length < 2) return {
        error: "A carousel needs at least 2 cards with pictures."
      };
      if (destinationType === "form") return {
        error: "Carousel ads cannot open a lead form. Use WhatsApp, Messenger or a website link."
      };
      const wa = destinationType === "whatsapp";
      const ms = destinationType === "messenger" || destinationType === "instagram";
      const baseLink = wa ? "https://api.whatsapp.com/send" : ms ? "https://fb.com/messenger_doc/" : destinationLink;
      const cardCta = (link)=>wa ? {
          type: "WHATSAPP_MESSAGE",
          value: {
            app_destination: "WHATSAPP"
          }
        } : ms ? {
          type: destinationType === "instagram" ? "INSTAGRAM_MESSAGE" : "MESSAGE_PAGE",
          value: {
            app_destination: destinationType === "instagram" ? "INSTAGRAM_DIRECT" : "MESSENGER"
          }
        } : {
          type: ctaType,
          value: {
            link
          }
        };
      const cr = await fetch(`${META_GRAPH_BASE}/act_${accountId}/adcreatives`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: `Carousel-${creative.file_name}-${Date.now()}`,
          object_story_spec: {
            page_id: pageId,
            ...igUserId ? {
              instagram_user_id: igUserId
            } : {},
            link_data: {
              link: baseLink,
              message: creative.primary_text || "",
              multi_share_end_card: false,
              multi_share_optimized: false,
              child_attachments: cards.map((k)=>{
                const link = wa || ms ? baseLink : String(k.link || destinationLink);
                return {
                  link,
                  picture: k.image_url,
                  name: String(k.headline ?? "").slice(0, 80) || void 0,
                  description: String(k.description ?? "").slice(0, 150) || void 0,
                  call_to_action: cardCta(link)
                };
              })
            }
          },
          contextual_multi_ads: {
            enroll_status: "OPT_OUT"
          },
          access_token: META_ACCESS_TOKEN
        })
      });
      const cd = await cr.json();
      if (!cd.id) return {
        error: JSON.stringify(cd.error || cd)
      };
      return {
        id: cd.id
      };
    }
    // Existing post ("boost a post" style): the post keeps its own picture, text, button and link.
    if (creative.asset_type === "post" && creative.meta_post_id) {
      const pr = await fetch(`${META_GRAPH_BASE}/act_${accountId}/adcreatives`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: `Post-${creative.meta_post_id}-${Date.now()}`,
          object_story_id: creative.meta_post_id,
          access_token: META_ACCESS_TOKEN
        })
      });
      const pd = await pr.json();
      if (!pd.id) return {
        error: JSON.stringify(pd.error || pd)
      };
      return {
        id: pd.id
      };
    }
    let objectStorySpec;
    const thumb = media.thumbnailUrl ? {
      image_url: media.thumbnailUrl
    } : {};
    if (destinationType === "whatsapp") {
      objectStorySpec = {
        page_id: pageId,
        ...igUserId ? {
          instagram_user_id: igUserId
        } : {},
        link_data: {
          picture: media.imageUrl || void 0,
          link: "https://api.whatsapp.com/send",
          message: creative.primary_text || "",
          name: creative.headline || void 0,
          description: creative.description || void 0,
          call_to_action: {
            type: "WHATSAPP_MESSAGE",
            value: {
              app_destination: "WHATSAPP"
            }
          },
          page_welcome_message: {
            type: "VISUAL_EDITOR",
            version: 2,
            landing_screen_type: "welcome_message",
            media_type: "text",
            text_format: {
              customer_action_type: "autofill_message",
              message: {
                text: String(creative.whatsapp_greeting ?? "").trim().slice(0, 300) || (productName ? `Hi! Interested in ${productName}? 👋` : "Hi! 👋 Thanks for clicking our ad. How can we help you today?"),
                autofill_message: {
                  content: String(creative.whatsapp_prefill ?? "").trim().slice(0, 1e3) || (productName ? `Hi, I'm interested in ${productName}` : "Hi, I saw your ad and I'd like to know more.")
                }
              }
            }
          }
        }
      };
    } else if (destinationType === "form") {
      const okCta = [
        "SIGN_UP",
        "LEARN_MORE",
        "APPLY_NOW",
        "GET_QUOTE",
        "SUBSCRIBE",
        "DOWNLOAD",
        "BOOK_TRAVEL"
      ].includes(ctaType) ? ctaType : "SIGN_UP";
      const cta = {
        type: okCta,
        value: {
          lead_gen_form_id: String(creative.lead_form_id)
        }
      };
      const formLink = destinationLink || `https://www.facebook.com/${pageId}`;
      objectStorySpec = media.videoId ? {
        page_id: pageId,
        ...igUserId ? {
          instagram_user_id: igUserId
        } : {},
        video_data: {
          video_id: media.videoId,
          ...thumb,
          title: creative.headline || void 0,
          message: creative.primary_text || "",
          call_to_action: cta
        }
      } : {
        page_id: pageId,
        ...igUserId ? {
          instagram_user_id: igUserId
        } : {},
        link_data: {
          picture: media.imageUrl,
          link: formLink,
          message: creative.primary_text || "",
          name: creative.headline || void 0,
          description: creative.description || void 0,
          call_to_action: cta
        }
      };
    } else if (destinationType === "messenger" || destinationType === "instagram") {
      const ig = destinationType === "instagram";
      const cta = ig ? {
        type: "INSTAGRAM_MESSAGE",
        value: {
          app_destination: "INSTAGRAM_DIRECT"
        }
      } : {
        type: "MESSAGE_PAGE",
        value: {
          app_destination: "MESSENGER"
        }
      };
      const msgLink = "https://fb.com/messenger_doc/";
      objectStorySpec = media.videoId ? {
        page_id: pageId,
        ...igUserId ? {
          instagram_user_id: igUserId
        } : {},
        video_data: {
          video_id: media.videoId,
          ...thumb,
          title: creative.headline || void 0,
          message: creative.primary_text || "",
          call_to_action: cta
        }
      } : {
        page_id: pageId,
        ...igUserId ? {
          instagram_user_id: igUserId
        } : {},
        link_data: {
          picture: media.imageUrl,
          link: msgLink,
          message: creative.primary_text || "",
          name: creative.headline || void 0,
          description: creative.description || void 0,
          call_to_action: cta
        }
      };
    } else {
      const cta = {
        type: ctaType,
        value: {
          link: destinationLink
        }
      };
      objectStorySpec = media.videoId ? {
        page_id: pageId,
        ...igUserId ? {
          instagram_user_id: igUserId
        } : {},
        video_data: {
          video_id: media.videoId,
          ...thumb,
          title: creative.headline || void 0,
          message: creative.primary_text || "",
          call_to_action: cta
        }
      } : {
        page_id: pageId,
        ...igUserId ? {
          instagram_user_id: igUserId
        } : {},
        link_data: {
          picture: media.imageUrl,
          link: destinationLink,
          message: creative.primary_text || "",
          name: creative.headline || void 0,
          description: creative.description || void 0,
          call_to_action: cta
        }
      };
    }
    const res = await fetch(`${META_GRAPH_BASE}/act_${accountId}/adcreatives`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: `Creative-${creative.file_name}-${Date.now()}`,
        object_story_spec: objectStorySpec,
        contextual_multi_ads: {
          enroll_status: "OPT_OUT"
        },
        access_token: META_ACCESS_TOKEN
      })
    });
    const data = await res.json();
    if (!data.id) {
      console.error("Ad creative creation failed:", data);
      return {
        error: JSON.stringify(data.error || data)
      };
    }
    return {
      id: data.id
    };
  } catch (err) {
    console.error("createAdCreative error:", err);
    return {
      error: String(err?.message || err)
    };
  }
}
async function createAdWithCTA(adsetId, creativeId, adName, accountId, status = "ACTIVE") {
  try {
    const adPayload = {
      adset_id: adsetId,
      creative: {
        creative_id: creativeId
      },
      status,
      name: adName,
      access_token: META_ACCESS_TOKEN
    };
    const res = await fetch(`${META_GRAPH_BASE}/act_${accountId}/ads`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(adPayload)
    });
    const data = await res.json();
    if (!data.id) console.error("Ad creation failed:", data);
    return data.id || null;
  } catch (err) {
    console.error("Error creating ad:", err);
    return null;
  }
}
const REAL_OPTIMIZATION_GOAL = "OFFSITE_CONVERSIONS";
const REAL_BID_STRATEGY = "LOWEST_COST_WITHOUT_CAP";
const REAL_PLACEMENTS = {
  publisher_platforms: [
    "facebook",
    "instagram"
  ],
  facebook_positions: [
    "feed",
    "marketplace",
    "facebook_reels",
    "profile_feed",
    "notification"
  ],
  instagram_positions: [
    "stream",
    "story",
    "reels",
    "explore",
    "explore_home",
    "profile_feed"
  ],
  device_platforms: [
    "mobile"
  ]
};
const REAL_WHATSAPP_PLACEMENTS = {
  publisher_platforms: [
    "facebook",
    "instagram"
  ],
  facebook_positions: [
    "feed",
    "search",
    "facebook_reels"
  ],
  instagram_positions: [
    "stream",
    "reels"
  ],
  device_platforms: [
    "mobile"
  ]
};
const GENDER_MAP = {
  all: [
    1,
    2
  ],
  male: [
    1
  ],
  female: [
    2
  ]
};
const PLACEMENT_PRESETS = {
  feed_only: {
    facebook_positions: [
      "feed"
    ],
    instagram_positions: [
      "stream"
    ]
  },
  feed_stories_reels: {
    facebook_positions: [
      "feed",
      "facebook_reels"
    ],
    instagram_positions: [
      "stream",
      "reels",
      "story"
    ]
  }
};
const VALID_BID_STRATEGIES = [
  "LOWEST_COST_WITHOUT_CAP",
  "LOWEST_COST_WITH_BID_CAP",
  "COST_CAP"
];
const VALID_BILLING_EVENTS = [
  "IMPRESSIONS",
  "LINK_CLICKS"
];
const VALID_WEBSITE_OPTIMIZATION_GOALS = [
  "OFFSITE_CONVERSIONS",
  "LINK_CLICKS",
  "LANDING_PAGE_VIEWS"
];
const VALID_DEVICE_PLATFORMS = [
  "mobile",
  "desktop"
];
const PLACEMENTS = {
  fb_feed: {
    p: "facebook",
    k: "facebook_positions",
    pos: [
      "feed"
    ]
  },
  fb_reels: {
    p: "facebook",
    k: "facebook_positions",
    pos: [
      "facebook_reels"
    ]
  },
  fb_stories: {
    p: "facebook",
    k: "facebook_positions",
    pos: [
      "story"
    ]
  },
  fb_marketplace: {
    p: "facebook",
    k: "facebook_positions",
    pos: [
      "marketplace"
    ]
  },
  fb_search: {
    p: "facebook",
    k: "facebook_positions",
    pos: [
      "search"
    ]
  },
  fb_profile: {
    p: "facebook",
    k: "facebook_positions",
    pos: [
      "profile_feed"
    ]
  },
  ig_feed: {
    p: "instagram",
    k: "instagram_positions",
    pos: [
      "stream"
    ]
  },
  ig_reels: {
    p: "instagram",
    k: "instagram_positions",
    pos: [
      "reels"
    ]
  },
  ig_stories: {
    p: "instagram",
    k: "instagram_positions",
    pos: [
      "story"
    ]
  },
  ig_explore: {
    p: "instagram",
    k: "instagram_positions",
    pos: [
      "explore",
      "explore_home"
    ]
  },
  ig_profile: {
    p: "instagram",
    k: "instagram_positions",
    pos: [
      "profile_feed"
    ]
  },
  threads: {
    p: "threads",
    k: "threads_positions",
    pos: [
      "threads_stream"
    ]
  },
  wa_status: {
    p: "whatsapp",
    k: "whatsapp_positions",
    pos: [
      "status"
    ]
  },
  an: {
    p: "audience_network",
    k: "audience_network_positions",
    pos: [
      "classic",
      "rewarded_video"
    ]
  }
};
function placementSpec(keys) {
  const set = new Set((Array.isArray(keys) ? keys : []).map(String).filter((k)=>PLACEMENTS[k]));
  if (!set.size) return null;
  if ([
    "fb_marketplace",
    "fb_search",
    "fb_profile"
  ].some((k)=>set.has(k))) set.add("fb_feed");
  if (set.has("fb_stories") && !set.has("fb_feed") && !set.has("ig_stories")) set.add("fb_feed");
  if ([
    "ig_explore",
    "ig_profile"
  ].some((k)=>set.has(k))) set.add("ig_feed");
  if (set.has("wa_status")) set.add("ig_stories");
  if (set.has("threads") && !set.has("fb_feed") && !set.has("ig_feed")) set.add("fb_feed");
  if (set.has("an") && !set.has("fb_feed")) set.add("fb_feed");
  const out = {
    publisher_platforms: []
  };
  for (const key of set){
    const m = PLACEMENTS[key];
    if (!out.publisher_platforms.includes(m.p)) out.publisher_platforms.push(m.p);
    out[m.k] = [
      ...out[m.k] ?? [],
      ...m.pos
    ];
  }
  return out;
}
const MSG_DESTINATIONS = [
  "whatsapp",
  "messenger",
  "instagram"
];
const OBJECTIVE_CONFIG = {
  OUTCOME_SALES: {
    optimizationGoal: REAL_OPTIMIZATION_GOAL,
    promotedObject: (pixelId)=>({
        pixel_id: pixelId,
        custom_event_type: "PURCHASE"
      })
  },
  OUTCOME_LEADS: {
    optimizationGoal: REAL_OPTIMIZATION_GOAL,
    promotedObject: (pixelId)=>({
        pixel_id: pixelId,
        custom_event_type: "LEAD"
      })
  },
  OUTCOME_TRAFFIC: {
    optimizationGoal: "LINK_CLICKS",
    promotedObject: ()=>null
  },
  OUTCOME_ENGAGEMENT: {
    optimizationGoal: "POST_ENGAGEMENT",
    promotedObject: (_pixelId, pageId)=>({
        page_id: pageId
      })
  },
  OUTCOME_AWARENESS: {
    optimizationGoal: "REACH",
    promotedObject: ()=>null
  }
};
const VALID_OBJECTIVES = Object.keys(OBJECTIVE_CONFIG);
// Special ad categories (housing, employment, financial products): Meta requires the campaign to declare them.
// A plan's category (ai_plans.plan.special_ad_category) wins; otherwise the product's default (products.special_ad_category) is used.
const SPECIAL_CATEGORIES = [
  "HOUSING",
  "EMPLOYMENT",
  "FINANCIAL_PRODUCTS_SERVICES"
];
const MIN_RESTRICTED_RADIUS_KM = 25;
const MIN_RESTRICTED_RADIUS_MI = 16;
// "Nigeria" (and similar) means the whole country, never a state/region.
const NATIONWIDE_TERMS = new Set([
  "nigeria",
  "all nigeria",
  "whole nigeria",
  "entire nigeria",
  "nationwide",
  "national",
  "all states",
  "all",
  "ng",
  "naija",
  "across nigeria",
  "nigeria wide",
  "nigeria-wide",
  "country wide",
  "countrywide"
]);
const isNationwideTerm = (s)=>NATIONWIDE_TERMS.has(String(s ?? "").toLowerCase().replace(/[^a-z\- ]+/g, " ").replace(/\s+/g, " ").trim());
// Looks up Meta region keys for state names IN THE GIVEN COUNTRY (Nigeria by default, as before). US two-letter codes like SC are expanded to the state name first.
async function resolveStateRegionKeys(stateNames, countryCode = "NG") {
  const resolved = [];
  for (const raw of stateNames){
    const code = String(raw ?? "").trim().toUpperCase();
    const name = countryCode === "US" && US_STATES[code] ? US_STATES[code] : String(raw ?? "").trim();
    try {
      const res = await fetch(`${META_GRAPH_BASE}/search?type=adgeolocation&location_types=${encodeURIComponent(JSON.stringify([
        "region"
      ]))}&country_code=${encodeURIComponent(countryCode)}&q=${encodeURIComponent(name)}&limit=5&access_token=${META_ACCESS_TOKEN}`);
      const data = await res.json();
      const list = Array.isArray(data?.data) ? data.data : [];
      const match = list.find((x)=>String(x?.name ?? "").toLowerCase() === name.toLowerCase()) ?? list[0];
      if (match?.key) {
        resolved.push({
          key: match.key,
          name: match.name || name
        });
      } else {
        console.warn(`No Meta region match found for state "${name}" in ${countryCode}.`);
      }
    } catch (err) {
      console.error(`Failed to resolve state "${name}":`, err);
    }
  }
  return resolved;
}
// Returns the Meta targeting object, or { error } when the places cannot be resolved safely.
async function buildTargetingFromConfig(config, destinationType, restricted = false) {
  const basePlacements = destinationType === "whatsapp" ? REAL_WHATSAPP_PLACEMENTS : destinationType === "instagram" ? {
    publisher_platforms: [
      "instagram"
    ],
    facebook_positions: [],
    instagram_positions: [
      "stream",
      "story",
      "reels"
    ],
    device_platforms: [
      "mobile"
    ]
  } : destinationType === "form" ? {
    publisher_platforms: [
      "facebook",
      "instagram"
    ],
    facebook_positions: [
      "feed",
      "facebook_reels"
    ],
    instagram_positions: [
      "stream",
      "reels"
    ],
    device_platforms: [
      "mobile"
    ]
  } : destinationType === "messenger" ? {
    publisher_platforms: [
      "facebook",
      "instagram"
    ],
    facebook_positions: [
      "feed",
      "story",
      "facebook_reels"
    ],
    instagram_positions: [
      "stream",
      "story",
      "reels"
    ],
    device_platforms: [
      "mobile"
    ]
  } : REAL_PLACEMENTS;
  const positionOverride = config.placement_preset ? PLACEMENT_PRESETS[config.placement_preset] : null;
  const devicePlatforms = Array.isArray(config.device_platforms) && config.device_platforms.length ? config.device_platforms.filter((d)=>VALID_DEVICE_PLATFORMS.includes(d)) : basePlacements.device_platforms;
  const genders = GENDER_MAP[config.gender ?? "all"] ?? [
    1,
    2
  ];
  const ageMin = config.age_min ?? 25, ageMax = config.age_max ?? 65;
  const advantageOn = config.advantage_audience !== false && ageMin <= 25 && ageMax >= 65;
  const targeting = {
    genders,
    age_min: ageMin,
    age_max: ageMax,
    ...advantageOn ? {
      targeting_automation: {
        advantage_audience: 1,
        individual_setting: {
          age: 1,
          gender: 1
        }
      }
    } : {
      targeting_automation: {
        advantage_audience: 0
      }
    },
    publisher_platforms: basePlacements.publisher_platforms,
    facebook_positions: positionOverride?.facebook_positions ?? basePlacements.facebook_positions,
    instagram_positions: positionOverride?.instagram_positions ?? basePlacements.instagram_positions,
    device_platforms: devicePlatforms.length ? devicePlatforms : basePlacements.device_platforms
  };
  for (const k of [
    "facebook_positions",
    "instagram_positions"
  ])if (Array.isArray(targeting[k]) && !targeting[k].length) delete targeting[k];
  const chosen = placementSpec(config.placements);
  if (chosen) {
    for (const k of [
      "facebook_positions",
      "instagram_positions"
    ])delete targeting[k];
    Object.assign(targeting, chosen);
  }
  const geo = {
    location_types: [
      "frequently_in",
      "home",
      "recent"
    ]
  };
  const rawStates = Array.isArray(config.states) ? config.states : [];
  // If any entry means "the whole country", the ad set is nationwide: never look it up as a region.
  const wantsNationwide = rawStates.some(isNationwideTerm);
  const stateList = wantsNationwide ? [] : rawStates;
  if (wantsNationwide) console.log(`Ad set "${config.label}": states ${JSON.stringify(rawStates)} means nationwide -- targeting the whole country.`);
  // Countries: the plan's own choice (config.plan_countries), or the countries picked in the builder (geo_type "countries"); no pick means Nigeria, as before.
  const planCountries = Array.isArray(config.plan_countries) ? config.plan_countries : [];
  const builderCountries = config.geo_type === "countries" && Array.isArray(config.countries) ? [
    ...new Set(config.countries.map((c)=>String(c).toUpperCase()).filter((c)=>/^[A-Z]{2}$/.test(c)))
  ] : [];
  const chosenCountries = planCountries.length ? planCountries : builderCountries;
  const placeCountry = chosenCountries.length === 1 ? chosenCountries[0] : chosenCountries.length ? null : "NG";
  const cityList = Array.isArray(config.cities) ? config.cities.filter((c)=>/^\d+$/.test(String(c?.key))) : [];
  if (config.geo_type === "states" && !wantsNationwide && (stateList.length || cityList.length) && !placeCountry) {
    return {
      error: `Ad set "${config.label}" names states or cities but also several countries. Use one country per ad set when you pick states or cities.`
    };
  }
  if (config.geo_type === "states" && stateList.length) {
    const resolvedStates = await resolveStateRegionKeys(stateList, placeCountry ?? "NG");
    if (resolvedStates.length) geo.regions = resolvedStates.map((s)=>({
        key: s.key
      }));
  }
  if (!wantsNationwide && config.geo_type === "states" && cityList.length) {
    const cities = cityList.map((c)=>{
      const mile = String(c?.distance_unit ?? "").toLowerCase().startsWith("mi");
      return mile ? {
        key: String(c.key),
        radius: Math.min(Math.max(Number(c.radius) || 10, 6), 50),
        distance_unit: "mile"
      } : {
        key: String(c.key),
        radius: Math.min(Math.max(Number(c.radius) || 17, 10), 80),
        distance_unit: "kilometer"
      };
    });
    if (cities.length) geo.cities = cities;
  }
  if (!geo.regions && !geo.cities) {
    if (config.geo_type === "states" && !wantsNationwide) {
      // Outside Nigeria never fall back to the whole country when the places were not found: that would spend in the wrong place.
      if (placeCountry && placeCountry !== "NG") {
        return {
          error: `Ad set "${config.label}": its places (${[
            ...stateList,
            ...cityList.map((c)=>c.name || c.key)
          ].join(", ")}) could not be found in ${placeCountry}, so it was NOT created (it would have targeted the whole country). Check the names with search_locations.`
        };
      }
      console.warn(`Ad set "${config.label}" specified places but none resolved -- falling back to nationwide (NG).`);
    }
    geo.countries = chosenCountries.length ? chosenCountries : [
      "NG"
    ];
  }
  targeting.geo_locations = geo;
  const pick = (arr)=>(Array.isArray(arr) ? arr : []).filter((x)=>/^\d+$/.test(String(x?.id))).map((x)=>({
        id: String(x.id),
        name: String(x.name ?? "")
      }));
  const interests = pick(config.interests), behaviors = pick(config.behaviors);
  if (interests.length || behaviors.length) {
    targeting.flexible_spec = [
      {
        ...interests.length ? {
          interests
        } : {},
        ...behaviors.length ? {
          behaviors
        } : {}
      }
    ];
    targeting.targeting_automation = {
      advantage_audience: 0
    };
  }
  if (restricted) {
    // Special ad categories: Meta fixes age 18-65, all genders, no detailed targeting and a wide city radius.
    targeting.age_min = 18;
    targeting.age_max = 65;
    targeting.genders = [
      1,
      2
    ];
    delete targeting.flexible_spec;
    targeting.targeting_automation = {
      advantage_audience: 0
    };
    if (targeting.geo_locations?.cities) {
      targeting.geo_locations.cities = targeting.geo_locations.cities.map((c)=>({
          ...c,
          radius: Math.max(Number(c.radius) || 0, c.distance_unit === "mile" ? MIN_RESTRICTED_RADIUS_MI : MIN_RESTRICTED_RADIUS_KM)
        }));
    }
  }
  return targeting;
}
function buildAdSetPayload(opts) {
  const payload = {
    name: opts.name,
    optimization_goal: opts.optimizationGoal,
    bid_strategy: opts.bidStrategy,
    billing_event: opts.billingEvent,
    targeting: opts.targeting,
    status: opts.status ?? "ACTIVE",
    access_token: META_ACCESS_TOKEN
  };
  if (opts.promotedObject) payload.promoted_object = opts.promotedObject;
  if (opts.bidStrategy !== "LOWEST_COST_WITHOUT_CAP" && opts.bidAmountNaira) {
    payload.bid_amount = Math.round(opts.bidAmountNaira * 100);
  }
  if (opts.destinationType === "whatsapp") payload.destination_type = "WHATSAPP";
  else if (opts.destinationType === "messenger") payload.destination_type = "MESSENGER";
  else if (opts.destinationType === "instagram") payload.destination_type = "INSTAGRAM_DIRECT";
  else if (opts.destinationType === "form") payload.destination_type = "ON_AD";
  else if (opts.objective === "OUTCOME_ENGAGEMENT") payload.destination_type = "ON_POST";
  else if (opts.destinationType === "website" && (opts.objective === "OUTCOME_SALES" || opts.objective === "OUTCOME_LEADS")) payload.destination_type = "WEBSITE";
  if (opts.destinationType === "website" && opts.objective === "OUTCOME_SALES" && opts.lifecycle !== "none") payload.ad_set_goal = {
    type: 0
  };
  if (opts.budgetType === "abo") {
    payload.daily_budget = Math.round(opts.budgetNaira * 100);
  }
  if (opts.startTime) payload.start_time = opts.startTime;
  if (opts.endTime) payload.end_time = opts.endTime;
  return payload;
}
async function launchAdSetGroup(supabase, creativeGroup) {
  const launchStartedAt = Date.now(); // the whole launch must finish inside the platform's ~150 s limit: see the media step below
  const creative = creativeGroup[0];
  try {
    const rawAccountId = creative.ad_accounts?.meta_ad_account_id || "";
    const accountId = rawAccountId.replace("act_", "").match(/\d+/)?.[0] || rawAccountId.replace("act_", "");
    const pixelId = creative.ad_accounts?.meta_pixel_id || Deno.env.get("META_PIXEL_ID") || "";
    const pageId = creative.ad_accounts?.fb_page_id || "";
    const igUserId = creative.ad_accounts?.ig_user_id || null;
    const rawDest = String(creative.destination_type || creative.products?.destination_type || "");
    const destinationType = MSG_DESTINATIONS.includes(rawDest) || rawDest === "form" ? rawDest : "website";
    const isForm = destinationType === "form";
    const isMsg = destinationType !== "website" && !isForm;
    const liveStatus = creative.launch_paused === true ? "PAUSED" : "ACTIVE";
    const whatsappNumber = creative.whatsapp_number || creative.products?.whatsapp_number || "";
    const destinationLink = creative.landing_page_url || creative.products?.landing_page_url || "";
    const ctaType = creative.cta_type || "SHOP_NOW";
    const productName = creative.campaign_name?.trim() || creative.products?.product_name || "this business";
    const budgetType = creative.budget_type === "cbo" ? "cbo" : "abo";
    let startTime = creative.scheduled_for || null;
    let endTime = creative.campaign_end_date || null;
    // Plans made through the AI assistant keep extra settings on the plan itself (ai_plans.plan): a schedule and chosen placements.
    let planMeta = null;
    if (creative.uploaded_by === "ai_chat") {
      const { data: livePlans } = await supabase.from("ai_plans").select("plan").eq("status", "launching").eq("company_id", creative.company_id).eq("ad_account_id", creative.ad_account_id).order("created_at", {
        ascending: false
      }).limit(5);
      planMeta = (livePlans ?? []).map((r)=>r.plan).find((p)=>p?.campaign_name === creative.campaign_name) ?? null;
    }
    if (!startTime && planMeta?.scheduled_for && liveStatus === "ACTIVE") {
      if (new Date(planMeta.scheduled_for).getTime() < Date.now() + 2 * 60 * 1e3) {
        return {
          error: `The scheduled start time (${planMeta.scheduled_for}) has already passed or is less than 2 minutes away. Make a new plan with a later start time, or one without a start time to launch now.`
        };
      }
      startTime = planMeta.scheduled_for;
      endTime = planMeta.campaign_end_date || endTime;
    }
    const planPlacements = Array.isArray(planMeta?.placements) ? planMeta.placements.map(String).filter((k)=>PLACEMENTS[k]) : [];
    // ADS PER AD SET: a plan can give each ad set its own ads. plan.adsets[n].ad_numbers lists which of the plan's ads (1, 2, 3 ...) ad set n runs.
    // Every staged ad is named "... · Ad N" and carries its ad set number, so drop the ones an ad set did not choose BEFORE anything is created on Meta.
    // Plans without ad_numbers (the old way) are not touched: every ad set runs every ad.
    if (planMeta?.adsets?.some((s)=>Array.isArray(s?.ad_numbers) && s.ad_numbers.length)) {
      const kept = [];
      for (const row of creativeGroup){
        const chosen = planMeta.adsets[row.ad_set_sort_order]?.ad_numbers;
        if (!Array.isArray(chosen) || !chosen.length) {
          kept.push(row);
          continue;
        }
        const n = Number(String(row.ad_name ?? "").match(/ Ad (\d+)$/)?.[1]);
        if (!Number.isFinite(n)) {
          return {
            error: `Could not tell which ad "${row.ad_name}" is, so nothing was launched. Use a shorter product or ad set name and plan it again.`
          };
        }
        if (chosen.map(Number).includes(n)) kept.push(row);
      }
      if (!kept.length) return {
        error: "None of the ads chosen for the ad sets were found, so nothing was launched. Plan it again."
      };
      creativeGroup = kept;
    }
    if (!pageId) {
      const msg = `Missing fb_page_id for creative ${creative.id} -- check the ad_accounts row.`;
      console.error(msg);
      return {
        error: msg
      };
    }
    // CURRENCY GUARD: budgets go to Meta in the ad account's own currency. Naira accounts keep working exactly as before.
    // Any other currency needs a plan that says it was made in that currency (the assistant planner does this); everything else is refused, so a naira number can never become dollars.
    const acctInfo = await getAccountCurrency(supabase, creative.ad_account_id, accountId);
    if (acctInfo.error) return {
      error: acctInfo.error
    };
    const currency = acctInfo.currency;
    const planCurrency = String(planMeta?.currency ?? "").trim().toUpperCase();
    if (!VERIFIED_CURRENCIES.includes(currency)) {
      return {
        error: `This ad account bills in ${currency}, which is not verified for launching yet, so nothing was launched.`
      };
    }
    if (planCurrency && planCurrency !== currency) {
      return {
        error: `This plan was made in ${planCurrency} but the ad account bills in ${currency}, so nothing was launched. Plan it again for this account.`
      };
    }
    if (currency !== "NGN") {
      if (planCurrency !== currency) {
        return {
          error: `This ad account bills in ${currency}, but this plan does not state its budgets in ${currency} (plans made in the dashboard count in naira), so nothing was launched. Plan it again from the assistant so the budgets are in ${currency}.`
        };
      }
      if (acctInfo.billing_mode === "managed") {
        return {
          error: `Managed wallet accounts only run in naira. This account bills in ${currency}, so nothing was launched.`
        };
      }
    }
    if (destinationType === "whatsapp" && !whatsappNumber) {
      const msg = `Creative ${creative.id} is set to WhatsApp destination but has no WhatsApp number (set directly on the campaign, or on its linked product).`;
      console.error(msg);
      return {
        error: msg
      };
    }
    if (isForm && !creative.lead_form_id) {
      const msg = `Creative ${creative.id} is set to an Instant form but no lead form was chosen.`;
      console.error(msg);
      return {
        error: msg
      };
    }
    if (destinationType === "website" && !destinationLink) {
      const msg = `Missing a landing page URL for creative ${creative.id} (set directly on the campaign, or on its linked product).`;
      console.error(msg);
      return {
        error: msg
      };
    }
    const campaignObjective = isForm ? "OUTCOME_LEADS" : destinationType === "whatsapp" ? "OUTCOME_SALES" : isMsg ? [
      "OUTCOME_SALES",
      "OUTCOME_LEADS",
      "OUTCOME_ENGAGEMENT"
    ].includes(creative.campaign_objective) ? creative.campaign_objective : "OUTCOME_SALES" : VALID_OBJECTIVES.includes(creative.campaign_objective) ? creative.campaign_objective : "OUTCOME_SALES";
    const objectiveDefaults = OBJECTIVE_CONFIG[campaignObjective];
    // Special ad category: the plan's own choice wins, then the product's default, otherwise none.
    const planCat = String(planMeta?.special_ad_category ?? "").toUpperCase();
    const prodCat = String(creative.products?.special_ad_category ?? "").toUpperCase();
    const specialCategory = SPECIAL_CATEGORIES.includes(planCat) ? planCat : SPECIAL_CATEGORIES.includes(prodCat) ? prodCat : null;
    if (destinationType === "instagram" && !igUserId) {
      const msg = `Creative ${creative.id} is set to Instagram messages but this ad account has no Instagram account linked.`;
      console.error(msg);
      return {
        error: msg
      };
    }
    if (destinationType === "website" && (campaignObjective === "OUTCOME_SALES" || campaignObjective === "OUTCOME_LEADS") && !pixelId) {
      const msg = `Missing pixel_id for creative ${creative.id} -- check the ad_accounts row (Sales objective needs a connected pixel).`;
      console.error(msg);
      return {
        error: msg
      };
    }
    const promotedObject = destinationType === "whatsapp" ? {
      page_id: pageId,
      whatsapp_phone_number: whatsappNumber
    } : isMsg || isForm ? {
      page_id: pageId
    } : objectiveDefaults.promotedObject(pixelId, pageId);
    let adSetConfigs = [];
    {
      const { data } = await supabase.from("ad_set_configs").select("*").eq("creative_id", creative.id).order("sort_order", {
        ascending: true
      });
      adSetConfigs = data || [];
    }
    if (!adSetConfigs.length) {
      adSetConfigs = [
        {
          label: "Ad Set 1",
          budget_naira: 5e3,
          age_min: 25,
          age_max: 65,
          gender: "all",
          geo_type: "nationwide",
          states: null
        }
      ];
    }
    // Placements: an ad set's own choice (plan.adsets[n].placements) wins, then the plan-wide default, then whatever is saved on the ad set config.
    // Customer life cycle strategy: plan.adsets[n].lifecycle "none" = leave it blank, anything else = "all audiences".
    // Budget: for a non-naira account the plan's own budget (in the account currency) is used. Countries: plan.adsets[n].countries.
    const budgetProblems = [];
    adSetConfigs = adSetConfigs.map((cfg0, idx)=>{
      const planSet = planMeta?.adsets?.[cfg0.sort_order ?? idx];
      const cfg = {
        ...cfg0,
        lifecycle: planSet?.lifecycle === "none" ? "none" : "broad"
      };
      if (currency !== "NGN") {
        const amt = Number(planSet?.budget_naira);
        if (!(amt >= 1 && amt <= 1e4)) budgetProblems.push(`"${cfg0.label}": ${Number.isFinite(amt) ? amt : "no"} ${currency}/day is not a usable daily budget (1 to 10,000 ${currency}).`);
        cfg.budget_naira = amt;
      }
      const pcs = Array.isArray(planSet?.countries) ? [
        ...new Set(planSet.countries.map((x)=>String(x).toUpperCase()).filter((x)=>/^[A-Z]{2}$/.test(x)))
      ] : [];
      if (pcs.length) {
        cfg.plan_countries = pcs;
        cfg.countries = pcs;
        if (cfg.geo_type !== "states") cfg.geo_type = "countries";
      }
      const own = planSet?.placements;
      const ownList = Array.isArray(own) ? own.map(String) : [];
      if (ownList.length === 1 && ownList[0] === "automatic") return {
        ...cfg,
        placements: null
      };
      const ownKeys = ownList.filter((k)=>PLACEMENTS[k]);
      if (ownKeys.length) return {
        ...cfg,
        placements: ownKeys
      };
      return planPlacements.length ? {
        ...cfg,
        placements: planPlacements
      } : cfg;
    });
    // A carousel marked "Feed only" must not run in Reels/Stories/etc., where Meta crops or refuses carousels.
    if (creativeGroup.some((x)=>x.asset_type === "carousel" && x.feed_only)) adSetConfigs = adSetConfigs.map((cfg)=>({
        ...cfg,
        placements: [
          "fb_feed",
          "ig_feed"
        ]
      }));
    if (budgetProblems.length) return {
      error: `Nothing was launched. ${budgetProblems.join(" ")}`
    };
    const campaignName = creative.campaign_name?.trim() || `${productName} - ${/* @__PURE__ */ new Date().toLocaleDateString("en-NG")}`;
    const totalBudgetNaira = adSetConfigs.reduce((sum, c)=>sum + Number(c.budget_naira || 5e3), 0);
    const campaignPayload = {
      name: campaignName,
      objective: campaignObjective,
      special_ad_categories: specialCategory ? [
        specialCategory
      ] : [
        "NONE"
      ],
      status: liveStatus,
      access_token: META_ACCESS_TOKEN
    };
    if (specialCategory) {
      // Meta wants the country the special-category ads run in (US for a US realtor, NG by default).
      campaignPayload.special_ad_category_country = [
        ...new Set(adSetConfigs.flatMap((c)=>effectiveCountries(c)))
      ];
    }
    if (budgetType === "cbo") {
      campaignPayload.daily_budget = Math.round(totalBudgetNaira * 100);
      campaignPayload.bid_strategy = VALID_BID_STRATEGIES.includes(adSetConfigs[0]?.bid_strategy) ? adSetConfigs[0].bid_strategy : REAL_BID_STRATEGY;
    } else {
      campaignPayload.is_adset_budget_sharing_enabled = false;
    }
    const campaignRes = await fetch(`${META_GRAPH_BASE}/act_${accountId}/campaigns`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(campaignPayload)
    });
    const campaignData = await campaignRes.json();
    if (!campaignData.id) {
      console.error("Failed to create campaign:", campaignData);
      return {
        error: `Campaign creation failed: ${JSON.stringify(campaignData.error || campaignData)}`
      };
    }
    const campaignId = campaignData.id;
    const { data: campaignRow, error: campaignRowErr } = await supabase.from("campaigns").insert({
      meta_campaign_id: campaignId,
      campaign_name: campaignPayload.name,
      campaign_type: "testing",
      objective: campaignObjective,
      meta_raw: {
        special_ad_categories: campaignPayload.special_ad_categories
      },
      daily_budget_naira: budgetType === "abo" ? null : totalBudgetNaira,
      status: liveStatus === "PAUSED" ? "paused" : "active",
      ad_account_id: creative.ad_account_id,
      company_id: creative.company_id
    }).select("id").single();
    if (campaignRowErr || !campaignRow) {
      console.error("Failed to record local campaign row:", campaignRowErr);
      return {
        error: `Campaign "${campaignId}" was created on Meta but failed to save locally: ${campaignRowErr?.message}`
      };
    }
    const localCampaignId = campaignRow.id;
    const abortAndCleanup = async (errorMsg)=>{
      await fetch(`${META_GRAPH_BASE}/${campaignId}?access_token=${META_ACCESS_TOKEN}`, {
        method: "DELETE"
      }).catch(()=>{});
      await supabase.from("campaigns").delete().eq("id", localCampaignId);
      return {
        error: errorMsg
      };
    };
    const localCreatives = [];
    // Prepare every ad's media and Meta creative AT THE SAME TIME. One after the other, three videos each waiting up to 90 s for Meta
    // to process them ran past the ~150 s limit and the launch was killed half way (campaign made, no ads). Now the wait is that of the
    // slowest video, and it is capped so the launch can still finish and clean up after itself.
    const mediaBudgetMs = Math.max(15e3, 95e3 - (Date.now() - launchStartedAt));
    const prepared = await Promise.all(creativeGroup.map(async (copy)=>{
      const media = copy.asset_type === "post" || copy.asset_type === "carousel" ? {
        imageUrl: copy.public_url || null
      } : await ensureMetaMedia(supabase, accountId, copy, mediaBudgetMs);
      if (!media || media.error) return {
        copy,
        error: `Failed to upload media to Meta for creative ${copy.id} (${copy.file_name}): ${media?.error || "unknown error"}`
      };
      const adCreativeRes = await createAdCreative(accountId, pageId, igUserId, copy, media, destinationLink, ctaType, destinationType, creative.products?.product_name || "");
      const adCreativeId = adCreativeRes?.id;
      if (!adCreativeId) return {
        copy,
        error: `Failed to create ad creative on Meta for creative ${copy.id} (${copy.file_name}): ${adCreativeRes?.error || "no reason given"}`
      };
      return {
        copy,
        media,
        adCreativeId
      };
    }));
    const failedPrep = prepared.find((x)=>x.error);
    if (failedPrep) return await abortAndCleanup(failedPrep.error + (prepared.length > 1 ? " Nothing went live. Your videos stay uploaded to Meta, so launching again is faster." : ""));
    for (const { copy, media, adCreativeId } of prepared){
      const { data: localCreativeRow, error: localCreativeErr } = await supabase.from("creatives").insert({
        creative_name: String(copy.ad_name ?? "").trim() || `${productName}-${copy.file_name}`,
        format: copy.format || "customer_review",
        mechanism: copy.mechanism || "why_product_works",
        awareness_stage: "product_aware",
        primary_text: copy.primary_text,
        headline: copy.headline,
        description: copy.description,
        image_url: media.imageUrl || null,
        video_id: media.videoId || null,
        destination_link: destinationLink || null,
        cta_type: ctaType,
        meta_ad_id: adCreativeId,
        status: "testing",
        company_id: creative.company_id,
        launch_batch_id: copy.launch_batch_id || null
      }).select("id").single();
      if (localCreativeErr?.code === "23505") {
        const { data: existing } = await supabase.from("creatives").select("id").eq("meta_ad_id", adCreativeId).maybeSingle();
        if (existing) {
          localCreatives.push({
            id: existing.id,
            metaCreativeId: adCreativeId,
            fileName: copy.file_name,
            adName: String(copy.ad_name ?? "").trim(),
            adSetSortOrder: copy.ad_set_sort_order ?? null
          });
          continue;
        }
      }
      if (localCreativeErr || !localCreativeRow) {
        console.error("Failed to record local creative row:", localCreativeErr);
        return await abortAndCleanup(`Ad creative "${adCreativeId}" was created on Meta but failed to save locally: ${localCreativeErr?.message}`);
      }
      localCreatives.push({
        id: localCreativeRow.id,
        metaCreativeId: adCreativeId,
        fileName: copy.file_name,
        adName: String(copy.ad_name ?? "").trim(),
        adSetSortOrder: copy.ad_set_sort_order ?? null
      });
    }
    const localCreativeId = localCreatives[0].id;
    const createdAdSets = [];
    const adSetErrors = [];
    for (const config of adSetConfigs){
      const targeting = await buildTargetingFromConfig(config, destinationType, !!specialCategory);
      const label = config.label;
      if (targeting?.error) {
        console.error(`Ad set "${label}" skipped:`, targeting.error);
        adSetErrors.push(`"${label}": ${targeting.error}`);
        continue;
      }
      const customAdSetName = String(config.display_name ?? "").trim();
      const optimizationGoal = isForm ? "LEAD_GENERATION" : isMsg ? "CONVERSATIONS" : campaignObjective === "OUTCOME_SALES" ? VALID_WEBSITE_OPTIMIZATION_GOALS.includes(config.optimization_goal) ? config.optimization_goal : REAL_OPTIMIZATION_GOAL : objectiveDefaults.optimizationGoal;
      const bidStrategy = VALID_BID_STRATEGIES.includes(config.bid_strategy) ? config.bid_strategy : REAL_BID_STRATEGY;
      const billingEvent = VALID_BILLING_EVENTS.includes(config.billing_event) ? config.billing_event : "IMPRESSIONS";
      const adsetRes = await fetch(`${META_GRAPH_BASE}/act_${accountId}/adsets`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          campaign_id: campaignId,
          ...buildAdSetPayload({
            name: customAdSetName || `${label}-${creative.file_name.substring(0, 20)}-${Date.now()}`,
            budgetNaira: Number(config.budget_naira || 5e3),
            budgetType,
            targeting,
            promotedObject,
            optimizationGoal,
            bidStrategy,
            bidAmountNaira: config.bid_amount_naira ? Number(config.bid_amount_naira) : null,
            billingEvent,
            destinationType,
            objective: campaignObjective,
            lifecycle: config.lifecycle,
            status: liveStatus,
            startTime,
            endTime
          })
        })
      });
      const adsetData = await adsetRes.json();
      if (!adsetData.id) {
        console.error(`Failed to create ad set for "${label}":`, adsetData);
        adSetErrors.push(`"${label}": ${JSON.stringify(adsetData.error || adsetData)}`);
        continue;
      }
      const nationwideAdSet = !targeting.geo_locations?.regions && !targeting.geo_locations?.cities;
      const { data: row, error: rowErr } = await supabase.from("ad_sets").insert({
        campaign_id: localCampaignId,
        meta_adset_id: adsetData.id,
        adset_name: customAdSetName || `${label}-${creative.file_name}`,
        creative_id: localCreativeId,
        targeting_type: nationwideAdSet ? "broad" : config.geo_type === "states" ? "narrow" : "broad",
        budget_naira: budgetType === "abo" ? Number(config.budget_naira || 5e3) : null,
        ad_account_id: creative.ad_account_id,
        status: liveStatus === "PAUSED" ? "paused" : "active",
        age_min: config.age_min,
        age_max: config.age_max,
        genders: targeting.genders,
        states: nationwideAdSet ? null : config.states,
        countries: targeting.geo_locations?.countries?.length ? targeting.geo_locations.countries : effectiveCountries(config),
        optimization_goal: optimizationGoal,
        bid_strategy: bidStrategy,
        company_id: creative.company_id,
        media_buyer_id: creative.ad_accounts?.media_buyer_id || null
      }).select("id").single();
      if (row) {
        createdAdSets.push({
          row,
          metaId: adsetData.id,
          label,
          budgetNaira: Number(config.budget_naira || 5e3),
          sortOrder: config.sort_order ?? null
        });
      } else {
        console.error(`Ad set "${label}" (meta id ${adsetData.id}) created on Meta but failed to save locally:`, rowErr);
        adSetErrors.push(`"${label}": created on Meta (${adsetData.id}) but DB save failed: ${rowErr?.message}`);
      }
    }
    if (!createdAdSets.length) {
      const msg = `No ad sets were successfully created for creative batch ${creative.id}. ${adSetErrors.join(" | ")}`;
      console.error(msg);
      return await abortAndCleanup(msg);
    }
    for (const a of createdAdSets){
      for (const lc of localCreatives){
        if (lc.adSetSortOrder != null && a.sortOrder != null && lc.adSetSortOrder !== a.sortOrder) continue;
        const adId = await createAdWithCTA(a.metaId, lc.metaCreativeId, lc.adName || `AD-${a.label}-${lc.fileName.substring(0, 20)}-${Date.now()}`, accountId, liveStatus);
        if (!adId) {
          console.error(`Failed to create ad for "${a.label}" ad set with creative ${lc.id} (${lc.fileName})`);
          continue;
        }
        const { error: adSetAdErr } = await supabase.from("ad_set_ads").insert({
          ad_set_id: a.row.id,
          creative_id: lc.id,
          meta_ad_id: adId,
          company_id: creative.company_id
        });
        if (adSetAdErr) console.error(`Failed to record ad_set_ads for "${a.label}"/${lc.fileName}:`, adSetAdErr);
      }
    }
    return {
      campaign_id: campaignId,
      start_time: startTime,
      currency,
      ad_sets: createdAdSets.map((a)=>({
          meta_id: a.metaId,
          db_id: a.row.id,
          label: a.label,
          budgetNaira: a.budgetNaira
        }))
    };
  } catch (err) {
    console.error("Launch ad set group error:", err);
    return {
      error: `Unhandled error: ${err.message || err}`
    };
  }
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: CORS_HEADERS
    });
  }
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const caller = await getCaller(req, supabase);
    if (!caller) {
      return new Response(JSON.stringify({
        error: "Not signed in"
      }), {
        status: 401,
        headers: {
          "Content-Type": "application/json",
          ...CORS_HEADERS
        }
      });
    }
    // PRE-UPLOAD: send the videos of a plan to the ad account's Meta library right away, so Meta has processed them by the time the plan is approved.
    const peek = await req.clone().json().catch(()=>null);
    if (peek?.action === "prewarm") {
      const reply = (o, status = 200)=>new Response(JSON.stringify(o), {
          status,
          headers: {
            "Content-Type": "application/json",
            ...CORS_HEADERS
          }
        });
      const { data: acct } = await supabase.from("ad_accounts").select("id, meta_ad_account_id, company_id").eq("id", String(peek.ad_account_id ?? "")).maybeSingle();
      if (!acct || !caller.service && acct.company_id !== caller.company_id) return reply({
        error: "That ad account is not yours."
      }, 403);
      const act = String(acct.meta_ad_account_id ?? "").replace(/^act_/, "");
      if (!/^\d+$/.test(act)) return reply({
        ok: true,
        uploaded: 0
      });
      const ids = (Array.isArray(peek.asset_ids) ? peek.asset_ids : []).slice(0, 30);
      const { data: assets } = await supabase.from("creative_assets").select("id, public_url, asset_type").in("id", ids).eq("company_id", acct.company_id).eq("asset_type", "video");
      const urls = [
        ...new Set((assets ?? []).map((a)=>a.public_url).filter(Boolean))
      ];
      const { data: cached } = urls.length ? await supabase.from("meta_video_cache").select("public_url").eq("ad_account_id", acct.id).in("public_url", urls) : {
        data: []
      };
      const have = new Set((cached ?? []).map((x)=>x.public_url));
      let uploaded = 0;
      await Promise.all(urls.filter((u)=>!have.has(u)).map(async (u)=>{
        try {
          const r = await fetch(`${META_GRAPH_BASE}/act_${act}/advideos`, {
            method: "POST",
            body: new URLSearchParams({
              file_url: u,
              access_token: META_ACCESS_TOKEN
            })
          });
          const d = await r.json();
          if (d?.id) {
            await supabase.from("meta_video_cache").upsert({
              ad_account_id: acct.id,
              public_url: u,
              meta_video_id: d.id
            }, {
              onConflict: "ad_account_id,public_url"
            });
            uploaded++;
          } else console.error("prewarm upload failed:", d?.error || d);
        } catch (e) {
          console.error("prewarm error:", e);
        }
      }));
      return reply({
        ok: true,
        uploaded
      });
    }
    let requestedProductId = null;
    let requestedCreativeIds = null;
    try {
      const body = await req.json();
      requestedProductId = body?.product_id || null;
      requestedCreativeIds = Array.isArray(body?.creative_ids) && body.creative_ids.length ? body.creative_ids : null;
    } catch  {}
    let pendingQuery;
    if (requestedCreativeIds) {
      pendingQuery = supabase.from("creative_assets").select("*, ad_accounts(meta_ad_account_id, fb_page_id, meta_pixel_id, ig_user_id, media_buyer_id), products(product_name, landing_page_url, auto_post_enabled, destination_type, whatsapp_number, special_ad_category)").eq("test_status", "untested").in("id", requestedCreativeIds).order("uploaded_at", {
        ascending: true
      });
    } else if (requestedProductId) {
      pendingQuery = supabase.from("creative_assets").select("*, ad_accounts(meta_ad_account_id, fb_page_id, meta_pixel_id, ig_user_id, media_buyer_id), products(product_name, landing_page_url, auto_post_enabled, destination_type, whatsapp_number, special_ad_category)").eq("test_status", "untested").eq("product_id", requestedProductId).order("uploaded_at", {
        ascending: true
      }).limit(20);
    } else {
      pendingQuery = supabase.from("creative_assets").select("*, ad_accounts(meta_ad_account_id, fb_page_id, meta_pixel_id, ig_user_id, media_buyer_id), products!inner(product_name, landing_page_url, auto_post_enabled, destination_type, whatsapp_number, special_ad_category)").eq("test_status", "untested").eq("products.auto_post_enabled", true).order("uploaded_at", {
        ascending: true
      }).limit(5);
    }
    if (!caller.service) pendingQuery = pendingQuery.eq("company_id", caller.company_id);
    const { data: pendingCreatives, error: pendingErr } = await pendingQuery;
    if (pendingErr) {
      console.error("Failed to fetch pending creatives:", pendingErr);
      return new Response(JSON.stringify({
        error: pendingErr.message
      }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...CORS_HEADERS
        }
      });
    }
    if (!pendingCreatives || pendingCreatives.length === 0) {
      return new Response(JSON.stringify({
        message: "No pending creatives to launch",
        launched: 0
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...CORS_HEADERS
        }
      });
    }
    console.log(`📊 Processing ${pendingCreatives.length} creatives`);
    const groups = /* @__PURE__ */ new Map();
    for (const c of pendingCreatives){
      const key = c.launch_batch_id || `solo:${c.id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(c);
    }
    const launchPlans = [];
    let totalAdSetsCreated = 0;
    let totalBudgetNaira = 0;
    const launchErrors = [];
    const launchedGroups = [];
    for (const group of groups.values()){
      const anchor = group[0];
      if (anchor.ad_account_id) {
        const { data: acct } = await supabase.from("ad_accounts").select("billing_mode").eq("id", anchor.ad_account_id).maybeSingle();
        if (acct?.billing_mode === "managed") {
          const { data: w } = await supabase.rpc("account_wallet_balance", {
            p_account: anchor.ad_account_id
          });
          if (Number(w ?? 0) <= 0) {
            launchErrors.push(`"${anchor.file_name}": the wallet for this ad account is empty. Top up your wallet, then publish again.`);
            continue;
          }
        }
      }
      const result = await launchAdSetGroup(supabase, group);
      if ("error" in result) {
        launchErrors.push(`"${anchor.file_name}"${group.length > 1 ? ` +${group.length - 1} more copies` : ""}: ${result.error}`);
        continue;
      }
      totalAdSetsCreated += result.ad_sets.length;
      const adSetBudget = result.ad_sets.reduce((sum, a)=>sum + a.budgetNaira, 0);
      totalBudgetNaira += adSetBudget;
      const copyNames = group.map((c)=>c.file_name).join(", ");
      launchedGroups.push(group);
      launchPlans.push({
        creative_name: anchor.products?.product_name ? `${copyNames} (${anchor.products.product_name})` : copyNames,
        campaign_id: result.campaign_id,
        paused: anchor.launch_paused === true,
        start_time: result.start_time || null,
        currency: result.currency || "NGN"
      });
    }
    if (launchPlans.length === 0) {
      return new Response(JSON.stringify({
        error: launchErrors.length === 1 ? launchErrors[0] : "Failed to create any ad sets",
        details: launchErrors
      }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...CORS_HEADERS
        }
      });
    }
    const totalBudget = totalBudgetNaira;
    const cur = launchPlans[0].currency;
    for (const group of launchedGroups){
      for (const c of group){
        await supabase.from("creative_assets").update({
          test_status: "testing"
        }).eq("id", c.id);
      }
    }
    const allPaused = launchPlans.every((p)=>p.paused);
    const allScheduled = !allPaused && launchPlans.every((p)=>!p.paused && p.start_time && new Date(p.start_time).getTime() > Date.now());
    const scheduledWhen = allScheduled ? new Date(launchPlans[0].start_time).toLocaleString("en-NG", {
      timeZone: "Africa/Lagos",
      dateStyle: "medium",
      timeStyle: "short"
    }) : "";
    return new Response(JSON.stringify({
      success: true,
      status: allPaused ? "paused" : allScheduled ? "scheduled" : "live",
      scheduled_for: allScheduled ? launchPlans[0].start_time : void 0,
      creatives: launchPlans.length,
      ad_sets: totalAdSetsCreated,
      currency: cur,
      budget: totalBudget,
      budget_naira: totalBudget,
      campaign_ids: launchPlans.map((p)=>p.campaign_id),
      message: launchErrors.length ? `✅ Launched ${launchPlans.length} creative(s), but ${launchErrors.length} failed.` : allPaused ? `✅ Created ${launchPlans.length} creative(s) across ${totalAdSetsCreated} ad set(s) on Meta, PAUSED (nothing is spending). Turn it on in Ads Manager or in Revora when ready.` : allScheduled ? `✅ Scheduled ${launchPlans.length} creative(s) across ${totalAdSetsCreated} ad set(s) on Meta to start ${scheduledWhen} (Lagos time). It shows as Scheduled in Ads Manager and nothing spends until then; ${money(cur, totalBudget)}/day once it starts.` : `✅ Launched ${launchPlans.length} creative(s) across ${totalAdSetsCreated} ad set(s), ${money(cur, totalBudget)}/day total.`,
      errors: launchErrors.length ? launchErrors : void 0
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...CORS_HEADERS
      }
    });
  } catch (err) {
    console.error("Error:", err);
    return new Response(JSON.stringify({
      error: err.message
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        ...CORS_HEADERS
      }
    });
  }
});
