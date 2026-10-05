-- AI sales agent: one business profile per connected WhatsApp number, so each buyer/company's AI only
-- talks about THAT business (media buying on one number, food on another).
create table if not exists ai_sales_agents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  buyer_whatsapp_number_id uuid not null unique references buyer_whatsapp_numbers(id) on delete cascade,
  mode text not null default 'off' check (mode in ('off', 'first', 'full')),
  business_name text,
  agent_name text,
  business_type text,
  offer text,
  proof text,
  how_to_buy text,
  faqs text,
  rules text,
  opener text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table ai_sales_agents enable row level security;

create policy ai_agents_access on ai_sales_agents for all to authenticated
  using (
    company_id = (select company_id from profiles where id = auth.uid())
    and (
      (select role from profiles where id = auth.uid()) in ('owner', 'admin')
      or exists (
        select 1 from buyer_whatsapp_numbers n
        where n.id = ai_sales_agents.buyer_whatsapp_number_id
          and n.media_buyer_id is not null
          and n.media_buyer_id = (select media_buyer_id from profiles where id = auth.uid())
      )
    )
  )
  with check (
    company_id = (select company_id from profiles where id = auth.uid())
    and (
      (select role from profiles where id = auth.uid()) in ('owner', 'admin')
      or exists (
        select 1 from buyer_whatsapp_numbers n
        where n.id = ai_sales_agents.buyer_whatsapp_number_id
          and n.media_buyer_id is not null
          and n.media_buyer_id = (select media_buyer_id from profiles where id = auth.uid())
      )
    )
  );

-- When a customer message lands on a number whose AI agent is switched on, wake the ai-sales-reply function.
-- Wrapped so a problem here can never block the message from being saved.
create or replace function trg_ai_sales_reply() returns trigger language plpgsql security definer set search_path = public as $$
declare v_secret text;
begin
  if new.direction = 'inbound' and new.message_type in ('text', 'audio', 'image', 'button', 'interactive', 'document', 'video')
     and exists (
       select 1 from conversations c join ai_sales_agents a on a.buyer_whatsapp_number_id = c.buyer_whatsapp_number_id
       where c.id = new.conversation_id and a.mode <> 'off'
     ) then
    select value into v_secret from app_secrets where key = 'ads_cron_secret';
    perform net.http_post(
      url := 'https://rrkhkhgdxhmogxxtbvyt.supabase.co/functions/v1/ai-sales-reply',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
      body := jsonb_build_object('message_id', new.id),
      timeout_milliseconds := 60000
    );
  end if;
  return new;
exception when others then
  return new;
end $$;

drop trigger if exists ai_sales_reply_on_inbound on messages;
create trigger ai_sales_reply_on_inbound after insert on messages
  for each row when (new.direction = 'inbound') execute function trg_ai_sales_reply();
