import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Retired 2026-09-27: unauthenticated fetch-and-upload proxy (fetched any
// caller-supplied URL and pushed it to a hardcoded live Meta ad account).
// Delete from the Supabase dashboard once confirmed unused.
Deno.serve(() =>
  new Response("Retired.", { status: 410 })
);
