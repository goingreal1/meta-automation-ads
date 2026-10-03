-- customer_care already sees every order company-wide (orders_company_scoped
-- includes it alongside owner/admin), but payments_buyer_read never did --
-- the role was simply missing from the OR chain. That meant customer care
-- had no way to answer "did my payment go through" without asking an admin,
-- and the dashboard's new per-order payment status column (bvPaymentCell)
-- would silently show nothing for them.

alter policy payments_buyer_read on payments
  using (
    company_id = current_company_id()
    and (
      current_user_role() in ('owner','admin','customer_care')
      or (current_user_role() = 'buyer' and media_buyer_id = (select p.media_buyer_id from profiles p where p.id = auth.uid()))
      or (current_user_role() = 'delivery_agent' and order_id in (
        select o.id from orders o
        join profiles p on p.delivery_agent_id = o.delivery_agent_id
        where p.id = auth.uid()
      ))
    )
  );
