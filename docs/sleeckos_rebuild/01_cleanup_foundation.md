# Phase 1 — Cleanup, Foundation & Design System

**Depends on:** nothing. This clears the deck for everything else.
**Load with:** `00_CONTEXT.md`.

## Objective
Remove the dead public marketplace, reorganize the admin navigation, install the shared design system, and lay the Cloudflare R2 storage groundwork.

## Inspect first
Before deleting anything, map what the marketplace code touches: routes, Prisma models, service files, and shared utilities. Some names (e.g. "campaign") may be reused by code you must keep. **List dependencies before removing.**

## A. Remove the marketplace (TikTok dev-verification scaffolding)
Remove, after confirming nothing live depends on them:
- Routes/pages: `/c/*` (creator), `/b/*` (brand)
- Roles: creator, brand (and any brand-gating/admin-approval flows tied only to them)
- TikTok OAuth + Direct Post publishing: `src/lib/tiktok-managed.ts`, `src/lib/postpeer.ts`, the chunked-upload/verification code, and the branded-content/compliance toggles in the composer UI
- Prisma models that exist **only** for the marketplace (creators, brands, deliverables, marketplace audit logs)

> **Caution:** Do **not** delete any "campaign"-style model or data that the new shared `Campaign` object (Phase 3) should inherit. If in doubt, keep the table and flag it for review rather than dropping it. Write a reversible migration.

## B. Reorganize admin navigation
Restructure `/admin` into clear top-level sections (final tools arrive in later phases — stub the nav now):
- **Production:** Clip Mixer, Style Studio, Lyrical/Quote Composer, Multiplier
- **Operations:** Campaigns, Projects
- **People:** Users & Access, LMS

Navigation must be driven by the permission spine (Phase 2) once it exists — for now, structure it so items can be hidden per-permission later.

## C. Install the design system (per the DESIGN MANDATE in 00_CONTEXT)
- Define the token layer (color ramp, accent, semantic status colors, type scale, spacing scale, radius scale) in one place.
- Build the base component set on Radix + Tailwind: Button, Input, Select, Dialog, Toast, Table (TanStack), Tabs, Badge/Status, Card, EmptyState, PageHeader, Sidebar/Nav.
- Apply it across existing pages so nothing still looks like the old/default theme.
- Re-read the "AVOID" list. The result must not read as AI-generated.

## D. Storage groundwork (Cloudflare R2)
- Add an R2 client/service (`src/lib/services/storage.ts`) with `upload`, `getSignedUrl`, `delete`.
- On batch/render completion, upload final outputs + zip archives to R2 and store the R2 key on the record; serve via signed URLs.
- Add a scheduled prune job for local temp/renders/archives older than a threshold (the volume is working space only).

## Acceptance criteria
- [ ] No `/c/` or `/b/` routes remain; no creator/brand roles; no TikTok OAuth/Direct Post code; app builds clean.
- [ ] A reversible migration removed only marketplace-only models; no "campaign" data was lost.
- [ ] Admin nav shows the Production / Operations / People structure.
- [ ] Design tokens + base components exist; every existing page uses them; UI passes the AVOID list.
- [ ] R2 upload + signed URL + prune job work end to end on at least one real output.

## Don't break
- Existing Clip Mixer, Lyrical Composer, and Multiplier must still function after the cleanup and re-theme.
