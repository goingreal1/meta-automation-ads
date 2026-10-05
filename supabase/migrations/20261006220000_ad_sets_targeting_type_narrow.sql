-- Launch with specific states/cities writes targeting_type 'narrow' (and auto-duplicate writes narrow_v1/narrow_v2),
-- which the old check rejected -- the ad set was created on Meta but failed to save here.
alter table ad_sets drop constraint if exists ad_sets_targeting_type_check;
alter table ad_sets add constraint ad_sets_targeting_type_check
  check (targeting_type = any (array['broad','interest','lookalike','retargeting','narrow','narrow_v1','narrow_v2']));
