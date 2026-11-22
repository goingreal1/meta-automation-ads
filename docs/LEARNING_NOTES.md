# learn_notes: the daily learning notes

Short plain-words notes about what the system learned. Built for a knowledge base (RAG) to ingest later, so the table is small and stable.

## Table `public.learn_notes`
| column | type | meaning |
|---|---|---|
| id | uuid | primary key |
| company_id | uuid | the business the note belongs to (private to it) |
| day | date | the day the note is about (Lagos date; the writer runs at 03:20 UTC for the day before) |
| kind | text | `lesson`, `finding`, `autopilot_run` or `failure` |
| title | text | one line; with (company_id, day, kind) it is unique, so re-running a day replaces the note |
| body_md | text | the note, plain words, markdown |
| source_refs | jsonb | ids the note was made from, so it can be traced back (see below) |
| created_at | timestamptz | when it was written |

RLS: a company's owner or admin can read their own rows. Only the service role writes.

## Kinds and source_refs
- `lesson`: a new lesson from the pattern finder (`learn_lessons`, first seen that day; the business's own, plus new global ones). `{lesson_id, scope}`.
- `finding`: a winning video taken apart scene by scene (`learn_videos`, analysed that day) `{video_id, ad_id}`, or the sales pages read that day (`learn_pages`) `{urls[]}`.
- `autopilot_run`: what an autopilot run did and how it ended (steps, result so far, hard stop, open items), one note per run per day it changed. `{run_id, status}`.
- `failure`: what failed that day and why (failed autopilot steps, failed launches, failed ad pictures). `{items[]}`.

## How it is written
`ai-team` action `learn_notes` (no new edge function), called daily by pg_cron job `learn-notes-daily` with the cron secret. Optional body `{"day":"YYYY-MM-DD"}` writes an earlier day. The text is built from rows already in the database by `supabase/functions/_shared/learn_notes.ts` (pure, tested in `learn_notes.test.ts`): no model call, no Meta call, no spend.

## For the knowledge base
Ingest rows by `created_at`/`day`; `title + body_md` is the text, `company_id` is the owner (keep it private to that company), `source_refs` points to the originals.
