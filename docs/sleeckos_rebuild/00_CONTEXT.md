# 00 — CONTEXT (load this in every session)

## What SleeckOS is now

SleeckOS is the **internal production OS for Lvon**, a TikTok content agency that clips and distributes video at high volume across political and music/entertainment niches. It is **no longer a public-facing product**. The old public marketplace (built only to pass TikTok developer verification) is being removed. Every user is an internal team member.

## Current stack (verify against the repo before changing anything)

- **Frontend:** Next.js (App Router), React, TailwindCSS, Lucide icons
- **Backend:** Next.js Route Handlers + Prisma Client
- **DB:** PostgreSQL via Prisma
- **Media:** FFmpeg + `rsvg-convert`; Python (`scripts/lyrical_composer.py`) using `stable-ts` / `faster-whisper`; Node orchestrator `src/lib/composer.ts`
- **Infra:** Docker (multi-container) on a Hostinger **KVM4 VPS, 200GB storage**, behind Nginx with TLS
- **Storage today:** local Docker volume `uploads-data` → `/app/public/uploads`

> **Agent: before any phase, read the real code.** Key files per the architecture: `prisma/schema.prisma`, `src/lib/composer.ts`, `scripts/lyrical_composer.py`, `src/lib/canvas-overlay-renderer.ts`, `src/lib/ffmpeg-overlay-renderer.ts`, the `/api/managed/*` routes, and `docker-compose.yml`. This document is intent; the repo is truth.

## Non-negotiable architecture rules

1. **Every action is a callable service function.** Put business logic in service functions (e.g. `src/lib/services/*`). Route handlers and UI are thin callers. This is what makes the future agent (Phase 9) a thin layer instead of a rewrite. No business logic inside React components or route handlers.

2. **One shared `Campaign` object.** Clip Mixer subfolders, the view-goal calculator, the Notion-style info page, and Project Management all reference the **same** `Campaign` row. Never create a second parallel "campaign" concept.

3. **One permission spine.** Roles (admin, team_lead, editor, curator) give default access bundles; per-user entitlements grant/revoke individual tools and pages on top. Every protected page and every service function checks it. The future agent acts *as a user* and is bound by the same checks.

4. **Hybrid render engine.**
   - **FFmpeg = the workhorse:** mixing, stitching, compositing, simple text overlays. Light, fast, runs at volume.
   - **Remotion = complex animated styles only** (e.g. Spotify-style lyric UI). Heavy (runs Chrome), so it runs through a **limited-concurrency queue** and only to **pre-render a style overlay once**.
   - **Pre-render once, composite many:** for a given (style × song/quote), render the transparent overlay one time via Remotion, cache it, then FFmpeg composites it onto every background variation. Never re-render the style per output video.

5. **Render as a separate worker.** Remotion rendering must be a separate service/queue, not inline in the web process — even while it lives on the same VPS. This lets it move to RunPod/Lambda later with zero rework. Concurrency limit: 1–2 at a time on the current VPS.

6. **Storage discipline.** Finished videos and zip archives offload to **Cloudflare R2**; local temp/renders are auto-pruned by a scheduled job. The 200GB volume is for working files only, never long-term storage.

## DESIGN MANDATE — "really good UI, not AI-looking" (applies to every phase)

The client has explicitly rejected the generic AI look. This is a hard requirement, judged on every screen.

**Target feel:** functional, minimal, dense, fast, confident. Reference points: **Linear, Vercel dashboard, Notion.** A professional internal tool an operator uses all day — clarity and speed over decoration.

**Libraries:**
- Tailwind (base) + **Radix UI primitives** for behavior/accessibility (shadcn/ui is acceptable as a starting point **only if restyled** — never ship it looking default).
- **TanStack Table** for data tables. **Tremor** or **Recharts** for the calculator/dashboard charts.
- **Lucide** for icons. **Motion** (Framer Motion) for sparse, purposeful micro-interactions only.

**Build a shared design system FIRST** (tokens + base components), then every page inherits it. Do not let pages diverge into five different looks.

**Explicitly AVOID (these read as AI-generated):**
- Purple/blue gradients, glassmorphism, large blurred glows
- Heavy drop shadows, oversized border-radius on everything
- Emoji in UI chrome, decorative icons that don't carry meaning
- The three current AI-default clusters: (a) cream `#F4F1EA` + high-contrast serif + terracotta; (b) near-black + single acid-green/vermilion accent; (c) broadsheet hairline-rule newspaper layout. Do not default into any of these.

**Do instead:**
- A restrained palette (one neutral ramp + one functional accent + semantic colors for status). Define 4–6 named hex tokens and derive everything from them.
- Real type scale with intentional weights and spacing; a characterful but legible UI face. Type is part of the identity, not a neutral delivery vehicle.
- High information density done cleanly: tight, consistent spacing; structural dividers/labels that encode real meaning, not decoration.
- Quality floor, unannounced: responsive to mobile, visible keyboard focus, `prefers-reduced-motion` respected, real empty/error/loading states.

**Copy rules:** active voice, sentence case, name things by what the user controls (not how the system is built). A button that says "Publish" produces a toast that says "Published." Errors say what went wrong and how to fix it; empty states invite an action.

## Conventions

- TypeScript everywhere. Prisma migrations for every schema change (never edit the DB by hand).
- Service functions are typed, single-purpose, and permission-aware.
- Each phase: small, reviewable commits. Don't refactor unrelated code while building a feature.
- After each phase, the app must build and run with no regressions to prior phases.
