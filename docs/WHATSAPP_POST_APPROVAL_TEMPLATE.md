# Post approval WhatsApp (revora_post_approval_v1)

Sent by `social-admin` to every Revora HQ admin (platform_admins) who has a WhatsApp number on their profile, whenever a social post is saved as a draft (from HQ -> Social or from ChatGPT/Claude). If the template is not approved yet it falls back to a plain text, which only reaches someone who messaged the number in the last 24 hours.

| Field | Value |
|---|---|
| Category | Utility |
| Name | `revora_post_approval_v1` (override with the secret `WHATSAPP_TPL_POST_APPROVAL`) |
| Language | English |
| Body | `A post is waiting for your approval. When: {{1}}. "{{2}}" Open Revora HQ, then Social, to approve or skip it.` |
| Samples | {{1}} `2026-10-15 18:10 (Lagos)`, {{2}} `Most sellers don't lose money because ads don't work.` |

Replying "YES" to approve from WhatsApp is not built yet: approval is in HQ -> Social, or by asking ChatGPT/Claude.
