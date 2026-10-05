-- Budget changes (scale up/down) are logged next to pauses/resumes.
alter table ad_kill_log drop constraint if exists ad_kill_log_action_check;
alter table ad_kill_log add constraint ad_kill_log_action_check check (action in ('paused', 'resumed', 'scaled'));
