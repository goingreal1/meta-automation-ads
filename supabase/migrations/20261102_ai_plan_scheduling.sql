create table if not exists public.ai_plan_options (
  plan_id uuid primary key,
  company_id uuid not null,
  start_time timestamptz,
  end_time timestamptz,
  placements text[],
  device_platforms text[],
  advantage_audience boolean,
  updated_at timestamptz not null default now()
);
alter table public.ai_plan_options enable row level security;

-- Copies a plan's start/end time onto the ads staged for it when the person approves the launch.
create or replace function public.apply_ai_plan_schedule() returns trigger
language plpgsql security definer set search_path = public as $$
declare o record;
begin
  if NEW.uploaded_by is distinct from 'ai_chat' or NEW.launch_batch_id is null or NEW.company_id is null then return NEW; end if;
  select po.* into o from ai_plan_options po
    join ai_plans ap on ap.id = po.plan_id
   where ap.company_id = NEW.company_id and ap.status = 'launching'
     and ap.plan->>'campaign_name' = NEW.campaign_name
   order by ap.created_at desc limit 1;
  if found then
    if o.start_time is not null then NEW.scheduled_for := o.start_time; end if;
    if o.end_time is not null then NEW.campaign_end_date := o.end_time; end if;
  end if;
  return NEW;
end $$;

drop trigger if exists trg_apply_ai_plan_schedule on public.creative_assets;
create trigger trg_apply_ai_plan_schedule before insert on public.creative_assets
  for each row execute function public.apply_ai_plan_schedule();
