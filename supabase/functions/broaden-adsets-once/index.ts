import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Retired 2026-09-27: unauthenticated endpoint that mutated live targeting
// (age range, geo, Advantage+ audience) on any caller-supplied adset_id.
// Delete from the Supabase dashboard once confirmed unused.
Deno.serve(() =>
  new Response("Retired.", { status: 410 })
);
