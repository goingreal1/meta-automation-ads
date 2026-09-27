import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Retired 2026-09-27 as part of the edge-function security cleanup: this
// function had a hardcoded bearer token in source and, when triggered,
// cloned whatever active campaign it found on ad account 643541631210844
// (the shared Beoliv/Yorvix account) into a brand new live campaign with
// real spend. Delete this function from the Supabase dashboard once
// confirmed unused -- this stub only exists because the deploy API can
// overwrite a function's code but can't remove the slug itself.
Deno.serve(() =>
  new Response("Retired.", { status: 410 })
);
