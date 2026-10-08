-- Every tool call made through the MCP server (Claude / ChatGPT connectors). Written by the mcp edge function only.
create table if not exists public.mcp_audit (
  id bigint generated always as identity primary key,
  company_id uuid,
  user_id uuid,
  tool text not null,
  args jsonb,
  ok boolean,
  client text,
  created_at timestamptz not null default now()
);
create index if not exists mcp_audit_company_day on public.mcp_audit (company_id, created_at desc);
alter table public.mcp_audit enable row level security;
