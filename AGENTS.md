<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Hosting

App runs on an Ubuntu VPS via Docker Compose (Next.js app + Postgres 18). nginx terminates TLS and reverse-proxies to `127.0.0.1:3000`. Cron jobs run from the host crontab (`crontab -e`) calling `curl` against localhost. `vercel.json` is kept for reference only — it is **not active**. See `DEPLOYMENT.md` for the full setup guide.

# CI/CD

Push to `main` triggers auto-deploy via GitHub Actions (SSH → `git pull` → `docker compose up -d --build`). Migrations run automatically on container start via `prisma migrate deploy`.

**Schema changes:** always run `npx prisma migrate dev --name <description>` locally before pushing. This generates migration files in `prisma/migrations/` which must be committed. The server applies them automatically on next deploy. Never modify `prisma/schema.prisma` without a corresponding migration file.
