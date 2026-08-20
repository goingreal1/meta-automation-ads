# 🔄 Cron Job Setup Guide

## About Cron Jobs

Your system needs automated triggers at specific times:
- **12:00 AM (Lagos)** → AI launches test with best creative
- **Every hour** → Pull Meta metrics, scale/pause ads
- **Every 6 hours** → Sync audiences to Meta

---

## ⚙️ Setup Option 1: Supabase pg_cron (Recommended)

### Step 1: Enable pg_cron Extension

Go to **Supabase Dashboard** → **SQL Editor** → New Query

Paste this:

```sql
-- Enable pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron;
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;

-- Verify it's enabled
SELECT * FROM pg_extension WHERE extname = 'pg_cron';
```

### Step 2: Create Cron Jobs

Run this SQL in Supabase:

```sql
-- JOB 1: Auto-launch tests nightly at 12 AM Lagos (23:00 UTC)
-- This calls your ai-auto-launch-tests function
SELECT cron.schedule(
  'auto-launch-daily',
  '0 23 * * *',
  $$
    SELECT
      net.http_post(
        url:='https://rrkhkhgdxhmogxxtbvyt.supabase.co/functions/v1/ai-auto-launch-tests',
        headers:='{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJya2hraGdkeGhtb2d4eHRidnl0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NjA1Nzc4OCwiZXhwIjoyMTAxNjMzNzg4fQ.KXT2jmMGoqGhvMJe2at6sLJaLcjhYk0mrpq760kChiU"}'::jsonb,
        body:='{"action": "launch_test"}'::jsonb
      ) as request_id;
  $$
);

-- JOB 2: Pull metrics every hour
SELECT cron.schedule(
  'pull-metrics-hourly',
  '0 * * * *',
  $$
    SELECT
      net.http_post(
        url:='https://rrkhkhgdxhmogxxtbvyt.supabase.co/functions/v1/pull-meta-metrics',
        headers:='{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJya2hraGdkeGhtb2d4eHRidnl0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NjA1Nzc4OCwiZXhwIjoyMTAxNjMzNzg4fQ.KXT2jmMGoqGhvMJe2at6sLJaLcjhYk0mrpq760kChiU"}'::jsonb
      ) as request_id;
  $$
);

-- JOB 3: Sync audiences every 6 hours
SELECT cron.schedule(
  'sync-audiences-6h',
  '0 */6 * * *',
  $$
    SELECT
      net.http_post(
        url:='https://rrkhkhgdxhmogxxtbvyt.supabase.co/functions/v1/sync-meta-audiences',
        headers:='{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJya2hraGdkeGhtb2d4eHRidnl0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NjA1Nzc4OCwiZXhwIjoyMTAxNjMzNzg4fQ.KXT2jmMGoqGhvMJe2at6sLJaLcjhYk0mrpq760kChiU"}'::jsonb
      ) as request_id;
  $$
);

-- Verify jobs created
SELECT * FROM cron.job;
```

**Replace these with YOUR actual Service Role Key:**
- `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJya2hraGdkeGhtb2d4eHRidnl0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NjA1Nzc4OCwiZXhwIjoyMTAxNjMzNzg4fQ.KXT2jmMGoqGhvMJe2at6sLJaLcjhYk0mrpq760kChiU` ← **YOUR Service Role Key here**

**Get your Service Role Key:**
1. Supabase Dashboard
2. **Settings** → **API**
3. Copy **Service Role** (not anon key)
4. Paste into both Bearer tokens above

### Step 3: Monitor Cron Jobs

```sql
-- See all scheduled jobs
SELECT * FROM cron.job;

-- View recent job runs and errors
SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;

-- Delete a job (if needed)
SELECT cron.unschedule('auto-launch-daily');
```

---

## ⚙️ Setup Option 2: Vercel Cron (If Deploying on Vercel)

If you're deploying the dashboard on **Vercel**, use Vercel's built-in cron:

### Step 1: Create Vercel Function

Create file: `api/cron/launch-tests.js`

```javascript
// api/cron/launch-tests.js
export default async function handler(req, res) {
  // Verify this is a valid Vercel cron request
  if (req.headers['x-vercel-cron'] !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const response = await fetch(
      'https://rrkhkhgdxhmogxxtbvyt.supabase.co/functions/v1/ai-auto-launch-tests',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ action: 'launch_test' })
      }
    );

    const data = await response.json();
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
```

### Step 2: Configure vercel.json

```json
{
  "crons": [{
    "path": "/api/cron/launch-tests",
    "schedule": "0 23 * * *"
  }, {
    "path": "/api/cron/pull-metrics",
    "schedule": "0 * * * *"
  }, {
    "path": "/api/cron/sync-audiences",
    "schedule": "0 */6 * * *"
  }]
}
```

### Step 3: Add to Environment Variables

In Vercel Dashboard:
- `SUPABASE_SERVICE_KEY` = Your Service Role Key
- `CRON_SECRET` = Random secret string

---

## ⚙️ Setup Option 3: GitHub Actions (Free)

Create file: `.github/workflows/cron-launch.yml`

```yaml
name: AI Auto-Launch Tests

on:
  schedule:
    # Every day at 11 PM UTC (12 AM Lagos)
    - cron: '0 23 * * *'

jobs:
  launch:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger AI Launch
        run: |
          curl -X POST \
            'https://rrkhkhgdxhmogxxtbvyt.supabase.co/functions/v1/ai-auto-launch-tests' \
            -H 'Authorization: Bearer ${{ secrets.SUPABASE_SERVICE_KEY }}' \
            -H 'Content-Type: application/json' \
            -d '{"action": "launch_test"}'
```

Then in GitHub:
1. Go to **Settings** → **Secrets and Variables** → **Actions**
2. Add `SUPABASE_SERVICE_KEY`

---

## 🕐 Cron Schedule Syntax

```
   ┌────────────────────── minute (0 - 59)
   │ ┌──────────────────── hour (0 - 23)
   │ │ ┌────────────────── day of month (1 - 31)
   │ │ │ ┌──────────────── month (1 - 12)
   │ │ │ │ ┌──────────────── day of week (0 - 6) (Sunday to Saturday)
   │ │ │ │ │
   │ │ │ │ │
   * * * * *
```

**Examples:**
- `0 23 * * *` → Every day at 11 PM UTC (12 AM Lagos)
- `0 * * * *` → Every hour, at minute 0
- `0 */6 * * *` → Every 6 hours (0, 6, 12, 18)
- `0 18 * * *` → Every day at 6 PM UTC (7 PM Lagos)

---

## ⚠️ Time Zone Note

**Supabase pg_cron runs in UTC**

Your launch time:
- **12:00 AM Lagos time** = **23:00 UTC** (previous day)
- So cron is: `0 23 * * *`

Check your timezone:
```sql
-- What time is it in Supabase?
SELECT now() AT TIME ZONE 'UTC' as utc_time,
       now() AT TIME ZONE 'Africa/Lagos' as lagos_time;
```

---

## ✅ Verification Checklist

- [ ] pg_cron extension enabled (`SELECT * FROM pg_extension WHERE extname = 'pg_cron';`)
- [ ] Cron jobs created (`SELECT * FROM cron.job;`)
- [ ] Service Role Key copied correctly
- [ ] No errors in job run details
- [ ] Test at least once manually

### Manual Test

```bash
# Test the ai-auto-launch-tests function directly
curl -X POST 'https://rrkhkhgdxhmogxxtbvyt.supabase.co/functions/v1/ai-auto-launch-tests' \
  -H 'Authorization: Bearer YOUR_ANON_KEY' \
  -H 'Content-Type: application/json'
```

---

## 🚨 Troubleshooting

### Cron job not running?

```sql
-- Check error logs
SELECT * FROM cron.job_run_details 
WHERE job_name = 'auto-launch-daily'
ORDER BY start_time DESC LIMIT 5;

-- If you see errors, usually it's:
-- 1. Service Role Key expired → Regenerate in Supabase Settings
-- 2. Function URL wrong → Check exact URL in Supabase Functions
-- 3. Network error → Restart Supabase or check status
```

### Job runs but function doesn't execute?

```sql
-- Make sure function is deployed
-- In terminal: supabase functions deploy ai-auto-launch-tests

-- Check function logs
SELECT * FROM edge_function_logs 
WHERE function_id = 'ai-auto-launch-tests'
ORDER BY created_at DESC LIMIT 10;
```

---

## 🎯 Your Setup

You mentioned:
- ✅ Page ID configured
- ✅ Meta Pixel ID configured
- ✅ CAPI connected
- ✅ Meta access token in Supabase secrets

So your **ai-auto-launch-tests function already has access** to:
- `META_ACCESS_TOKEN` (from Supabase secrets)
- `META_AD_ACCOUNT_ID` (from Supabase secrets)

**Just setup the cron job and you're done!**

---

## Summary

1. **Choose setup method:**
   - Supabase pg_cron ← **Recommended, easiest**
   - Vercel Cron ← If deploying on Vercel
   - GitHub Actions ← Free alternative

2. **Copy your Service Role Key from Supabase Settings**

3. **Paste into cron SQL (if using pg_cron)**

4. **Run SQL in Supabase SQL Editor**

5. **Verify with:** `SELECT * FROM cron.job;`

---

**Dashboard:** Open `dashboard_v2.html` in browser → See live data from Supabase
**Cron:** Runs automatically starting tomorrow at 12 AM Lagos time
**AI Launch:** First test campaign launches when you upload a creative 🚀
