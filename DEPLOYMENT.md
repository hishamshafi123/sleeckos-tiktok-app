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
