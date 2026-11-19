-- Which countries a product is sold in, and which countries an AI Team launch targets (without this every launch went to Nigeria).
alter table public.products add column if not exists target_countries text[];
alter table public.ai_launches add column if not exists countries text[];
