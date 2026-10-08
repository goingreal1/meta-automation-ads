# Revora MCP server (Claude app and ChatGPT)

The server is the Supabase edge function `mcp` in the Revora project.

    https://rrkhkhgdxhmogxxtbvyt.supabase.co/functions/v1/mcp

It speaks MCP over streamable HTTP (stateless JSON). Every tool runs **as the signed-in person**: the
connector signs the person in with their own Revora account (Supabase OAuth), and the access token is passed on to
`ai-chat` and `ads-manager`, so role rules (owner / admin / buyer) are the same as in the dashboard.

## Tools (25)

Read: `get_playbook`, `whoami`, `list_ad_accounts`, `get_live_ads`, `get_account_performance`, `list_products`,
`get_product`, `query_orders`, `get_wallet_balance`, `check_pixel`, `search_audiences`, `estimate_reach`,
`list_creatives`, `get_copy_context`, `write_ad_copy`.

Write (logged in `mcp_audit`, capped at 80 a day, launches capped at 5 a day): `save_product_facts`, `save_ad_copy`,
`import_past_ads`, `plan_campaign`, `update_plan`, `launch_plan` (needs `person_approved: true`), `cancel_plan`,
`set_status`, `set_budget`, `duplicate_ad`.

Not exposed on purpose: anything that moves money (transfers, fund approvals).

## One-time setup in the Supabase dashboard (project rrkhkhgdxhmogxxtbvyt)

1. Authentication, OAuth Server: turn it **on**.
2. Turn on **Allow dynamic OAuth apps** (Claude and ChatGPT register themselves).
3. Set the **Authorization path** to `/oauth/consent` on the site URL that serves `oauth/consent.html`
   (for example `https://metaautomationads.vercel.app/oauth/consent`). If the site has no clean URLs, use
   `/oauth/consent.html`.
4. Authentication, URL configuration: add that consent URL to the allowed redirect URLs, and make sure the Site URL is
   the production domain.

Check: `GET .../functions/v1/mcp/.well-known/oauth-protected-resource` lists `.../auth/v1` as the authorization server,
and `GET .../auth/v1/.well-known/oauth-authorization-server` returns metadata once the OAuth server is on.

## Add it to Claude

Settings, Connectors, Add custom connector. Name: Revora. URL: the address above. Sign in with the Revora account and
tap Allow. In a chat, the prompts "Run my ads" and "Launch ads for a product" are available.

## Add it to ChatGPT

Settings, Connectors, Advanced, turn on Developer mode, then Create. Name: Revora, MCP server URL: the address above,
authentication: OAuth. Sign in and Allow. (Needs a plan that has developer-mode connectors.)

## Safety notes

- Launching creates ACTIVE ads and spends money. `launch_plan` refuses unless the assistant passes
  `person_approved: true`, and the tool description tells the assistant to ask for a clear yes to the exact plan first.
  The client app also asks the person before running tools marked destructive.
- Revoke access: Supabase, Authentication, OAuth apps (or the person signs out everywhere). Tokens are ordinary
  Supabase JWTs and expire on the usual schedule.
- `mcp_audit` records the tool, arguments, user and result of every write call.
