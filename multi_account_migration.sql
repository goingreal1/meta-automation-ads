-- ==============================================================================
-- MULTI-ACCOUNT MIGRATION SCRIPT (FIXED)
-- Run this in your Supabase SQL Editor.
-- This version ensures all columns are added even if the table already existed.
-- ==============================================================================

-- 1. Create Ad Accounts Table (if it completely doesn't exist)
CREATE TABLE IF NOT EXISTS public.ad_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4()
);

-- 2. Explicitly add columns (in case the table already existed but was missing them)
ALTER TABLE public.ad_accounts ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.ad_accounts ADD COLUMN IF NOT EXISTS meta_ad_account_id TEXT;
ALTER TABLE public.ad_accounts ADD COLUMN IF NOT EXISTS fb_page_id TEXT;
ALTER TABLE public.ad_accounts ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE public.ad_accounts ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'ACTIVE';
ALTER TABLE public.ad_accounts ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL;

-- Turn on RLS for ad_accounts
ALTER TABLE public.ad_accounts ENABLE ROW LEVEL SECURITY;

-- Drop old policies if they exist so we can recreate them cleanly
DROP POLICY IF EXISTS "Users can view their own ad accounts" ON public.ad_accounts;
DROP POLICY IF EXISTS "Users can insert their own ad accounts" ON public.ad_accounts;
DROP POLICY IF EXISTS "Users can update their own ad accounts" ON public.ad_accounts;
DROP POLICY IF EXISTS "Users can delete their own ad accounts" ON public.ad_accounts;

-- Policy: Users can only see and manage their own ad accounts
CREATE POLICY "Users can view their own ad accounts"
    ON public.ad_accounts FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own ad accounts"
    ON public.ad_accounts FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own ad accounts"
    ON public.ad_accounts FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own ad accounts"
    ON public.ad_accounts FOR DELETE
    USING (auth.uid() = user_id);


-- 3. Update existing tables to support ad_account_id filtering
ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS ad_account_id UUID REFERENCES public.ad_accounts(id) ON DELETE CASCADE;

ALTER TABLE public.ad_sets 
ADD COLUMN IF NOT EXISTS ad_account_id UUID REFERENCES public.ad_accounts(id) ON DELETE CASCADE;

ALTER TABLE public.creative_assets 
ADD COLUMN IF NOT EXISTS ad_account_id UUID REFERENCES public.ad_accounts(id) ON DELETE CASCADE;

ALTER TABLE public.daily_metrics 
ADD COLUMN IF NOT EXISTS ad_account_id UUID REFERENCES public.ad_accounts(id) ON DELETE CASCADE;


-- 4. RLS Policies for existing tables
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creative_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_metrics ENABLE ROW LEVEL SECURITY;

-- Helper function to check if the user owns the ad_account
CREATE OR REPLACE FUNCTION user_owns_ad_account(account_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.ad_accounts 
    WHERE id = account_id AND user_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop old policies to replace them
DROP POLICY IF EXISTS "View own account orders" ON public.orders;
DROP POLICY IF EXISTS "Manage own account orders" ON public.orders;
DROP POLICY IF EXISTS "View own account ad_sets" ON public.ad_sets;
DROP POLICY IF EXISTS "Manage own account ad_sets" ON public.ad_sets;
DROP POLICY IF EXISTS "View own account creative_assets" ON public.creative_assets;
DROP POLICY IF EXISTS "Manage own account creative_assets" ON public.creative_assets;
DROP POLICY IF EXISTS "View own account daily_metrics" ON public.daily_metrics;
DROP POLICY IF EXISTS "Manage own account daily_metrics" ON public.daily_metrics;

-- Add basic policies
CREATE POLICY "View own account orders" ON public.orders FOR SELECT 
USING (ad_account_id IS NULL OR user_owns_ad_account(ad_account_id));

CREATE POLICY "Manage own account orders" ON public.orders FOR ALL 
USING (ad_account_id IS NULL OR user_owns_ad_account(ad_account_id));

CREATE POLICY "View own account ad_sets" ON public.ad_sets FOR SELECT 
USING (ad_account_id IS NULL OR user_owns_ad_account(ad_account_id));

CREATE POLICY "Manage own account ad_sets" ON public.ad_sets FOR ALL 
USING (ad_account_id IS NULL OR user_owns_ad_account(ad_account_id));

CREATE POLICY "View own account creative_assets" ON public.creative_assets FOR SELECT 
USING (ad_account_id IS NULL OR user_owns_ad_account(ad_account_id));

CREATE POLICY "Manage own account creative_assets" ON public.creative_assets FOR ALL 
USING (ad_account_id IS NULL OR user_owns_ad_account(ad_account_id));

CREATE POLICY "View own account daily_metrics" ON public.daily_metrics FOR SELECT 
USING (ad_account_id IS NULL OR user_owns_ad_account(ad_account_id));

CREATE POLICY "Manage own account daily_metrics" ON public.daily_metrics FOR ALL 
USING (ad_account_id IS NULL OR user_owns_ad_account(ad_account_id));
