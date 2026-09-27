import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Retired 2026-09-27: one-off manual utility, unauthenticated, superseded by
// upload-creative for anything production uses today. Delete from the
// Supabase dashboard once confirmed unused.
Deno.serve(() =>
  new Response("Retired.", { status: 410 })
);
