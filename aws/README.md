# Heavy functions on AWS Lambda

`revora-screenshot` (Chromium) and `revora-transcode` (ffmpeg) used to live in `api/` on Vercel and made every deployment huge.
They now run on AWS Lambda behind Function URLs. Everything else stays on Vercel.

| | screenshot | transcode |
|---|---|---|
| Called by | Supabase `ads-manager` (`SCREENSHOT_URL` secret) | dashboard (`TRANSCODE_URL` const in `app/dashboard/js/14-delivery-care-desk.js`) and Supabase `mcp-social` (`TRANSCODE_URL` secret) |
| Auth | header `x-shot-secret` | Supabase login (`Authorization`) or server `ticket` |
| CORS | none (server to server) | dashboard origins only, set in `template.yaml` |
| Size | 2048 MB, 60 s | 1024 MB, 60 s, 2 GB /tmp |

## One-time setup (a person with AWS admin does this once)
1. AWS console -> top-right account menu -> **Account** -> **AWS Regions** -> enable **Africa (Cape Town) af-south-1**. Wait until "Enabled" (a few minutes).
2. Switch the console to af-south-1, open **CloudFormation -> Create stack -> With new resources**, upload `aws/bootstrap/github-oidc.yml`, stack name `revora-github-bootstrap`. If the account already has a `token.actions.githubusercontent.com` identity provider (IAM -> Identity providers), set `CreateOidcProvider` to `false`. Tick "I acknowledge IAM resources" and create.
3. When it finishes, open the stack's **Outputs** tab: copy `RoleArn` and `BucketName`.
4. GitHub repo -> Settings -> Secrets and variables -> Actions:
   - **Secrets** -> New: `AWS_ROLE_ARN` = the RoleArn; `SHOT_SECRET` = the same value as the Supabase `app_secrets` row `shot_secret` (read it in the Supabase SQL editor: `select value from app_secrets where key='shot_secret'`; type it into GitHub yourself, do not paste it anywhere else).
   - **Variables** -> New: `AWS_DEPLOY_BUCKET` = the BucketName; `AWS_REGION` = `af-south-1`.
5. GitHub -> Actions -> "Deploy AWS Lambdas" -> Run workflow. The last step prints both Function URLs.
6. Supabase dashboard (project `oicqtpjjwmgsiluvkmpu`) -> Edge Functions -> Secrets: add `SCREENSHOT_URL` (screenshot URL) and `TRANSCODE_URL` (transcode URL). Then deploy the two edge functions:
   `python3 scripts/migrate/deploy_functions.py oicqtpjjwmgsiluvkmpu <flags.json> ads-manager mcp-social`
7. Put the transcode URL into `TRANSCODE_URL` in `app/dashboard/js/14-delivery-care-desk.js`, merge, let Vercel deploy.
8. Watch one real screenshot and one real video upload work. Then merge the follow-up PR that deletes the Vercel functions.
9. Vercel -> Settings -> General -> **Deployment Retention**: shorten it (this is what actually frees the old storage).
10. Recommended: the AWS keys currently on the dev PC belong to the root user. Create a normal IAM user for CLI work and delete the root access keys (IAM -> Security credentials).

## Cost cap
The account's Lambda quota is 10 concurrent executions, which AWS will not let us reserve from. Until you request a higher quota
(Service Quotas -> Lambda -> Concurrent executions), the cap is the account quota itself. After it is raised, set the GitHub variables
`SCREENSHOT_RESERVED_CONCURRENCY` (e.g. 3) and `TRANSCODE_RESERVED_CONCURRENCY` (e.g. 5) and re-run the workflow.

## Rollback
Until the follow-up PR removing `api/screenshot.js` / `api/transcode.js` is merged, Vercel still serves both:
- Screenshot: delete the `SCREENSHOT_URL` secret in Supabase (the code falls back to the Vercel URL).
- Transcode, server side: delete the `TRANSCODE_URL` secret. Dashboard: set the constant back to `""` and deploy.
After the follow-up PR is merged, roll back by reverting it (Vercel functions return) and doing the same.
