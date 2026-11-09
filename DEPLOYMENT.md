# Deployment — Ubuntu VPS

The app runs as Docker containers (Next.js app + Postgres) behind nginx with TLS from Let's Encrypt.

Replace `example.com` with your actual domain everywhere below.

---

## Prerequisites

- Ubuntu VPS with Docker + Compose plugin installed.
- nginx installed and running (already serving another site is fine).
- certbot installed (`sudo apt install certbot python3-certbot-nginx`).
- DNS A record for `example.com` pointing at the VPS IP.
- Port 80 and 443 open in the VPS firewall.

---

## 1. Clone and configure

```bash
git clone <repo-url> /home/ubuntu/<project-name>
cd /home/ubuntu/<project-name>
cp .env.example .env
```

Edit `.env` — fill every value:

```bash
nano .env
```

Key values to set:
- `SESSION_SECRET` — run `openssl rand -hex 32` and paste the output.
- `CRON_SECRET` — run `openssl rand -hex 32` and paste the output.
- `POSTGRES_PASSWORD` — choose a strong password, then update `DATABASE_URL` to match.
- `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` — from TikTok Developer Portal.
- `GOOGLE_SERVICE_ACCOUNT_JSON` — paste the entire service-account JSON as a single line.

---

## 2. Start containers

```bash
docker compose up -d --build
```

Migrations run automatically on container start via `docker-entrypoint.sh` (`prisma migrate deploy`). No manual step needed.

Verify both containers are healthy:

```bash
docker compose ps
```

Quick smoke-test from the VPS:

```bash
curl -I http://127.0.0.1:3000
```

---

## 3. nginx

Copy and edit the nginx config template:

```bash
cd /home/ubuntu/<project-name>
# Replace example.com with your actual domain:
sed 's/example\.com/yourdomain.com/g' deploy/nginx/example.com.conf > /tmp/yourdomain.com.conf
sudo cp /tmp/yourdomain.com.conf /etc/nginx/sites-available/yourdomain.com
sudo ln -s /etc/nginx/sites-available/yourdomain.com /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## 4. TLS (Let's Encrypt)

```bash
sudo certbot --nginx -d example.com -d www.example.com
```

certbot rewrites the nginx config to add the certificate paths and reload nginx automatically.

Auto-renewal is set up by certbot during install (`/etc/cron.d/certbot`). Verify with:

```bash
sudo certbot renew --dry-run
```

---

## 5. Cron jobs

Create the log file once:

```bash
sudo touch /var/log/sleeckos-cron.log
sudo chmod 666 /var/log/sleeckos-cron.log
```

Open the crontab:

```bash
crontab -e
```

Paste the contents of `deploy/crontab.example`, replacing `CRON_SECRET` with the same value from `.env`. Save and exit.

Verify the crontab is active:

```bash
crontab -l
```

After the first tick, check the log:

```bash
tail -f /var/log/sleeckos-cron.log
```

Each cron endpoint also accepts a manual test:

```bash
CRON_SECRET=your-secret
curl -fsS -H "x-cron-secret: $CRON_SECRET" http://127.0.0.1:3000/api/cron/poll-status
```

---

## 6. TikTok Developer Portal

Update the **Redirect URI** in the TikTok app settings to:

```
https://example.com/api/auth/callback
```

Verify the TikTok domain verification file is reachable:

```bash
curl https://example.com/tiktokiMpmDesGbaBtUe2sHO7yWqchZbpRo9HC.txt
```

---

## KVM8 runtime tuning

The Compose defaults target KVM8 with one app/worker container and no replicas. The KVM8-tuned Multiplier/Smart Export knobs and their KVM4 rollback values are listed in `.env.example`. Changing Docker resources or secondary FFmpeg/Remotion/transcription settings requires recreating the containers; `docker compose restart` does not apply them.

The primary render and Smart Export worker limits are different: **Multiplier → Queue Dashboard → Performance mode** persists a Balanced, Render boost, or Export boost selection and changes admission live without recreation. Current renders/uploads always finish normally. The environment values remain the fallback/boot defaults until a mode is saved. Keep one app/worker container; the in-process admission and Drive pacing controls do not coordinate replicas.

GitHub Actions auto-deploys only pushes to `main`; other branches are not deployed automatically.

### Apply

Review or override the defaults in `.env`, then recreate both services so the new limits and environment take effect:

```bash
cd /home/ubuntu/<project-name>
docker compose up -d --build --force-recreate app db
```

### Verify

Inspect the limits Docker actually applied to each container, rather than only reading `.env`:

```bash
docker inspect --format '{{.Name}} NanoCPUs={{.HostConfig.NanoCpus}} MemoryBytes={{.HostConfig.Memory}}' $(docker compose ps -q app db)
docker stats $(docker compose ps -q app db)
```

With the KVM8 defaults, app should report `NanoCPUs=7000000000` and `MemoryBytes=12884901888`; db should report `NanoCPUs=1000000000` and `MemoryBytes=1073741824`.

Check host capacity and, during an active render/export, confirm that FFmpeg or Chromium child processes are present:

```bash
df -h /
free -h
ps -eo pid,comm,args | grep -E '[f]fmpeg|[c]hromium'
```

The process check can be empty when no render/export work is active.

### Roll back to KVM4

Replace the runtime settings in `.env` with the KVM4 rollback values from `.env.example`. Also clear the saved UI performance mode (`DELETE FROM "AppSetting" WHERE key = 'multiplier.performanceMode';`) so the KVM4 environment fallback is used instead of persisted KVM8 boost limits. Then recreate both containers and repeat the inspection and stats checks:

```bash
cd /home/ubuntu/<project-name>
docker compose up -d --build --force-recreate app db
```

---

## Updating the app

```bash
cd /home/ubuntu/<project-name>
git pull
docker compose up -d --build
```

Migrations apply automatically on restart. If you added new migrations locally (`prisma migrate dev`), they are picked up here automatically.

---

## Logs

```bash
# App logs
docker compose logs -f app

# DB logs
docker compose logs -f db

# Cron output
tail -f /var/log/sleeckos-cron.log
```

---

## Notes

- `vercel.json` is kept in the repo for reference/rollback but is **not used** on the VPS. Cron schedules are defined in `deploy/crontab.example` instead.
- The app port (3000) is bound to `127.0.0.1` only — it is not reachable from the internet directly; all traffic goes through nginx.
- `DATABASE_URL` uses `db` as the hostname, which resolves to the postgres container inside docker-compose. Do not change this to `localhost`.

## State Accounts and team KPIs

The State Accounts section is `/admin/state-accounts`. Admins manage teams,
people, account assignments and targets. Membership in any state team grants
read access to every team's stats without granting general analytics or Guardian
control permissions.

Deploy the included Prisma migration before starting the updated app (the Docker
entrypoint already runs `prisma migrate deploy`). This feature builds on Phone
Guardian and must be deployed from a branch containing that integration.

Add the new hourly `/api/cron/state-accounts` line from `deploy/crontab.example`
to the **host crontab**. Updating that example file does not install a host cron.
Use the actual localhost port for this installation (the example uses 3000;
Guardian's existing installation may use 3001). The endpoint requires the
`x-cron-secret` header and fails closed when `CRON_SECRET` is missing. It awaits
completion and reports failed account syncs as HTTP 503. A database lease prevents
overlapping runs; an abandoned lease expires after two hours. An account failure
keeps its last successful stats and is retried on the next run.

The hourly job uses the existing `APIFY_TOKEN` and Apify actor configuration.
Only non-revoked managed accounts with the case-insensitive `state` label, or in
sections named `state` / `state accounts`, are queried. Ordinary accounts are
excluded. Discovery starts with the latest 100 public videos per account; optional
`STATE_SYNC_MAX_VIDEOS` changes this depth (20–1000). Every already-discovered
public video is refreshed too, including videos outside that newest window.
This is a paid provider call schedule; its calls appear under `state_accounts`
in the existing Apify ledger. Historical videos outside the discovery window
are not included in the charts until discovered by increasing the depth.

Guardian integration:

- State phones must have the `state` tag and report through the existing Guardian
  integration. No new phone credentials or changes to stopping rules are needed.
- A unique exact match between the phone name and an account's display name,
  username or Drive folder name links it on first discovery. Otherwise use the
  account's **Manage → Guardian phone** selector. Each phone links to one account.
- New incoming cycles retain state-phone runtime observations independently of
  Guardian's 30-day cycle pruning. Daily minutes are the union of observed runtime
  intervals, clipped to the reporting day's boundaries. Repeated polls, retried
  cycles and stop events do not multiply minutes. Existing stop events contribute
  where available; earlier manually stopped sessions cannot be reconstructed.
- Minutes measure observed phone runtime, not proof of activity inside TikTok.
  Stale Guardian heartbeats are shown separately from TikTok sync freshness.

Reporting uses a single timezone for this section, initially `Asia/Kolkata`.
Admins can select India, Qatar or London in the UI; the API accepts validated IANA
zones. Target, team and phone changes are effective on the next reporting day,
except a first team assignment can start today. Daily rows freeze targets,
ownership, phone IDs and timezone boundaries. A timezone transition starts at the
old day's end and ends at the next midnight in the new zone, so the transition day
can be short. DST is handled by timezone-aware boundaries. The existing global
app timezone and other sections' reports are not rewritten.

Views/likes show observed increases, not lifetime totals. An old video's first
observation establishes a baseline; a newly published video's initial counts
contribute on its posting day. Follower changes are signed, so losses are shown.
The first follower observation is a baseline, not growth. No metrics are invented
for dates before tracking starts. Late-discovered posts are credited to their
publication day (the hourly rollup revisits the last 35 reporting days). Team
consistency counts completed account-days meeting both configured targets;
overposting never compensates for another missed account-day. Days lacking a
post sync or required phone link are shown as awaiting data.

Verification: `scripts/test_state_accounts.ts` exercises the feature against a
separate migrated database whose name ends in `state_accounts_verify`. Never run
it against the application database: it resets fixtures in the verification DB.
