import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Retired 2026-09-27: unauthenticated endpoint that mutated live daily_budget
// / bid_strategy on any caller-supplied adset_id. Delete from the Supabase
// dashboard once confirmed unused.
Deno.serve(() =>
  new Response("Retired.", { status: 410 })
);
