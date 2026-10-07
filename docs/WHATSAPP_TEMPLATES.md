# WhatsApp templates for customer order notifications

Submit each in Meta's WhatsApp Manager (Message templates → Create). Category **Utility**, language **English**.
Names must match exactly (or set the `WHATSAPP_TPL_*` secret). `{{n}}` are variables.

| Name | Sent when | Body |
|---|---|---|
| `order_received_v1` | the order is placed | Hi {{1}}, we've received your order for {{2}} from {{3}}. Our customer care will call you shortly to confirm the details. |
| `order_preparing_v1` | order confirmed after the call | Hi {{1}}, your order for {{2}} is confirmed and we are preparing it now. |
| `agent_accepted_v1` | a delivery agent accepts | Hi {{1}}, {{2}} will deliver your order. You can reach them on {{3}}. |
| `out_for_delivery_v1` | the agent taps "On the way" | Hi {{1}}, your order is on the way with {{2}} ({{3}}). Please keep your phone close. |
| `order_delivered_v1` | delivered | Hi {{1}}, your {{2}} has been delivered. Thank you for shopping with us! |
| `payment_request_customer_v2` | straight after delivered | Hi {{1}}, please pay NGN {{2}} to {{3}} account {{4}}. Put the code {{5}} in your transfer note if your bank app allows it. Tap the button once you have paid. **Button: Quick reply "I've paid"** |
| `payment_confirmed_customer_v1` | payment matched | Hi {{1}}, we've received your payment of NGN {{2}}. Thank you! |

`payment_request_customer_v2` replaces `_v1` (same text plus the quick-reply button); set the secret
`WHATSAPP_TPL_CUSTOMER_REQUEST=payment_request_customer_v2` once it is approved.
