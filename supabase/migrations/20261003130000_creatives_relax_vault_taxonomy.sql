-- format/mechanism/awareness_stage are the Creative Vault's own testing
-- taxonomy (what hook, what angle) -- meaningful for a creative someone
-- uploaded and categorized through the Vault, meaningless for an ad pulled
-- straight back from Meta via sync-meta-structure, which has no way to know
-- any of that. All three were NOT NULL with restrictive check constraints,
-- so sync-meta-structure's creatives upsert has been failing on every
-- single ad, every single sync, since the day it was written -- confirmed
-- live: "null value in column \"format\" ... violates not-null constraint"
-- on all 9 ads in the most recent run. Relaxing to nullable rather than
-- forcing a fake category value that would misrepresent real data in the
-- Vault's own filters.

alter table creatives alter column format drop not null;
alter table creatives alter column mechanism drop not null;
alter table creatives alter column awareness_stage drop not null;
