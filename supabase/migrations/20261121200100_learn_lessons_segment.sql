-- Lessons are only comparable within the same kind of result: ads judged on purchases and ads judged on messages are separate worlds.
alter table public.learn_lessons add column if not exists segment text not null default 'all';
drop index if exists public.learn_lessons_key;
create unique index learn_lessons_key on public.learn_lessons (scope, coalesce(company_id::text, ''), segment, feature, value);
delete from public.learn_lessons;
