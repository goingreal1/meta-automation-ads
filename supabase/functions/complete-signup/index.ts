import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// The one and only place a `profiles` row gets created. profiles has no
// client-side INSERT/UPDATE policy at all (see the Phase 1 migration) --
// role and company_id are only ever set here, under the service role, so a
// signed-up user can never grant themselves 'owner'/'admin' or attach
// themselves to a company they weren't invited into.
//
// Called right after supabase.auth.signUp() succeeds, with that same user's
// session token:
//
//   POST { mode: "create", company_name }        -> new company, caller becomes its owner
//   POST { mode: "join", invite_token }           -> caller joins the invite's company/role

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "company";
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = base;
  for (let i = 0; i < 50; i++) {
    const { data } = await supabase.from("companies").select("id").eq("slug", slug).maybeSingle();
    if (!data) return slug;
    slug = `${base}-${Math.floor(Math.random() * 10000)}`;
  }
  throw new Error("Could not find an available company URL -- try a different name.");
}

// Gives a self-joining buyer a real media_buyers row automatically, so ROAS
// attribution works from day one without an admin having to separately add
// them in Settings. Code comes from their email's local part, deduped with
// a numeric suffix if it collides with an existing buyer's code.
async function ensureMediaBuyer(companyId: string, email: string, displayName: string | null): Promise<string | null> {
  const base = (email.split("@")[0] || "BUYER").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 16).toUpperCase() || "BUYER";
  let code = base;
  for (let i = 0; i < 50; i++) {
    const { data: existing } = await supabase.from("media_buyers").select("id").eq("company_id", companyId).eq("code", code).maybeSingle();
    if (!existing) break;
    code = `${base}${i + 2}`;
  }
  const { data: buyer, error } = await supabase.from("media_buyers")
    .insert({ company_id: companyId, code, name: displayName || email, active: true })
    .select("id").single();
  if (error) {
    console.error("ensureMediaBuyer failed:", error.message);
    return null;
  }
  return buyer.id;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
      },
    });
  }

  try {
    const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!token) return json({ error: "Missing Authorization bearer token." }, 401);
    const { data: userData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !userData?.user) return json({ error: "Invalid or expired session -- sign in again." }, 401);
    const user = userData.user;

    const { data: existingProfile } = await supabase.from("profiles").select("company_id, role").eq("id", user.id).maybeSingle();
    if (existingProfile?.company_id) {
      return json({ company_id: existingProfile.company_id, role: existingProfile.role, already_set_up: true });
    }

    const body = await req.json().catch(() => ({}));
    const mode = body?.mode as string | undefined;

    if (mode === "create") {
      const companyName = (body?.company_name as string | undefined)?.trim();
      if (!companyName) return json({ error: "company_name is required." }, 400);

      const slug = await uniqueSlug(slugify(companyName));
      const { data: company, error: companyErr } = await supabase.from("companies")
        .insert({ name: companyName, slug }).select("id").single();
      if (companyErr || !company) throw new Error(`Could not create company: ${companyErr?.message}`);

      const { error: profileErr } = await supabase.from("profiles").upsert({
        id: user.id, company_id: company.id, role: "owner", display_name: body?.display_name ?? null,
      });
      if (profileErr) throw new Error(`Could not create owner profile: ${profileErr.message}`);

      return json({ company_id: company.id, role: "owner" });
    }

    if (mode === "join") {
      const inviteToken = (body?.invite_token as string | undefined)?.trim();
      if (!inviteToken) return json({ error: "invite_token is required." }, 400);

      // Optimistic-locking consume: only succeeds if it's still unused. Two
      // people racing to use the same link can't both get in on it.
      const { data: invite, error: inviteErr } = await supabase.from("company_invites")
        .update({ used_at: new Date().toISOString(), used_by: user.id })
        .eq("token", inviteToken)
        .is("used_at", null)
        .gt("expires_at", new Date().toISOString())
        .select("company_id, role")
        .maybeSingle();
      if (inviteErr) throw new Error(`Could not verify invite: ${inviteErr.message}`);
      if (!invite) return json({ error: "This invite link is invalid, expired, or already used -- ask for a new one." }, 400);

      let mediaBuyerId: string | null = null;
      if (invite.role === "buyer") {
        mediaBuyerId = await ensureMediaBuyer(invite.company_id, user.email ?? "", body?.display_name ?? null);
      }

      const { error: profileErr } = await supabase.from("profiles").upsert({
        id: user.id, company_id: invite.company_id, role: invite.role,
        media_buyer_id: mediaBuyerId, display_name: body?.display_name ?? null,
      });
      if (profileErr) throw new Error(`Could not create profile: ${profileErr.message}`);

      return json({ company_id: invite.company_id, role: invite.role });
    }

    return json({ error: "mode must be 'create' or 'join'." }, 400);
  } catch (err: any) {
    console.error("complete-signup error:", err);
    return json({ error: err.message }, 500);
  }
});
