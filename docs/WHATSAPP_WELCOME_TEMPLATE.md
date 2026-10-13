# Welcome WhatsApp template (revora_welcome_v1)

Sent by `send-welcome-whatsapp`, called from `complete-signup` the moment a new owner finishes company setup (only when they gave a phone number).

## Submit in WhatsApp Manager (Message templates -> Create template)

| Field | Value |
|---|---|
| Category | Utility (Meta may reclassify it as Marketing; both work, Marketing costs more per message) |
| Name | `revora_welcome_v1` |
| Language | English |
| Header / Footer | none |
| Body | `Hi {{1}}, welcome to Revora! 🎉 I'm here to help you connect your ad account and add your first product. What would you like to do first?` |
| Body sample for {{1}} | `Kola` |
| Buttons | Type: Quick reply. Button 1: `Connect my ad account`. Button 2: `Add my product`. Button 3: `Talk to a person` |

Use a different name? Set the secret `WHATSAPP_TPL_WELCOME` on the `send-welcome-whatsapp` function.

## Deploy
1. Deploy the new `send-welcome-whatsapp` function and the updated `complete-signup` function in Supabase.
2. It uses the same secrets as the other WhatsApp senders: `BEOLIV_WHATSAPP_ACCESS_TOKEN`, `BEOLIV_WHATSAPP_PHONE_NUMBER_ID`.
3. Until the template is approved the send just fails quietly (logged) and sign-up is unaffected.

## When a person taps a button
WhatsApp sends us a message with payload `welcome_connect`, `welcome_product` or `welcome_human`. That opens a 24h window so a team member can reply freely. Automatic replies to these payloads are not built yet.
