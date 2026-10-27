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
