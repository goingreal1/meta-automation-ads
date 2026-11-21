-- Real Anthropic spend of the learner, counted from what each call reports, with a monthly safety cap.
create table if not exists public.learn_usage (
  day date not null, model text not null,
  calls int not null default 0, input_tokens bigint not null default 0, output_tokens bigint not null default 0, cost_usd numeric not null default 0,
  primary key (day, model)
);
alter table public.learn_usage enable row level security;
insert into public.app_secrets (key, value) values ('learn_vision_cap_usd', '5') on conflict (key) do nothing;
