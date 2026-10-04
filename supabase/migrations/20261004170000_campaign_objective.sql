-- The campaign builder's new objective step (Sales/Traffic/Engagement/
-- Awareness -- chosen first, since it determines which optimization goal
-- and promoted_object are even legal). Defaults to OUTCOME_SALES, the only
-- objective this app has ever launched, so every existing row keeps
-- launching exactly as it did before this column existed.
alter table creative_assets add column if not exists campaign_objective text not null default 'OUTCOME_SALES';
