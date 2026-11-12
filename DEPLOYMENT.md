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
sections named `state` / `state accounts`, or linked to a verified Guardian state
phone, are queried. Guardian phones tagged `State` are matched uniquely against
account names or Drive folders such as `POL ACC Arizona`. Ordinary accounts are
excluded; a username merely containing “state” is not sufficient. Discovery starts with the latest 100 public videos per account; optional
`STATE_SYNC_MAX_VIDEOS` changes this depth (20–1000). Every already-discovered
public video is refreshed too, including videos outside that newest window.
This is a paid provider call schedule; its calls appear under `state_accounts`
in the existing Apify ledger. Historical videos outside the discovery window
are not included in the charts until discovered by increasing the depth.

Guardian integration:

- State phones must have the `state` tag and report through the existing Guardian
  integration. No new phone credentials or changes to stopping rules are needed.
- A unique exact match between the phone name and an account's display name,
  username or Drive folder name (ignoring the existing `POL ACC ` prefix) links it on first discovery. Otherwise use the
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

## State Content Desk

`/admin/content-desk` is available to admins and state-team members. Members can
browse every state, add links and sources, select stories for their own teams,
approve briefs, add production notes, and record manually published URLs. Only
admins control state preferences and usage limits. Source creators and admins
can edit, pause, resume, and retry sources. Concurrent editorial edits use a
version check; another team's selections cannot be overwritten by a member.

The migration `20261109063245_state_content_desk` adds the research tables. The
first dashboard request or worker cycle idempotently seeds the ten states and
40 starter sources: local RSS, broader news discovery, culture discovery, and a
local YouTube channel for each state. Feed endpoints were smoke-tested during
implementation; publisher availability can change. Google News RSS discovery
is a public-feed dependency without an availability guarantee. Sources expose
last success, next attempt, provider errors, and retry controls.

Install and schedule the worker on the **host**, after deploying the app:

```sh
install -m 700 deploy/content-desk-sync.py /usr/local/sbin/sleeckos-content-desk-sync
# Add to the root crontab, preserving all existing entries:
# */5 * * * * /usr/local/sbin/sleeckos-content-desk-sync >> /var/log/sleeckos-content-desk.log 2>&1
/usr/local/sbin/sleeckos-content-desk-sync
```

The helper reads `PORT` and `CRON_SECRET` from the app container in memory and
passes the secret to curl through stdin. The deployed app uses port 3001; the
helper follows the container configuration. Set `SLEECKOS_CONTAINER` if the
Compose container name differs. Never use a secret in the URL or shell args.

Provider settings (existing app integrations):

- `YOUTUBE_API_KEY`: read channel uploads and video metadata/statistics.
- `APIFY_TOKEN`: track public TikTok and Instagram profiles. Runs are persisted
  and polled in later cycles; profile content is limited to 20 requested items.
  Each run requests `maxTotalChargeUsd=0.50`; provider pricing/minimums may cause
  a run to fail. Content Desk caps are separate from other app Apify usage.
- `GEMINI_API_KEY`: evidence-linked brief drafts. Without it, collected source
  material remains usable and missing-key feedback is displayed.
- `CONTENT_DESK_AI_MODEL`: optional, defaults to `gemini-2.5-flash`.

Admin Settings default to 30 social run starts and 100 AI brief attempts per
business day, and a shortlist beginning at 09:00 in the State Accounts business
timezone. A zero provider limit stops new work of that type. Limits count failed
attempts too. Social run reservations are transactional. Source polling normally
runs hourly, social tracking at least four-hourly, with exponential retry backoff.
The worker processes at most 12 due sources (concurrency two) and four briefs per
cycle, with a database lease to avoid overlapping cycles. Daily shortlist targets
are separately adjustable per state. Activity retains 30 days of completed jobs.

The system stores publisher excerpts, descriptions, captions, and team notes;
it does not claim to have read paywalled articles or watched videos. It groups
similar recent headlines conservatively and looks for related reporting when
drafting. Users can open YouTube/TikTok searches for additional video references.
Multiple references are not automatically labeled independently verified. AI
briefs cite stored source IDs and require human review. Rights to reuse source
media are not inferred. No automatic video generation or publishing is enabled.

RSS and web-page fetching pins public IPv4 DNS results, revalidates redirects,
limits response sizes, and times out slow requests. A web-page source watches
that page's title/description; use RSS to discover new articles from a website.
Existing data and briefs are retained on collection/generation failures.

Validation on the isolated migration database:

```sh
DATABASE_URL=postgresql://hishamshafi@localhost:5432/sleeckos_state_accounts_verify npx tsx scripts/test_content_desk.ts --live-feed
```

This suite uses mocked paid providers. It checks deduplication, source access,
team ownership, conflicting edits, spend reservations, asynchronous social
polling, failure retention, grounded brief structure, SSRF restrictions, and cron
authorization. `--live-feed` additionally reads a public RSS endpoint.

### AI viral potential ranking

The Content Desk time filter supports 1–168 hours (plus all-time browsing).
“Rank by viral potential” creates a shared snapshot for the current state,
category, team, search and status filters, across every matching page. Up to 300
stories are allowed; larger sets require narrower filters, never silent sampling.
Publication time is used when known; otherwise discovery time is used. A recent
reference can make an older developing story eligible. Future dates are excluded.

`ContentRanking` stores immutable input snapshots and incremental results. The
POST response starts work with Next.js `after`; host cron resumes queued work or
jobs interrupted for more than five minutes. Atomic claims prevent duplicate
workers. Each invocation scores up to 50 stories in batches of ten, preserving
completed batches. Errors appear in the ranking panel and Activity; retry creates
a fresh snapshot. A run uses up to six recent source excerpts per story. Rankings
never change approvals, assignments, notes, or editorial versions. AI sort shows
scored stories from the selected snapshot; default relevance shows live results.

Scores are heuristic estimates, not calibrated probabilities. The prompt uses a
fixed rubric (timeliness 25, novelty 20, human interest 20, explanatory/visual
potential 15, measured momentum 20); it forbids invented metrics and sensational
or partisan persuasion. No measured momentum means no momentum points and caps
confidence at medium. The UI shows reasons, a factual opening, caveats, and the
actual metric observations supplied to AI. Source data remains untrusted input.

Admin settings allow 0–100 ranking runs per business day (default 20); failures
count toward the limit. At most three jobs may be active globally. API key/model
use the same Gemini configuration as briefs. No additional cron entry is needed.

```sh
DATABASE_URL=postgresql://hishamshafi@localhost:5432/sleeckos_state_accounts_verify npx tsx scripts/test_content_rankings.ts
```

### State Accounts combined views and growth

State Accounts defaults to Combined views, including unassigned accounts when
All teams is selected. Compare teams retains separate series. Daily/weekly
aggregation and the team filter apply to the chart; hover/focus reveals exact
observed gains. The growth panel uses the same team scope and shows today's
partial total, last/prior seven-day averages and week-over-week change.

Forecasts estimate additional views over 7 and 30 days from the recent usable
daily average; lower/upper scenarios are fixed 0.7x/1.3x, not confidence limits.
At least three usable completed days in the last week are required. Onboarding
days, differing timezones, short/long transition days, missing account metrics,
and days without a sync in their final two hours are excluded. Account mixes
must match today's scope; percentage growth additionally requires three usable
prior-week days and a nonzero prior average. Missing days are never zero-filled.
These are observed sync-day gains, not reconstructed historical platform views.
No schema change or new cron is needed. Test with:

```sh
npx tsx scripts/test_state_trajectory.ts
```

### State posting history and daily accuracy

State Accounts → Posting history lists recorded posts by reporting day and
account, with publication time (seconds and UTC offset), post link, team on that
reporting day, and last successful observation. The main team filter applies;
results paginate at 50 posts. History uses the same frozen reporting-day
[start, end) boundaries as KPIs, including India/Qatar/London transitions and
London DST. Deleted/private videos retain historical posting credit.

The hourly state sync updates verified publication timestamps on existing
videos, including old videos refreshed by URL. State-scoped provider timestamps
accept explicit-offset ISO or Unix seconds/milliseconds; missing, invalid, or
future publication times never become discovery times. Invalid state snapshots
retain existing data and show a sync error. Missing dates in stats-only refresh
retain the previously recorded publication time.

Daily post counts are recomputed exactly from unique stored videos for every
persisted reporting day, including older days outside the warm-up refresh
window. Corrections may decrease the old day's count and increase the new day's
count. A shared transaction advisory lock serializes timestamp writes and
recounts. Pre-tracking posts are stored but never reassigned to today's KPI.
The initial discovery limit and public-provider availability still apply;
collection errors and Last sync must be checked before interpreting zero posts.

No schema change is required: StateVideo already stores publication timestamps.
Run `scripts/test_state_accounts.ts` against the isolated verification database
for late discovery, corrections, daily history/KPI agreement, invalid timestamps,
midnight, India/Qatar and both London DST boundaries.

## Content Desk Clip Studio

Open a story and choose **Open Clip Studio**. Import a public YouTube/TikTok/
Instagram video or direct MP4/MOV/WebM URL, or upload a file. Sources are limited
to 20 minutes / 500 MB; each export is one continuous 1–180 second clip, with an
optional 3-second outro. Source-platform restrictions can require manual upload.
Transcription uses the existing Python environment (`faster-whisper`, default
`base`, CPU/int8); AI suggestions use `GEMINI_API_KEY`. The first transcription
may download the speech model. Optional settings: `CONTENT_CLIP_WHISPER_MODEL`,
`CONTENT_CLIP_AI_MODEL` (default `gemini-2.5-flash`), `CONTENT_CLIP_PYTHON`,
`CONTENT_CLIP_YTDLP`, and `CONTENT_CLIP_DIR`.

The new `content-clips-data` Docker volume stores private source/export files at
`/app/data/content-clips`. Back it up with Postgres; do not delete this volume on
redeploy. The app creates it with the container user's ownership. Media is served
through authenticated routes with byte-range support, not through public uploads.
Ensure nginx allows `client_max_body_size 510m` on this app's virtual host for
uploads. The upload endpoint streams to disk. Render and transcription work runs
in the background; it does not require a long-lived browser connection.

Jobs start after API responses and recover through the existing five-minute
Content Desk cron endpoint. No additional cron entry is needed. One Clip Studio
job runs at a time across app processes, with a renewable database lease and
bounded process timeouts. Interrupted jobs recover once, then show an explicit
retry action. Draft saves use optimistic versions; exports retain their own
immutable draft/transcript snapshots. Exporting never sets a story to POSTED or
increments posting KPIs. Account branding defaults are saved only after the
story has an assigned account. Existing team edit permissions apply.

QA: run `scripts/test_content_clips.ts` only against the isolated migrated
`state_accounts_verify` database. It creates synthetic footage and performs a
real Remotion/FFmpeg export, along with access, retry, recovery, transcript
version, and draft-conflict checks. Set `PUPPETEER_EXECUTABLE_PATH` for a local
Chrome executable when needed. Deployment smoke checks should cover the new
migration, private volume write permissions, ffmpeg/Python/yt-dlp availability,
authenticated video ranges, and a short exported fixture.

### Clip Studio YouTube downloads through RapidAPI

Set `RAPIDAPI_YOUTUBE_KEY` in the server `.env` and recreate the app container.
The key is used only by the backend for APIHubCloud's **Cloud Api Hub - Youtube
Downloader** at `cloud-api-hub-youtube-downloader.p.rapidapi.com`.
Each YouTube import calls `/info` to validate duration/live status, then `/download`
to resolve fresh Google Video links. The worker selects up to 1080p, downloads
video and audio separately when needed, and merges them locally with FFmpeg.
The provider's separately metered `/mux` endpoint is not used. Short sources may
only offer lower resolutions. Downloads retain the 20-minute / 500 MB limits.

Both the documented and current format responses are supported. Signed links
are used immediately and not saved in story data. API credentials never accompany
media downloads. Missing credentials, denied access/subscription, quota limits,
provider errors, expired/blocked media, and unsupported formats produce clear
retry/upload feedback in the existing Clip Studio job panel. YouTube uses this
provider directly; Instagram keeps yt-dlp and TikTok keeps its existing provider.
No schema migration or additional cron is required.

Run `npx tsx scripts/test_youtube_rapidapi.ts` for format-selection and provider-error
regressions, plus the existing Clip Studio suite. Live verification should import
a YouTube URL through the authenticated Clip Studio API and confirm video and
audio are both present in its downloadable source.
