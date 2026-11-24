-- The ad text (primary text, headline, description, button) Revora already keeps for every ad, for the ad screen.
-- Same visibility as visits: owners and admins see their company's ads; a media buyer only ads on their own ad accounts.
create or replace function public.rv_ad_copy(p_ad text) returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object('primary_text', o.creative->>'primary_text', 'headline', o.creative->>'headline', 'description', o.creative->>'description', 'cta', o.creative->>'cta', 'kind', o.creative->>'kind')
  from learn_objects o
  join profiles me on me.id = auth.uid() and me.company_id = o.company_id
  left join ad_accounts ac on ac.id = o.ad_account_id
  where o.level = 'ad' and o.meta_id = p_ad and o.creative is not null
    and (me.role in ('owner', 'admin') or ac.media_buyer_id = me.media_buyer_id)
  limit 1
$$;
grant execute on function public.rv_ad_copy(text) to authenticated;
