-- Captured from the live production database (project rrkhkhgdxhmogxxtbvyt) on 2026-11-17. Apply in file order on a NEW Supabase project.
alter table public.ad_accounts enable row level security;
alter table public.ad_kill_log enable row level security;
alter table public.ad_library enable row level security;
alter table public.ad_review_watch enable row level security;
alter table public.ad_set_ads enable row level security;
alter table public.ad_set_configs enable row level security;
alter table public.ad_sets enable row level security;
alter table public.admin_withdrawals enable row level security;
alter table public.ai_builder_usage enable row level security;
alter table public.ai_inbox enable row level security;
alter table public.ai_plan_options enable row level security;
alter table public.ai_plans enable row level security;
alter table public.ai_sales_agents enable row level security;
alter table public.ai_settings enable row level security;
alter table public.app_secrets enable row level security;
alter table public.applications enable row level security;
alter table public.assignment_offers enable row level security;
alter table public.beoliv_order_events enable row level security;
alter table public.beoliv_orders enable row level security;
alter table public.billing_payments enable row level security;
alter table public.buyer_whatsapp_numbers enable row level security;
alter table public.campaign_clone_runs enable row level security;
alter table public.campaign_drafts enable row level security;
alter table public.campaigns enable row level security;
alter table public.commission_brackets enable row level security;
alter table public.companies enable row level security;
alter table public.company_domains enable row level security;
alter table public.company_invites enable row level security;
alter table public.company_settings enable row level security;
alter table public.conversation_customers enable row level security;
alter table public.conversations enable row level security;
alter table public.countries enable row level security;
alter table public.creative_assets enable row level security;
alter table public.creatives enable row level security;
alter table public.daily_metrics enable row level security;
alter table public.delivery_agents enable row level security;
alter table public.edit_links enable row level security;
alter table public.event_logs enable row level security;
alter table public.first_delivery_watch enable row level security;
alter table public.fund_requests enable row level security;
alter table public.housing_events enable row level security;
alter table public.kill_keep_decisions enable row level security;
alter table public.kill_rules enable row level security;
alter table public.launch_approvals enable row level security;
alter table public.leads enable row level security;
alter table public.mcp_audit enable row level security;
alter table public.media_buyers enable row level security;
alter table public.media_upload_requests enable row level security;
alter table public.messages enable row level security;
alter table public.meta_connections enable row level security;
alter table public.monthly_summary enable row level security;
alter table public.narrow_targeting_presets enable row level security;
alter table public.order_events enable row level security;
alter table public.order_items enable row level security;
alter table public.order_notifications enable row level security;
alter table public.orders enable row level security;
alter table public.payment_match_requests enable row level security;
alter table public.payments enable row level security;
alter table public.paystack_customers enable row level security;
alter table public.pending_approvals enable row level security;
alter table public.personal_earnings enable row level security;
alter table public.plan_edit_links enable row level security;
alter table public.platform_admins enable row level security;
alter table public.product_images enable row level security;
alter table public.product_tiers enable row level security;
alter table public.products enable row level security;
alter table public.profiles enable row level security;
alter table public.properties enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.rule_performance enable row level security;
alter table public.sellable_ad_accounts enable row level security;
alter table public.shipbubble_events enable row level security;
alter table public.site_domains enable row level security;
alter table public.site_file_versions enable row level security;
alter table public.site_files enable row level security;
alter table public.site_page_backups enable row level security;
alter table public.site_pages enable row level security;
alter table public.sites enable row level security;
alter table public.social_assets enable row level security;
alter table public.social_posts enable row level security;
alter table public.social_settings enable row level security;
alter table public.social_wa_batches enable row level security;
alter table public.support_messages enable row level security;
alter table public.support_threads enable row level security;
alter table public.support_tickets enable row level security;
alter table public.system_settings enable row level security;
alter table public.targeting_presets enable row level security;
alter table public.targeting_rules enable row level security;
alter table public.telnyx_webhook_events enable row level security;
alter table public.tracking_snippets enable row level security;
alter table public.transfer_allowed_names enable row level security;
alter table public.transfer_approvals enable row level security;
alter table public.transfer_pins enable row level security;
alter table public.transfer_receipts enable row level security;
alter table public.upload_links enable row level security;
alter table public.voice_calls enable row level security;
alter table public.wallet_adjustments enable row level security;
alter table public.wallet_requests enable row level security;
alter table public.wallet_topups enable row level security;
alter table public.webhook_debug_log enable row level security;
alter table public.website_leads enable row level security;
alter table public.weekly_reports enable row level security;
alter table public.whatsapp_number_requests enable row level security;

create policy ad_accounts_company_all on public.ad_accounts as PERMISSIVE for ALL to authenticated using (((company_id = current_company_id()) AND ((current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text])) OR (media_buyer_id = ( SELECT p.media_buyer_id
   FROM profiles p
  WHERE (p.id = auth.uid()))) OR (EXISTS ( SELECT 1
   FROM (meta_connections mc
     JOIN profiles p ON ((p.media_buyer_id = mc.media_buyer_id)))
  WHERE ((mc.id = ad_accounts.meta_connection_id) AND (p.id = auth.uid()))))))) with check ((company_id = current_company_id()));
create policy ad_kill_log_read on public.ad_kill_log as PERMISSIVE for SELECT to public using ((company_id = current_company_id()));
create policy ad_library_select on public.ad_library as PERMISSIVE for SELECT to authenticated using ((company_id = ( SELECT profiles.company_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
create policy ad_review_watch_company_all on public.ad_review_watch as PERMISSIVE for ALL to authenticated using ((company_id = current_company_id())) with check ((company_id = current_company_id()));
create policy ad_set_ads_company_all on public.ad_set_ads as PERMISSIVE for ALL to authenticated using ((company_id = current_company_id())) with check ((company_id = current_company_id()));
create policy ad_set_configs_company_all on public.ad_set_configs as PERMISSIVE for ALL to authenticated using ((company_id = current_company_id())) with check ((company_id = current_company_id()));
create policy ad_sets_company_all on public.ad_sets as PERMISSIVE for ALL to authenticated using (((company_id = current_company_id()) AND ((current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text])) OR (media_buyer_id = ( SELECT p.media_buyer_id
   FROM profiles p
  WHERE (p.id = auth.uid())))))) with check ((company_id = current_company_id()));
create policy admin_withdrawals_admin_all on public.admin_withdrawals as PERMISSIVE for ALL to public using (((company_id = current_company_id()) AND (current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text])))) with check (((company_id = current_company_id()) AND (current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text]))));
create policy ai_inbox_own_select on public.ai_inbox as PERMISSIVE for SELECT to authenticated using ((profile_id = auth.uid()));
create policy ai_inbox_own_update on public.ai_inbox as PERMISSIVE for UPDATE to authenticated using ((profile_id = auth.uid())) with check ((profile_id = auth.uid()));
create policy ai_plans_select on public.ai_plans as PERMISSIVE for SELECT to authenticated using ((company_id = ( SELECT profiles.company_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
create policy ai_agents_access on public.ai_sales_agents as PERMISSIVE for ALL to authenticated using (((company_id = ( SELECT profiles.company_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))) AND ((( SELECT profiles.role
   FROM profiles
  WHERE (profiles.id = auth.uid())) = ANY (ARRAY['owner'::text, 'admin'::text])) OR (EXISTS ( SELECT 1
   FROM buyer_whatsapp_numbers n
  WHERE ((n.id = ai_sales_agents.buyer_whatsapp_number_id) AND (n.media_buyer_id IS NOT NULL) AND (n.media_buyer_id = ( SELECT profiles.media_buyer_id
           FROM profiles
          WHERE (profiles.id = auth.uid()))))))))) with check (((company_id = ( SELECT profiles.company_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))) AND ((( SELECT profiles.role
   FROM profiles
  WHERE (profiles.id = auth.uid())) = ANY (ARRAY['owner'::text, 'admin'::text])) OR (EXISTS ( SELECT 1
   FROM buyer_whatsapp_numbers n
  WHERE ((n.id = ai_sales_agents.buyer_whatsapp_number_id) AND (n.media_buyer_id IS NOT NULL) AND (n.media_buyer_id = ( SELECT profiles.media_buyer_id
           FROM profiles
          WHERE (profiles.id = auth.uid())))))))));
create policy ai_settings_read on public.ai_settings as PERMISSIVE for SELECT to authenticated using (true);
create policy ai_settings_write on public.ai_settings as PERMISSIVE for ALL to authenticated using ((( SELECT profiles.role
   FROM profiles
  WHERE (profiles.id = auth.uid())) = ANY (ARRAY['owner'::text, 'admin'::text]))) with check ((( SELECT profiles.role
   FROM profiles
  WHERE (profiles.id = auth.uid())) = ANY (ARRAY['owner'::text, 'admin'::text])));
create policy applications_company_all on public.applications as PERMISSIVE for ALL to public using ((company_id = current_company_id())) with check ((company_id = current_company_id()));
create policy assignment_offers_company_scoped on public.assignment_offers as PERMISSIVE for ALL to public using (((company_id = current_company_id()) AND ((current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text, 'customer_care'::text])) OR ((current_user_role() = 'delivery_agent'::text) AND (delivery_agent_id = ( SELECT p.delivery_agent_id
   FROM profiles p
  WHERE (p.id = auth.uid()))))))) with check ((company_id = current_company_id()));
create policy beoliv_order_events_company_all on public.beoliv_order_events as PERMISSIVE for ALL to authenticated using ((company_id = current_company_id())) with check ((company_id = current_company_id()));
create policy beoliv_orders_company_all on public.beoliv_orders as PERMISSIVE for ALL to authenticated using ((company_id = current_company_id())) with check ((company_id = current_company_id()));
create policy billing_payments_select on public.billing_payments as PERMISSIVE for SELECT to authenticated using (((company_id = ( SELECT profiles.company_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['owner'::text, 'admin'::text])))))));
create policy buyer_whatsapp_numbers_company_scoped on public.buyer_whatsapp_numbers as PERMISSIVE for ALL to public using (((company_id = current_company_id()) AND ((current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text])) OR (media_buyer_id = ( SELECT p.media_buyer_id
   FROM profiles p
  WHERE (p.id = auth.uid())))))) with check ((company_id = current_company_id()));
create policy "No public access" on public.campaign_clone_runs as PERMISSIVE for ALL to public using (false);
create policy campaign_drafts_own on public.campaign_drafts as PERMISSIVE for ALL to authenticated using ((profile_id = auth.uid())) with check ((profile_id = auth.uid()));
create policy campaigns_company_all on public.campaigns as PERMISSIVE for ALL to authenticated using (((company_id = current_company_id()) AND ((current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text])) OR (EXISTS ( SELECT 1
   FROM ad_accounts aa
  WHERE ((aa.id = campaigns.ad_account_id) AND (aa.media_buyer_id = ( SELECT p.media_buyer_id
           FROM profiles p
          WHERE (p.id = auth.uid())))))) OR (EXISTS ( SELECT 1
   FROM ((ad_accounts aa
     JOIN meta_connections mc ON ((mc.id = aa.meta_connection_id)))
     JOIN profiles p ON ((p.media_buyer_id = mc.media_buyer_id)))
  WHERE ((aa.id = campaigns.ad_account_id) AND (p.id = auth.uid()))))))) with check ((company_id = current_company_id()));
create policy commission_brackets_company_all on public.commission_brackets as PERMISSIVE for ALL to authenticated using ((company_id = current_company_id())) with check ((company_id = current_company_id()));
create policy companies_member_select on public.companies as PERMISSIVE for SELECT to authenticated using ((id = current_company_id()));
create policy company_domains_admin_write on public.company_domains as PERMISSIVE for ALL to authenticated using (((company_id = current_company_id()) AND is_company_admin())) with check (((company_id = current_company_id()) AND is_company_admin()));
create policy company_domains_member_select on public.company_domains as PERMISSIVE for SELECT to authenticated using ((company_id = current_company_id()));
create policy company_invites_admin_delete on public.company_invites as PERMISSIVE for DELETE to authenticated using (((company_id = current_company_id()) AND is_company_admin()));
create policy company_invites_admin_insert on public.company_invites as PERMISSIVE for INSERT to authenticated with check (((company_id = current_company_id()) AND is_company_admin()));
create policy company_invites_admin_select on public.company_invites as PERMISSIVE for SELECT to authenticated using (((company_id = current_company_id()) AND is_company_admin()));
create policy company_settings_admin_all on public.company_settings as PERMISSIVE for ALL to public using (((company_id = current_company_id()) AND (current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text]))));
create policy beoliv_customers_company_all on public.conversation_customers as PERMISSIVE for ALL to authenticated using (((company_id = current_company_id()) AND ((current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text, 'customer_care'::text])) OR (EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.customer_id = conversation_customers.id) AND (c.media_buyer_id = ( SELECT p.media_buyer_id
           FROM profiles p
          WHERE (p.id = auth.uid()))))))))) with check ((company_id = current_company_id()));
create policy beoliv_conversations_company_all on public.conversations as PERMISSIVE for ALL to authenticated using (((company_id = current_company_id()) AND ((current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text, 'customer_care'::text])) OR (media_buyer_id = ( SELECT p.media_buyer_id
   FROM profiles p
  WHERE (p.id = auth.uid())))))) with check ((company_id = current_company_id()));
create policy countries_read_all on public.countries as PERMISSIVE for SELECT to anon, authenticated using (true);
create policy creative_assets_company_all on public.creative_assets as PERMISSIVE for ALL to authenticated using ((company_id = current_company_id())) with check ((company_id = current_company_id()));
create policy creatives_company_all on public.creatives as PERMISSIVE for ALL to authenticated using ((company_id = current_company_id())) with check ((company_id = current_company_id()));
create policy daily_metrics_company_all on public.daily_metrics as PERMISSIVE for ALL to authenticated using (((company_id = current_company_id()) AND ((current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text])) OR (EXISTS ( SELECT 1
   FROM ad_sets s
  WHERE ((s.id = daily_metrics.ad_set_id) AND (s.media_buyer_id = ( SELECT p.media_buyer_id
           FROM profiles p
          WHERE (p.id = auth.uid())))))) OR (EXISTS ( SELECT 1
   FROM ad_accounts aa
  WHERE ((aa.id = daily_metrics.ad_account_id) AND (aa.media_buyer_id = ( SELECT p.media_buyer_id
           FROM profiles p
          WHERE (p.id = auth.uid())))))) OR ((ad_set_id IS NULL) AND (EXISTS ( SELECT 1
   FROM ((ad_accounts aa
     JOIN meta_connections mc ON ((mc.id = aa.meta_connection_id)))
     JOIN profiles p ON ((p.media_buyer_id = mc.media_buyer_id)))
  WHERE ((aa.id = daily_metrics.ad_account_id) AND (p.id = auth.uid())))))))) with check ((company_id = current_company_id()));
create policy delivery_agents_company_isolation on public.delivery_agents as PERMISSIVE for ALL to public using ((company_id = current_company_id())) with check ((company_id = current_company_id()));
create policy service_role_all on public.event_logs as PERMISSIVE for ALL to public using ((auth.role() = 'service_role'::text));
create policy first_delivery_watch_company_all on public.first_delivery_watch as PERMISSIVE for ALL to authenticated using ((company_id = current_company_id())) with check ((company_id = current_company_id()));
create policy fund_requests_admin_all on public.fund_requests as PERMISSIVE for ALL to public using (((company_id = current_company_id()) AND (current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text])))) with check (((company_id = current_company_id()) AND (current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text]))));
create policy fund_requests_buyer_insert on public.fund_requests as PERMISSIVE for INSERT to public with check (false);
create policy fund_requests_buyer_read on public.fund_requests as PERMISSIVE for SELECT to public using (((company_id = current_company_id()) AND (current_user_role() = 'buyer'::text) AND (media_buyer_id = ( SELECT p.media_buyer_id
   FROM profiles p
  WHERE (p.id = auth.uid())))));
create policy housing_events_company_read on public.housing_events as PERMISSIVE for SELECT to public using ((company_id = current_company_id()));
create policy kill_keep_decisions_company_all on public.kill_keep_decisions as PERMISSIVE for ALL to authenticated using ((company_id = current_company_id())) with check ((company_id = current_company_id()));
create policy kill_rules_own on public.kill_rules as PERMISSIVE for ALL to public using (((profile_id = auth.uid()) OR ((company_id = current_company_id()) AND (current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text]))))) with check (((profile_id = auth.uid()) OR ((company_id = current_company_id()) AND (current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text])))));
create policy service_role_all on public.leads as PERMISSIVE for ALL to public using ((auth.role() = 'service_role'::text));
create policy media_buyers_company_all on public.media_buyers as PERMISSIVE for ALL to authenticated using (((company_id = current_company_id()) AND (current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text])))) with check (((company_id = current_company_id()) AND (current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text]))));
create policy media_buyers_read on public.media_buyers as PERMISSIVE for SELECT to authenticated using (((company_id = current_company_id()) AND ((current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text, 'customer_care'::text])) OR (id = ( SELECT p.media_buyer_id
   FROM profiles p
  WHERE (p.id = auth.uid()))))));
create policy media_buyers_self_update on public.media_buyers as PERMISSIVE for UPDATE to authenticated using (((company_id = current_company_id()) AND (id = ( SELECT p.media_buyer_id
   FROM profiles p
  WHERE (p.id = auth.uid()))))) with check (((company_id = current_company_id()) AND (id = ( SELECT p.media_buyer_id
   FROM profiles p
  WHERE (p.id = auth.uid())))));
create policy beoliv_messages_company_all on public.messages as PERMISSIVE for ALL to authenticated using (((company_id = current_company_id()) AND ((current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text, 'customer_care'::text])) OR (EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = messages.conversation_id) AND (c.media_buyer_id = ( SELECT p.media_buyer_id
           FROM profiles p
          WHERE (p.id = auth.uid()))))))))) with check ((company_id = current_company_id()));
create policy meta_connections_company_scoped on public.meta_connections as PERMISSIVE for ALL to public using (((company_id = current_company_id()) AND ((current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text])) OR (media_buyer_id = ( SELECT p.media_buyer_id
   FROM profiles p
  WHERE (p.id = auth.uid())))))) with check (((company_id = current_company_id()) AND ((current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text])) OR (media_buyer_id = ( SELECT p.media_buyer_id
   FROM profiles p
  WHERE (p.id = auth.uid()))))));
create policy monthly_summary_company_all on public.monthly_summary as PERMISSIVE for ALL to authenticated using ((company_id = current_company_id())) with check ((company_id = current_company_id()));
create policy narrow_targeting_presets_company_all on public.narrow_targeting_presets as PERMISSIVE for ALL to authenticated using ((company_id = current_company_id())) with check ((company_id = current_company_id()));
create policy order_events_company_scoped on public.order_events as PERMISSIVE for SELECT to public using (((company_id = current_company_id()) AND (current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text, 'customer_care'::text]))));
create policy order_items_company_all on public.order_items as PERMISSIVE for ALL to authenticated using ((company_id = current_company_id())) with check ((company_id = current_company_id()));
create policy order_notifications_read on public.order_notifications as PERMISSIVE for SELECT to authenticated using ((EXISTS ( SELECT 1
   FROM orders o
  WHERE (o.id = order_notifications.order_id))));
create policy orders_company_scoped on public.orders as PERMISSIVE for ALL to authenticated using (((company_id = current_company_id()) AND (current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text])))) with check (((company_id = current_company_id()) AND (current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text]))));
create policy orders_read on public.orders as PERMISSIVE for SELECT to authenticated using (((company_id = current_company_id()) AND ((current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text])) OR ((current_user_role() = 'customer_care'::text) AND (care_agent_id = auth.uid())) OR (media_buyer_id = ( SELECT p.media_buyer_id
   FROM profiles p
  WHERE (p.id = auth.uid()))) OR ((current_user_role() = 'delivery_agent'::text) AND (delivery_agent_id = ( SELECT p.delivery_agent_id
   FROM profiles p
  WHERE (p.id = auth.uid())))))));
create policy orders_update on public.orders as PERMISSIVE for UPDATE to authenticated using (((company_id = current_company_id()) AND ((current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text])) OR ((current_user_role() = 'customer_care'::text) AND (care_agent_id = auth.uid())) OR (media_buyer_id = ( SELECT p.media_buyer_id
   FROM profiles p
  WHERE (p.id = auth.uid()))) OR ((current_user_role() = 'delivery_agent'::text) AND (delivery_agent_id = ( SELECT p.delivery_agent_id
   FROM profiles p
  WHERE (p.id = auth.uid()))))))) with check ((company_id = current_company_id()));
create policy pmr_admin_all on public.payment_match_requests as PERMISSIVE for ALL to public using (((company_id = current_company_id()) AND (current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text])))) with check (((company_id = current_company_id()) AND (current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text]))));
create policy pmr_buyer_insert on public.payment_match_requests as PERMISSIVE for INSERT to public with check (((company_id = current_company_id()) AND (current_user_role() = 'buyer'::text) AND (status = 'pending'::text) AND (media_buyer_id = ( SELECT p.media_buyer_id
   FROM profiles p
  WHERE (p.id = auth.uid()))) AND (EXISTS ( SELECT 1
   FROM payments pay
  WHERE ((pay.id = payment_match_requests.payment_id) AND (pay.company_id = pay.company_id) AND (pay.held_for_buyer_id = pay.media_buyer_id) AND (pay.status = 'confirmed'::text) AND (pay.order_id IS NULL)))) AND (EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = payment_match_requests.order_id) AND (o.company_id = o.company_id) AND (o.media_buyer_id = o.media_buyer_id))))));
create policy pmr_buyer_read on public.payment_match_requests as PERMISSIVE for SELECT to public using (((company_id = current_company_id()) AND (current_user_role() = 'buyer'::text) AND (media_buyer_id = ( SELECT p.media_buyer_id
   FROM profiles p
  WHERE (p.id = auth.uid())))));
create policy payments_admin_all on public.payments as PERMISSIVE for ALL to public using (((company_id = current_company_id()) AND (current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text])))) with check (((company_id = current_company_id()) AND (current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text]))));
create policy payments_buyer_held_read on public.payments as PERMISSIVE for SELECT to public using (((company_id = current_company_id()) AND (current_user_role() = 'buyer'::text) AND (held_for_buyer_id IS NOT NULL) AND (held_for_buyer_id = ( SELECT p.media_buyer_id
   FROM profiles p
  WHERE (p.id = auth.uid())))));
create policy payments_buyer_read on public.payments as PERMISSIVE for SELECT to public using (((company_id = current_company_id()) AND ((current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text, 'customer_care'::text])) OR ((current_user_role() = 'buyer'::text) AND (media_buyer_id = ( SELECT p.media_buyer_id
   FROM profiles p
  WHERE (p.id = auth.uid())))) OR ((current_user_role() = 'delivery_agent'::text) AND (order_id IN ( SELECT o.id
   FROM (orders o
     JOIN profiles p ON ((p.delivery_agent_id = o.delivery_agent_id)))
  WHERE (p.id = auth.uid())))))));
create policy paystack_customers_admin_all on public.paystack_customers as PERMISSIVE for ALL to public using (((company_id = current_company_id()) AND (current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text])))) with check (((company_id = current_company_id()) AND (current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text]))));
create policy pending_approvals_company_all on public.pending_approvals as PERMISSIVE for ALL to authenticated using ((company_id = current_company_id())) with check ((company_id = current_company_id()));
create policy personal_earnings_admin_all on public.personal_earnings as PERMISSIVE for ALL to authenticated using (((company_id = current_company_id()) AND (current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text])))) with check (((company_id = current_company_id()) AND (current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text]))));
create policy personal_earnings_company_all on public.personal_earnings as PERMISSIVE for ALL to authenticated using (((company_id = current_company_id()) AND (current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text])))) with check (((company_id = current_company_id()) AND (current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text]))));
create policy unused_deny_all on public.personal_earnings as PERMISSIVE for SELECT to authenticated using (false);
create policy product_tiers_company_all on public.product_tiers as PERMISSIVE for ALL to public using ((company_id = current_company_id())) with check ((company_id = current_company_id()));
create policy products_company_all on public.products as PERMISSIVE for ALL to authenticated using ((company_id = current_company_id())) with check ((company_id = current_company_id()));
create policy profiles_company_select on public.profiles as PERMISSIVE for SELECT to authenticated using ((company_id = current_company_id()));
create policy profiles_self_select on public.profiles as PERMISSIVE for SELECT to authenticated using ((id = auth.uid()));
create policy profiles_self_update on public.profiles as PERMISSIVE for UPDATE to public using ((id = auth.uid())) with check ((id = auth.uid()));
create policy properties_company_all on public.properties as PERMISSIVE for ALL to public using ((company_id = current_company_id())) with check ((company_id = current_company_id()));
create policy push_subscriptions_own on public.push_subscriptions as PERMISSIVE for ALL to authenticated using ((user_id = auth.uid())) with check ((user_id = auth.uid()));
create policy rule_performance_company_all on public.rule_performance as PERMISSIVE for ALL to authenticated using ((company_id = current_company_id())) with check ((company_id = current_company_id()));
create policy site_domains_read on public.site_domains as PERMISSIVE for SELECT to authenticated using (((company_id = current_company_id()) AND ((current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text, 'customer_care'::text])) OR (media_buyer_id = current_buyer_id()))));
create policy site_file_versions_company_select on public.site_file_versions as PERMISSIVE for SELECT to public using ((company_id = current_company_id()));
create policy site_files_company_select on public.site_files as PERMISSIVE for SELECT to public using ((company_id = current_company_id()));
create policy site_page_backups_company_select on public.site_page_backups as PERMISSIVE for SELECT to public using ((company_id = current_company_id()));
create policy site_pages_company on public.site_pages as PERMISSIVE for ALL to authenticated using (false) with check (false);
create policy site_pages_scoped on public.site_pages as PERMISSIVE for ALL to authenticated using (((company_id = current_company_id()) AND ((current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text, 'customer_care'::text])) OR (EXISTS ( SELECT 1
   FROM sites s
  WHERE ((s.id = site_pages.site_id) AND (s.media_buyer_id = current_buyer_id()))))))) with check (((company_id = current_company_id()) AND ((current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text, 'customer_care'::text])) OR (EXISTS ( SELECT 1
   FROM sites s
  WHERE ((s.id = site_pages.site_id) AND (s.media_buyer_id = current_buyer_id())))))));
create policy sites_company on public.sites as PERMISSIVE for ALL to authenticated using (false) with check (false);
create policy sites_scoped on public.sites as PERMISSIVE for ALL to authenticated using (((company_id = current_company_id()) AND ((current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text, 'customer_care'::text])) OR (media_buyer_id = current_buyer_id())))) with check (((company_id = current_company_id()) AND ((current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text, 'customer_care'::text])) OR (media_buyer_id = current_buyer_id()))));
create policy st_own on public.support_tickets as PERMISSIVE for SELECT to public using ((user_id = auth.uid()));
create policy system_settings_company_all on public.system_settings as PERMISSIVE for ALL to authenticated using ((company_id = current_company_id())) with check ((company_id = current_company_id()));
create policy targeting_presets_company_all on public.targeting_presets as PERMISSIVE for ALL to authenticated using ((company_id = current_company_id())) with check ((company_id = current_company_id()));
create policy targeting_rules_company_all on public.targeting_rules as PERMISSIVE for ALL to authenticated using ((company_id = current_company_id())) with check ((company_id = current_company_id()));
create policy tracking_snippets_company on public.tracking_snippets as PERMISSIVE for ALL to authenticated using ((company_id = current_company_id())) with check ((company_id = current_company_id()));
create policy transfer_names_admin_all on public.transfer_allowed_names as PERMISSIVE for ALL to authenticated using (((company_id = current_company_id()) AND (current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text])))) with check (((company_id = current_company_id()) AND (current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text]))));
create policy "company members read receipts" on public.transfer_receipts as PERMISSIVE for SELECT to authenticated using ((company_id IN ( SELECT profiles.company_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
create policy voice_calls_company_scoped on public.voice_calls as PERMISSIVE for ALL to public using (((company_id = current_company_id()) AND ((current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text, 'customer_care'::text])) OR (order_id IN ( SELECT o.id
   FROM orders o
  WHERE (o.media_buyer_id = ( SELECT p.media_buyer_id
           FROM profiles p
          WHERE (p.id = auth.uid())))))))) with check ((company_id = current_company_id()));
create policy wallet_adjustments_read on public.wallet_adjustments as PERMISSIVE for SELECT to public using ((company_id = ( SELECT profiles.company_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
create policy wallet_requests_read on public.wallet_requests as PERMISSIVE for SELECT to authenticated using (((company_id = ( SELECT profiles.company_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))) AND ((media_buyer_id = ( SELECT profiles.media_buyer_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))) OR (( SELECT profiles.role
   FROM profiles
  WHERE (profiles.id = auth.uid())) = ANY (ARRAY['owner'::text, 'admin'::text])))));
create policy wallet_topups_read on public.wallet_topups as PERMISSIVE for SELECT to authenticated using (((company_id = ( SELECT profiles.company_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))) AND ((media_buyer_id IS NULL) OR (media_buyer_id = ( SELECT profiles.media_buyer_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))) OR (( SELECT profiles.role
   FROM profiles
  WHERE (profiles.id = auth.uid())) = ANY (ARRAY['owner'::text, 'admin'::text])))));
create policy website_leads_company_all on public.website_leads as PERMISSIVE for ALL to authenticated using ((company_id = current_company_id())) with check ((company_id = current_company_id()));
create policy weekly_reports_company_all on public.weekly_reports as PERMISSIVE for ALL to authenticated using ((company_id = current_company_id())) with check ((company_id = current_company_id()));
create policy wnr_read on public.whatsapp_number_requests as PERMISSIVE for SELECT to public using ((company_id IN ( SELECT profiles.company_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
create policy ad_fit_insert_own on storage.objects as PERMISSIVE for INSERT to authenticated with check (((bucket_id = 'ad-fit'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
create policy draft_media_own on storage.objects as PERMISSIVE for ALL to authenticated using (((bucket_id = 'draft-media'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))) with check (((bucket_id = 'draft-media'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
create policy site_media_write on storage.objects as PERMISSIVE for ALL to authenticated using (((bucket_id = 'site-media'::text) AND ((storage.foldername(name))[1] = (current_company_id())::text))) with check (((bucket_id = 'site-media'::text) AND ((storage.foldername(name))[1] = (current_company_id())::text)));
