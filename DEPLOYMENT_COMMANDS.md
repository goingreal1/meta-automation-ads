# 🚀 Deployment Commands

## 1️⃣ Deploy All Functions to Supabase

Run in terminal from project root:

```bash
# Deploy each function
supabase functions deploy upload-creative
supabase functions deploy auto-duplicate-adsets
supabase functions deploy auto-launch-tests
supabase functions deploy ai-auto-launch-tests
supabase functions deploy pull-meta-metrics
supabase functions deploy sync-meta-audiences
```

## 2️⃣ Setup Cron Jobs in Supabase

1. Go to Supabase Dashboard
2. Click **SQL Editor** → **New Query**
3. Run this:

```sql
-- Enable pg_cron
CREATE EXTENSION IF NOT EXISTS pg_cron;
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;

-- Daily auto-launch (12 AM Lagos time = 11 PM UTC)
SELECT cron.schedule('auto-launch-tests-daily', '0 23 * * *', $$
  SELECT net.http_post(
    url:='https://YOUR_PROJECT.supabase.co/functions/v1/ai-auto-launch-tests',
    headers:='{"Authorization": "Bearer eyJhbGc..."}'::jsonb
  );
$$);

-- Hourly metrics pull
SELECT cron.schedule('pull-meta-metrics-hourly', '0 * * * *', $$
  SELECT net.http_post(
    url:='https://YOUR_PROJECT.supabase.co/functions/v1/pull-meta-metrics',
    headers:='{"Authorization": "Bearer eyJhbGc..."}'::jsonb
  );
$$);

-- 6-hourly audience sync
SELECT cron.schedule('sync-audiences-6h', '0 */6 * * *', $$
  SELECT net.http_post(
    url:='https://YOUR_PROJECT.supabase.co/functions/v1/sync-meta-audiences',
    headers:='{"Authorization": "Bearer eyJhbGc..."}'::jsonb
  );
$$);
```

**Replace:**
- `YOUR_PROJECT` = Your Supabase URL (e.g., `rrkhkhgdxhmogxxtbvyt.supabase.co`)
- `Bearer eyJhbGc...` = Your Service Role Key (from Settings → API)

## 3️⃣ Add Supabase Credentials to Dashboard

In `dashboard.html`, find the line with:
```javascript
const SUPABASE_URL = '...';
const SUPABASE_ANON_KEY = '...';
```

Update with YOUR credentials:
```javascript
const SUPABASE_URL = 'https://rrkhkhgdxhmogxxtbvyt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIs...';
```

Get from: Supabase Dashboard → Settings → API

## 4️⃣ Create Targeting Rules (SQL)

```sql
INSERT INTO targeting_rules (rule_name, targeting_type, states, genders, age_min, age_max, optimization_goal, budget_naira, is_active) VALUES
('Young Lagos Males', 'narrow_v1', '["Lagos"]', '[1]', 18, 30, 'LINK_CLICKS', 2500, TRUE),
('Mid-age Males Nationwide', 'narrow_v2', '["Lagos", "Ogun", "Abuja", "Rivers"]', '[1]', 30, 45, 'LINK_CLICKS', 3000, TRUE),
('Young Females All Cities', 'narrow_v1', '["Lagos", "Ogun", "Enugu"]', '[2]', 18, 30, 'LINK_CLICKS', 2500, TRUE),
('Premium Female Audience', 'narrow_v2', '["Lagos", "Abuja", "Port Harcourt"]', '[2]', 30, 50, 'LINK_CLICKS', 3000, TRUE);
```

## 5️⃣ Setup Storage Bucket

```sql
-- Create creative-vault bucket in Supabase Storage
-- Dashboard → Storage → New Bucket
-- Name: creative-vault
-- Public: NO
-- File size limit: 100MB
```

## 6️⃣ Verify Setup

```bash
# Check function status
supabase functions list

# View real-time logs
supabase functions --help
supabase functions download ai-auto-launch-tests

# Test a function manually
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/ai-auto-launch-tests \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

## 7️⃣ Dashboard - Open & Test

1. Open `dashboard.html` in browser
2. Go to **Creative Vault** tab
3. Upload a test video
4. Wait for status to show "pending_test"
5. Next day at 12 AM, AI auto-launches

## ✅ Verification Checklist

- [ ] All 6 functions deployed (`supabase functions list`)
- [ ] Cron jobs created (`SELECT * FROM cron.job;`)
- [ ] Targeting rules in DB (5+ rules)
- [ ] Storage bucket "creative-vault" exists
- [ ] Dashboard loads with Supabase connected
- [ ] Upload test creative successfully
- [ ] Meta API token valid (test with curl to Meta API)
- [ ] Service Role key saved securely

## 🚨 Common Errors

### "Function not found" 
→ Run `supabase functions deploy [function-name]`

### "Unauthorized" on cron job
→ Use Service Role Key (not anon key) in Authorization header

### CTA not showing in Meta Ads
→ Check Meta API permissions, refresh access token

### Dashboard shows no data
→ Check Supabase credentials are correct
→ Verify `SUPABASE_URL` and `SUPABASE_ANON_KEY` match your project

---

**Done? Run these commands, then visit dashboard. System is live! 🚀**
