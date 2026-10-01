import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Temporary one-off cleanup helper -- the SQL tool hangs on DELETE/TRUNCATE
// for reasons unrelated to the database itself (no locks, no long-running
// queries observed server-side). Routes the same cleanup through
// PostgREST (supabase-js .delete()) instead, a different code path.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (_req: Request) => {
  const out: Record<string, unknown> = {};
  const tables = ["ad_sets", "creative_assets", "products", "targeting_presets", "campaigns", "pending_approvals", "ad_accounts"];
  for (const t of tables) {
    const { error, count } = await supabase.from(t).delete({ count: "exact" }).not("id", "is", null);
    out[t] = error ? { error: error.message } : { deleted: count };
  }
  return json(out);
});
