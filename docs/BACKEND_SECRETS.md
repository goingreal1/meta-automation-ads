# Secrets the edge functions read

Names only. Never put values in the repo. Set them on the new Supabase project (Edge Functions -> Secrets). `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_DB_URL` are provided by Supabase automatically.

Meta, Paystack, WhatsApp, OpenAI, Resend, Telnyx/ElevenLabs and Vercel values stay the same as today: copy them from the old project's secrets page (or the original provider dashboards). `CRON_SECRET` can be regenerated, but then `public.app_secrets.ads_cron_secret` must hold the same value.

| Secret | Used by (functions) |
|---|---|
| `META_ACCESS_TOKEN` | 33: activate-lunessa-retargeting, ad-account-pool, ads-manager, ai-auto-launch-tests ... |
| `PAYSTACK_SECRET_KEY` | 13: ai-chat, fund-request-send, fund-request-submit, mcp-money ... |
| `BEOLIV_WHATSAPP_ACCESS_TOKEN` | 10: notify-customer, send-internal-whatsapp, send-payment-whatsapp, send-welcome-whatsapp ... |
| `BEOLIV_WHATSAPP_PHONE_NUMBER_ID` | 9: notify-customer, send-internal-whatsapp, send-payment-whatsapp, send-welcome-whatsapp ... |
| `CRON_SECRET` | 7: check-low-ad-balances, managed-guard, place-order-call, social-publisher ... |
| `OPENAI_API_KEY` | 7: ai-chat, ai-sales-reply, ai-site-builder, draft-ad-copy ... |
| `WHATSAPP_ACCESS_TOKEN` | 7: ai-sales-reply, handle-whatsapp-reply, pull-meta-metrics, send-kpi-report ... |
| `WHATSAPP_PHONE_NUMBER_ID` | 6: ai-sales-reply, handle-whatsapp-reply, pull-meta-metrics, send-kpi-report ... |
| `META_APP_ID` | 5: manage-whatsapp-numbers, meta-oauth-callback, meta-oauth-start, pull-meta-metrics ... |
| `META_APP_SECRET` | 4: manage-whatsapp-numbers, meta-oauth-callback, pull-meta-metrics, whatsapp-platform |
| `META_BUSINESS_ID` | 4: debug-meta-config, hq-pixel, link-page, sync-partner-accounts |
| `META_PIXEL_ID` | 4: ai-auto-launch-tests, meta-capi, meta-lead-webhook, receive-order |
| `META_AD_ACCOUNT_ID` | 3: auto-duplicate-adsets, meta-campaign-inspector, meta-lead-campaign-creator |
| `META_PAGE_ID` | 3: meta-campaign-inspector, meta-lead-campaign-creator, meta-lead-webhook |
| `IMAGE_MODEL` | 2: mcp, mcp-studio |
| `META_OAUTH_STATE_SECRET` | 2: meta-oauth-callback, meta-oauth-start |
| `PAYSTACK_PREFERRED_BANK` | 2: paystack-create-account, paystack-create-company-account |
| `RESEND_API_KEY` | 2: send-company-invite, send-internal-email |
| `RESEND_FROM_EMAIL` | 2: send-company-invite, send-internal-email |
| `WEBHOOK_VERIFY_TOKEN` | 2: handle-whatsapp-reply, meta-lead-webhook |
| `WHATSAPP_TPL_CUSTOMER_CONFIRMED` | 2: notify-customer, send-payment-whatsapp |
| `ADMIN_WHATSAPP_NUMBER` | 1: send-kpi-report |
| `AI_BUILDER_DAILY_LIMIT` | 1: ai-site-builder |
| `ALERT_TO_NUMBER` | 1: pull-meta-metrics |
| `BEOLIV_WEBSITE_URL` | 1: send-whatsapp-buttons |
| `BUSINESS_NAME` | 1: place-order-call |
| `CAPI_ALLOWED_ORIGIN` | 1: meta-capi |
| `DAILY_BUDGET_LIMIT_NAIRA` | 1: pull-meta-metrics |
| `DASHBOARD_BASE_URL` | 1: send-company-invite |
| `DASHBOARD_URL` | 1: meta-oauth-callback |
| `ELEVENLABS_AGENT_ID` | 1: place-order-call |
| `ELEVENLABS_API_KEY` | 1: place-order-call |
| `ELEVENLABS_PHONE_NUMBER_ID` | 1: place-order-call |
| `ELEVENLABS_WEBHOOK_SECRET` | 1: elevenlabs-webhook |
| `FB_ACCESS_TOKEN` | 1: meta-capi |
| `FB_PIXEL_ID` | 1: meta-capi |
| `IMAGE_DAILY_CAP` | 1: mcp-studio |
| `MCP_TRANSFER_DAY_MAX` | 1: mcp-money |
| `MCP_TRANSFER_MAX` | 1: mcp-money |
| `META_CREATOR_KEY` | 1: meta-lead-campaign-creator |
| `META_INSPECTOR_KEY` | 1: meta-campaign-inspector |
| `META_LEAD_CRM_NAME` | 1: meta-lead-webhook |
| `META_LEAD_VERIFY_TOKEN` | 1: meta-lead-webhook |
| `META_LOGIN_CONFIG_ID` | 1: meta-oauth-start |
| `META_LOOKALIKE_SEED_AUDIENCE_ID` | 1: sync-meta-audiences |
| `META_PAGE_ACCESS_TOKEN` | 1: meta-lead-webhook |
| `META_RETARGETING_AUDIENCE_ID` | 1: sync-meta-audiences |
| `REVORA_WABA_ID` | 1: whatsapp-platform |
| `VERCEL_API_TOKEN` | 1: manage-domain |
| `VERCEL_SITES_PROJECT_ID` | 1: manage-domain |
| `VERCEL_TEAM_ID` | 1: manage-domain |
| `WHATSAPP_ES_CONFIG_ID` | 1: manage-whatsapp-numbers |
| `WHATSAPP_TPL_AGENT_ACCEPTED` | 1: notify-customer |
| `WHATSAPP_TPL_AGENT_CONFIRMED` | 1: send-payment-whatsapp |
| `WHATSAPP_TPL_AGENT_REQUEST` | 1: send-payment-whatsapp |
| `WHATSAPP_TPL_CUSTOMER_REQUEST` | 1: send-payment-whatsapp |
| `WHATSAPP_TPL_FUND_REQUEST_DECIDED` | 1: send-internal-whatsapp |
| `WHATSAPP_TPL_FUND_REQUEST_SUBMITTED` | 1: send-internal-whatsapp |
| `WHATSAPP_TPL_LOW_BALANCE` | 1: send-internal-whatsapp |
| `WHATSAPP_TPL_ORDER_DELIVERED` | 1: notify-customer |
| `WHATSAPP_TPL_ORDER_FOLLOWUP` | 1: stuck-order-followup |
| `WHATSAPP_TPL_ORDER_PREPARING` | 1: notify-customer |
| `WHATSAPP_TPL_ORDER_RECEIVED` | 1: notify-customer |
| `WHATSAPP_TPL_OUT_FOR_DELIVERY` | 1: notify-customer |
| `WHATSAPP_TPL_PAYMENT_CONFIRMED_ADMIN` | 1: send-internal-whatsapp |
| `WHATSAPP_TPL_POST_APPROVAL` | 1: social-admin |
| `WHATSAPP_TPL_TRANSFER_FAILED` | 1: send-internal-whatsapp |
| `WHATSAPP_TPL_TRANSFER_SENT` | 1: send-internal-whatsapp |
| `WHATSAPP_TPL_WELCOME` | 1: send-welcome-whatsapp |

## Also stored in the database table `public.app_secrets` (copied with the data, rows only)
`ads_cron_secret`, `vapid_public`, `vapid_private`, `support_whatsapp`, `support_company_id`, `reel_render_key`, `shipbubble_api_key`, `shipbubble_dispatch`, `launch_whatsapp`, `rider_assignment`
