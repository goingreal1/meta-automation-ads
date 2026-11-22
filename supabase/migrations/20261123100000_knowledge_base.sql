-- Knowledge base with retrieval (RAG): documents, chunks, hybrid search.
-- Writes happen only through the ads-manager actions kb_ingest (cron secret / service key); reads through kb_search.
create extension if not exists vector with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create table if not exists public.kb_documents (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('global','company')),
  company_id uuid references public.companies(id) on delete cascade,
  source text not null,                 -- stable key inside the scope, e.g. repo/FUNCTIONS.md, mcp/tool/plan_campaign, learn/video/123
  kind text not null,                   -- doc | help | blog | mcp_tool | playbook | lesson | video | page | insight | ad_copy | ...
  title text not null,
  url text,
  hash text not null,
  shareable boolean not null default false,  -- company documents: true = media buyers may read them too (owner decides)
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check ((scope = 'global' and company_id is null) or (scope = 'company' and company_id is not null))
);
create unique index if not exists kb_documents_key on public.kb_documents (scope, coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid), source);
create index if not exists kb_documents_company on public.kb_documents (company_id) where company_id is not null;
create index if not exists kb_documents_kind on public.kb_documents (kind);

create table if not exists public.kb_chunks (
  id bigint generated always as identity primary key,
  document_id uuid not null references public.kb_documents(id) on delete cascade,
  chunk_index int not null,
  content text not null,
  embedding extensions.vector(1536),
  meta jsonb not null default '{}'::jsonb,
  fts tsvector generated always as (to_tsvector('english', content)) stored,
  unique (document_id, chunk_index)
);
create index if not exists kb_chunks_embedding on public.kb_chunks using hnsw (embedding extensions.vector_cosine_ops);
create index if not exists kb_chunks_fts on public.kb_chunks using gin (fts);
create index if not exists kb_chunks_trgm on public.kb_chunks using gin (content extensions.gin_trgm_ops);

-- RLS: global documents for any signed-in user; company documents only for that company's owner/admin
-- (buyers: only the ones the owner marked shareable). Nobody writes through the API: the service role does.
alter table public.kb_documents enable row level security;
alter table public.kb_chunks enable row level security;
revoke all on public.kb_documents, public.kb_chunks from anon, authenticated;
grant select on public.kb_documents, public.kb_chunks to authenticated;

create or replace function public.kb_can_read(p_scope text, p_company uuid, p_shareable boolean)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    p_scope = 'global'
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.company_id = p_company
               and (p.role in ('owner','admin') or (p.role = 'buyer' and p_shareable)))
  );
$$;
revoke all on function public.kb_can_read(text, uuid, boolean) from public, anon;
grant execute on function public.kb_can_read(text, uuid, boolean) to authenticated;

drop policy if exists kb_documents_read on public.kb_documents;
create policy kb_documents_read on public.kb_documents for select to authenticated
  using (public.kb_can_read(scope, company_id, shareable));
drop policy if exists kb_chunks_read on public.kb_chunks;
create policy kb_chunks_read on public.kb_chunks for select to authenticated
  using (exists (select 1 from public.kb_documents d where d.id = document_id and public.kb_can_read(d.scope, d.company_id, d.shareable)));

-- Hybrid search: vector similarity + full text + trigram, merged with reciprocal rank fusion.
-- p_company is trusted (the edge function derives it from the caller, never from a request body).
-- p_private=false means "caller is a media buyer": only global + shareable company documents.
create or replace function public.kb_search(
  query_embedding extensions.vector(1536), query_text text, p_company uuid, k int default 6,
  p_kinds text[] default null, p_private boolean default true)
returns table (doc_id uuid, chunk_id bigint, doc_title text, url text, kind text, scope text, content text, score double precision, vec_sim double precision)
language plpgsql stable security definer set search_path = public, extensions as $$
declare q tsquery; qt text := left(coalesce(query_text, ''), 400);
begin
  begin q := websearch_to_tsquery('english', regexp_replace(qt, '[^[:alnum:][:space:]]+', ' ', 'g')); exception when others then q := null; end;
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
    select a.cid, row_number() over (order by ts_rank_cd(a.fts, q, 32) desc) rn
    from allowed a where q is not null and a.fts @@ q
    order by ts_rank_cd(a.fts, q, 32) desc limit 40
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

-- Full-text-only variant used when no embedding is available (embedding spend cap reached or OpenAI down).
-- (kb_search with query_embedding null already degrades to full text + trigram.)
