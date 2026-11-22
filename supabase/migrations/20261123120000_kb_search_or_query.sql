-- Full-text half of kb_search: OR semantics for natural questions (an AND query returned nothing for most real questions).
create or replace function public.kb_search(
  query_embedding extensions.vector(1536), query_text text, p_company uuid, k int default 6,
  p_kinds text[] default null, p_private boolean default true)
returns table (doc_id uuid, chunk_id bigint, doc_title text, url text, kind text, scope text, content text, score double precision, vec_sim double precision)
language plpgsql stable security definer set search_path = public, extensions as $$
declare q tsquery; qt text := left(coalesce(query_text, ''), 400);
begin
  begin
    -- natural questions: any meaningful word may match (OR), ranking prefers chunks that match more of them
    q := nullif(replace(plainto_tsquery('english', regexp_replace(qt, '[^[:alnum:][:space:]]+', ' ', 'g'))::text, ' & ', ' | '), '')::tsquery;
  exception when others then q := null; end;
  return query
  with allowed as (
    select c.id cid, c.document_id, c.content, c.embedding, c.fts, d.title, d.url, d.kind, d.scope
    from kb_chunks c join kb_documents d on d.id = c.document_id
    where (p_kinds is null or d.kind = any(p_kinds))
      and (d.scope = 'global' or (d.company_id is not null and d.company_id = p_company and (p_private or d.shareable)))
  ),
  v as (
    select a.cid, row_number() over (order by a.embedding <=> query_embedding) rn, 1 - (a.embedding <=> query_embedding) sim
    from allowed a where query_embedding is not null and a.embedding is not null
    order by a.embedding <=> query_embedding limit 40
  ),
  f as (
    select a.cid, row_number() over (order by ts_rank_cd(a.fts, q, 5) desc) rn
    from allowed a where q is not null and a.fts @@ q
    order by ts_rank_cd(a.fts, q, 5) desc limit 40
  ),
  t as (
    select a.cid, row_number() over (order by similarity(a.content, qt) desc) rn
    from allowed a where length(qt) > 2 and a.content % qt
    order by similarity(a.content, qt) desc limit 20
  ),
  m as (
    select cid, sum(w) s from (
      select cid, 1.0 / (60 + rn) w from v union all
      select cid, 1.0 / (60 + rn) w from f union all
      select cid, 0.5 / (60 + rn) w from t) u group by cid
  )
  select a.document_id, a.cid, a.title, a.url, a.kind, a.scope, a.content,
         (m.s * 61 / 2.5)::double precision, coalesce((select v.sim from v where v.cid = a.cid), 0)::double precision
  from m join allowed a on a.cid = m.cid
  order by m.s desc limit greatest(1, least(k, 20));
end $$;
revoke all on function public.kb_search(extensions.vector, text, uuid, int, text[], boolean) from public, anon, authenticated;
grant execute on function public.kb_search(extensions.vector, text, uuid, int, text[], boolean) to service_role;
