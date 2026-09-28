# Edge function registry

Supabase project: `rrkhkhgdxhmogxxtbvyt`. This file is the source of truth for
what's deployed and why. Every function deployed to Supabase should have a
matching entry here and a matching directory in `supabase/functions/`.

Going forward: deploy from git (`supabase functions deploy <name>`), not
straight from the laptop. Nothing should exist in Supabase that doesn't
exist in this repo.

## Production (live automation, don't touch without reading first)

| Function | Role |
|---|---|
| `receive-order` | Order intake from order forms |
| `place-order-call` | Triggers ElevenLabs voice confirmation call |
| `elevenlabs-webhook` | Post-call webhook (transcript, outcome, safety flags) |
| `pull-meta-metrics` | Pulls Meta ad insights into `daily_metrics` (ROAS attribution) |
| `upload-creative` | Creative uploads to Storage + `creative_assets` |
| `upload-product-image` | Product image uploads |
| `get-product-public` | Public, read-only product lookup for order pages |
| `meta-oauth-start` / `meta-oauth-callback` | Per-buyer Meta account connection |
| `complete-signup` | Company/profile creation (multi-tenancy) |
| `meta-capi` | Meta Conversions API sender |
| `sync-meta-audiences` / `sync-meta-structure` | Meta account structure sync |
| `create-retargeting-audiences` | Retargeting audience creation |
| `activate-lunessa-retargeting` | Lunessa retargeting (current version — see "superseded" below) |
| `consolidate-lunessa` | Lunessa campaign consolidation |
| `auto-launch-tests` / `ai-auto-launch-tests` / `auto-duplicate-adsets` | Automated test/duplication launches |
| `check-account-status` | Ad account health check |
| `diagnose-meta-token` | Meta token diagnostics |
| `handle-whatsapp-reply` | Inbound WhatsApp reply handling |
| `send-whatsapp-message` / `send-whatsapp-buttons` / `send-whatsapp-flow` / `send-whatsapp-media` / `send-whatsapp-template` | WhatsApp Cloud API senders |
| `submit-website-lead` | Website lead intake |
| `debug-webhook-echo` | Deliberately kept — generic webhook payload echo, used when debugging any inbound webhook |
| `meta-lead-webhook` | **Second, parallel lead intake pipeline** (Meta Lead Ads → `leads`/`event_logs`). Not yet company_id-aware — see open issues below. |
| `meta-campaign-inspector` | Key-protected (`x-inspector-key`) read-only diagnostic — still useful, kept |
| `meta-lead-campaign-creator` | Key-protected (`x-creator-key`) campaign creation/pause tool — still useful, kept |
| `send-kpi-report` | WhatsApp KPI report — duplicates `pull-meta-metrics`' insights fetch independently (see open issues) |

## Retired (redeployed as dead 410 stubs on 2026-09-27 — see git history for what they used to do)

These were unauthenticated and could mutate live ad spend or leak a secret.
The Supabase deploy API can overwrite a function's code but can't remove its
slug, so each now just returns `410 Gone`. **Delete these from the Supabase
dashboard** (Edge Functions → function → Delete) whenever convenient — the
stub is safe to leave indefinitely if you'd rather not:

- `yorvix-campaign-clone` — had a hardcoded bearer token in source; cloned whatever active campaign it found on the shared Beoliv/Yorvix ad account (`643541631210844`) into a new live campaign. Confirmed dead per your call — the campaign it cloned isn't running anymore.
- `edit-adsets-once` — unauthenticated, changed budget/bid strategy on any adset_id supplied by the caller.
- `broaden-adsets-once` — unauthenticated, changed targeting on any adset_id supplied by the caller.
- `upload-video-once` — unauthenticated fetch-and-upload proxy to a live ad account.
- `upload-video-resumable` — same one-off pattern, superseded by `upload-creative`.
- `pause-adsets-once` — unauthenticated, paused any adset_id supplied by the caller.

## Still live in Supabase, not yet cleaned up (harmless read-only or superseded — safe to delete via dashboard, low priority)

Diagnostics (`debug-*`), one-off launch scripts (`*-once`, `beoliv-v2-*`),
and superseded duplicates. None of these write to production tables except
where noted, and none are on any recurring schedule as far as this audit
found:

`debug-adset-status`, `debug-ads-check`, `debug-account-fields`,
`debug-adset-detail`, `debug-ad-issues`, `debug-ad-full-creative`,
`debug-ad-library-test`, `debug-ad-library-test2`, `debug-get-creative-ids`,
`debug-identify-id`, `debug-list-campaigns`, `debug-video-source`,
`debug-image-source`, `debug-page-info`, `beoliv-rebuild-once`,
`beoliv-go-live-once`, `beoliv-v2-launch-once`, `beoliv-v2-account-launch-once`,
`beoliv-v2-structure-only`, `beoliv-v2-text-ads`, `beoliv-v2-refresh`,
`beoliv-v2-rebuild-scheduled`, `beoliv-sales-page-preview`,
`lunessa-retargeting-launch-once`, `lunessa-retargeting-launch-fix`
(both superseded by `activate-lunessa-retargeting`), `check-lunessa-ad-review`,
`diagnose-lunessa`, `post-to-page-once`, `check-real-lead-count`,
`check-page-webhook-subscription`, `list-lead-forms`, `send-leads-to-meta-capi`.

**Before deleting `beoliv-v2-rebuild-scheduled` or anything else with
"scheduled" in the name**, check for a `pg_cron` job pointing at it —
`check-lunessa-ad-review` was found calling
`cron_unschedule_lunessa_watch()`, which means at least one ad hoc cron job
exists in the live DB outside any migration file. Run
`select * from cron.job;` to see them all before deleting anything.

## Open issues (tracked, not yet fixed)

1. `meta-lead-webhook` needs `company_id` support — it's a live production
   pipeline that will silently mix leads across companies once a second
   company onboards.
2. `send-kpi-report` re-implements `pull-meta-metrics`' insights fetch
   independently instead of reading `daily_metrics`. Two codepaths computing
   the same numbers will eventually disagree. Should be refactored to read
   from `daily_metrics`.
3. Meta Graph API version is inconsistent across functions (v18–v22 mixed).
   Should be pinned to one version and bumped deliberately.
