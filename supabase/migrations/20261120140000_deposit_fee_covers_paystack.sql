-- One fee for the person: Revora pays Paystack out of its own deposit fee. 5% (min ₦10, cap ₦2,500) covers Paystack's card cost (1.5% + ₦100, max ₦2,000) at every size.
update public.platform_fees set pct = 5, flat_naira = 0, min_naira = 10, cap_naira = 2500, updated_at = now() where kind = 'deposit';
