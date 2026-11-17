-- Captured from the live production database (project rrkhkhgdxhmogxxtbvyt) on 2026-11-17. Apply in file order on a NEW Supabase project.
-- Triggers on public tables, then on auth.users (if any).
CREATE TRIGGER ad_accounts_guard_billing BEFORE INSERT OR UPDATE ON public.ad_accounts FOR EACH ROW EXECUTE FUNCTION guard_ad_account_billing();
CREATE TRIGGER ad_sets_assign_media_buyer BEFORE INSERT OR UPDATE OF adset_name, campaign_id ON public.ad_sets FOR EACH ROW EXECUTE FUNCTION ad_sets_assign_media_buyer();
CREATE TRIGGER ad_sets_auto_media_buyer BEFORE INSERT OR UPDATE ON public.ad_sets FOR EACH ROW EXECUTE FUNCTION set_ad_set_media_buyer();
CREATE TRIGGER ai_plans_wa_launched AFTER UPDATE OF status ON public.ai_plans FOR EACH ROW EXECUTE FUNCTION trg_launch_wa_launched();
CREATE TRIGGER trg_apply_ai_plan_schedule BEFORE INSERT ON public.creative_assets FOR EACH ROW EXECUTE FUNCTION apply_ai_plan_schedule();
CREATE TRIGGER fund_requests_guard BEFORE INSERT OR UPDATE ON public.fund_requests FOR EACH ROW EXECUTE FUNCTION guard_fund_requests();
CREATE TRIGGER launch_approvals_wa_prepare AFTER INSERT ON public.launch_approvals FOR EACH ROW EXECUTE FUNCTION trg_launch_wa_prepare();
CREATE TRIGGER leads_resolve_customer BEFORE INSERT OR UPDATE OF phone ON public.leads FOR EACH ROW EXECUTE FUNCTION trg_leads_resolve_customer();
CREATE TRIGGER media_buyers_guard BEFORE UPDATE ON public.media_buyers FOR EACH ROW EXECUTE FUNCTION media_buyers_guard_columns();
CREATE TRIGGER media_buyers_guard_auto_send BEFORE INSERT OR UPDATE ON public.media_buyers FOR EACH ROW EXECUTE FUNCTION guard_auto_send_cols();
CREATE TRIGGER ai_sales_reply_on_inbound AFTER INSERT ON public.messages FOR EACH ROW WHEN ((new.direction = 'inbound'::text)) EXECUTE FUNCTION trg_ai_sales_reply();
CREATE TRIGGER trg_bv_on_message_insert AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION bv_on_message_insert();
CREATE TRIGGER orders_adjust_stock AFTER UPDATE OF order_status ON public.orders FOR EACH ROW EXECUTE FUNCTION trg_orders_adjust_stock();
CREATE TRIGGER orders_assign_care BEFORE INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION orders_assign_care();
CREATE TRIGGER orders_assign_media_buyer BEFORE INSERT OR UPDATE OF ad_set_id ON public.orders FOR EACH ROW EXECUTE FUNCTION orders_assign_media_buyer();
CREATE TRIGGER orders_audit_log AFTER UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION trg_orders_audit_log();
CREATE TRIGGER orders_capi_paid AFTER UPDATE OF order_status ON public.orders FOR EACH ROW EXECUTE FUNCTION trg_orders_capi_paid();
CREATE TRIGGER orders_guard BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION orders_guard_columns();
CREATE TRIGGER orders_notify_care AFTER INSERT OR UPDATE OF care_agent_id ON public.orders FOR EACH ROW EXECUTE FUNCTION trg_notify_care();
CREATE TRIGGER orders_notify_customer AFTER INSERT OR UPDATE OF order_status, assignment_status, delivery_stage ON public.orders FOR EACH ROW EXECUTE FUNCTION trg_notify_customer();
CREATE TRIGGER orders_resolve_customer BEFORE INSERT OR UPDATE OF customer_phone ON public.orders FOR EACH ROW EXECUTE FUNCTION trg_orders_resolve_customer();
CREATE TRIGGER orders_shipbubble_dispatch AFTER INSERT OR UPDATE OF order_status ON public.orders FOR EACH ROW EXECUTE FUNCTION trg_orders_shipbubble_dispatch();
CREATE TRIGGER orders_spam_guard BEFORE INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION orders_spam_guard();
CREATE TRIGGER trg_set_product_owner BEFORE INSERT ON public.products FOR EACH ROW EXECUTE FUNCTION set_product_owner();
CREATE TRIGGER trg_zz_product_default_ad_account BEFORE INSERT ON public.products FOR EACH ROW EXECUTE FUNCTION set_product_default_ad_account();
CREATE TRIGGER profiles_guard_privilege BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION prevent_profile_privilege_escalation();
CREATE TRIGGER website_leads_resolve_customer BEFORE INSERT OR UPDATE OF phone ON public.website_leads FOR EACH ROW EXECUTE FUNCTION trg_website_leads_resolve_customer();
