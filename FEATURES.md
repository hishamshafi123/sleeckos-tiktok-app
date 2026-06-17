# SleeckOS — System Architecture & Feature Guide

This document provides a comprehensive, technical overview of the SleeckOS codebase, its tools, database schemas, and backend engines. You can feed this document directly into Claude or any LLM to give it immediate, complete context on how the application works.

---

## 1. System Overview

SleeckOS is a **Next.js (App Router)** application backed by a **Prisma ORM** layer connected to a **PostgreSQL** database. The entire ecosystem is deployed inside a multi-container **Docker** environment on an Ubuntu VPS, served behind an **Nginx** reverse proxy terminating TLS.

### Core Tech Stack
* **Frontend:** Next.js, React, TailwindCSS, Lucide Icons.
* **Backend:** Next.js API Routes (Serverless-style in Route Handlers), Prisma Client.
* **Media Processing Engines:** 
  * Node.js media orchestrators (`src/lib/composer.ts`).
  * Python-based media alignment and composition script (`scripts/lyrical_composer.py`).
  * **FFmpeg** & **rsvg-convert** (installed in the runner container) for high-performance rendering.
  * **stable-ts** (Whisper-backed word-level transcription) for caption synchronization.
* **OAuth & Publishing:** TikTok Content Posting API integration (Direct Post).

---

## 2. Major Tools & Core Features

SleeckOS contains three primary creative automation tools (under `/admin`) and a three-sided UGC Marketplace (under `/c/`, `/b/`, and `/admin`).

### A. Lyrical Composer / Genre Batches (`/admin/genres`)
The Lyrical Composer automates the generation of "lyrical/quote videos"—short vertical clips overlaying background video with synchronized word-by-word text tracks, custom fonts, vignettes, and music.

* **The Workflow:**
  1. The user uploads or selects an audio track.
  2. Selects/uploads background video clips.
  3. Selects a text/style template (e.g. *Brat*, *Lora*, *Outline*, *Modern*, *Bold*).
  4. Selects aspect ratio (**9:16 vertical** or **1:1 square**).
  5. Configures track duration, max audio track reuse, and **start/end audio trim boundaries**.
  6. Submits the batch for rendering.
* **Backend Rendering Flow:**
  * The Next.js API route `/api/managed/genres/batches` creates `GenreBatch` and `GenreBatchItem` models in the database.
  * The queue processor (`processBatchRendering` in `src/lib/composer.ts`) picks up pending items.
  * For each video:
    * It downloads/resolves the audio and background video files.
    * It runs the audio through **stable-ts** (via Python) to extract word-level timings.
    * If start and end trim boundaries are specified, it slices the audio, cuts the background video stream using FFmpeg (`-ss` and `-t`), and shifts the transcription word timings to start at `0.0`.
    * It generates SVG files for each lyric/caption line.
    * Because FFmpeg in Docker lacks native SVG decoding support, the app converts the SVGs to transparent PNGs using `rsvg-convert` before rendering.
    * Runs FFmpeg to combine the sliced video, the audio track, and the transparent overlay PNGs.
    * Saves the rendered output video under `public/uploads/renders/render_${itemId}.mp4`.
* **Robustness features:** Single-item and bulk retry capability for failed renders.

---

### B. Clip Mixer (`/admin/clip-mixer`)
The Clip Mixer organizes video clips into folders and automates sequence mixing—stitching clips together with transitions, background audio tracks, templates, and overlay assets.

* **Folder Management:** Creators upload raw video clips to specific workspace folders managed by the `/api/managed/clip-mixer/folders` route. Files are stored on the host under `/var/lib/docker/volumes/sleeckos-tiktok-app_uploads-data/_data/clip-mixer/[folderId]`.
* **Stitching & Mixing:**
  * Matches sequential clips with custom overlay graphics, transitions, and audio streams.
  * Combines multiple clips into single consolidated output videos.
  * Batches are processed and tracked via `/api/managed/clip-mixer/batches`.
* **Exporting & Archives:**
  * When a batch is complete, the app packages the generated clips into a zip archive inside `public/uploads/clip-mixer/archives/` for smart downloading.
  * *Note: These ZIP files can be pruned periodically using host terminal cleanup scripts to prevent disk bloat.*

---

### C. Multiplier (`/admin/multiplier`)
The Multiplier multiplies a single source video by applying a CSV list of text hooks (one video generated per hook), randomized visual styles, and background banner options.

* **The Workflow:**
  1. The user uploads one high-quality base source video.
  2. Uploads a CSV containing text hooks (e.g. caption titles, hooks, or quote text).
  3. Configures style variables: font family, font size, text position (Top, Center, Bottom), text case, background strip color, background strip opacity, border radius, and padding.
  4. Optionally selects design templates.
* **Rendering & Output:**
  * The system processes each hook, overlaying the custom text parameters on top of the base video using FFmpeg `drawtext` filters.
  * Multiplied output videos are saved in `public/uploads/multiplier/`.
  * Integrates with **Google Drive API** (`src/lib/google.ts`) to automatically upload the rendered videos directly into brand-specific Google Drive folders on complete.

---

### D. UGC Campaign Marketplace & TikTok Direct Post
SleeckOS supports a three-sided marketplace designed around TikTok's strict audit rules.

* **User Roles:**
  1. **Creator (`/c/`):** Connects a single TikTok account via OAuth, browses briefs, uploads draft videos for brand review, and posts approved content to TikTok.
  2. **Brand (`/b/`):** Signs up (gated by admin), submits campaign briefs, reviews creator applications, and approves draft videos.
  3. **Admin (`/admin`):** Approves brands/creators, manages disputes, and views audit logs.
* **TikTok Compliance Guardrails:**
  * **Branded Content Disclosure:** Automatically sets `brand_content_toggle: true` in the API payload, forcing the "Paid partnership" label. The toggle is locked-on in the composer UI.
  * **No Scheduling:** All posts are published immediately when the creator clicks confirm.
  * **No AI Captioning:** Captions are composed entirely by creators; no auto-generation or scraping.
  * **Single-Account Gate:** Each creator connects exactly one TikTok account.

---

## 3. Core Directory & File Map

* **`prisma/schema.prisma`** — Defines the relational database schema, including users, brands, campaigns, deliverables, genre batches (`GenreBatch`, `GenreBatchItem`), multiplier batches (`MultiplierBatch`), and audit logs.
* **`src/lib/composer.ts`** — The Node.js media orchestrator. Manages the execution queues, handles coordinate escaping, handles SVGs conversions to transparent PNGs via `rsvg-convert`, calls Python CLI scripts, and handles error catching and temporary file cleanup.
* **`scripts/lyrical_composer.py`** — The Python backend script. Invokes `faster-whisper` and `stable-ts` to transcribe audio, aligns text timestamps, slices video/audio streams, and outputs overlay instructions.
* **`src/lib/canvas-overlay-renderer.ts` & `src/lib/ffmpeg-overlay-renderer.ts`** — Visual layers that compute text bounding boxes, handle opacity, draw text borders, and generate coordinate expressions.
* **`src/lib/tiktok-managed.ts` & `src/lib/postpeer.ts`** — Code to handle Direct Posting. Handles chunked binary uploading, tracks upload states, and pulls verification details.
* **`deploy/` & `docker-compose.yml`** — System configurations, containing host nginx site configs, docker deployment files, and cron jobs.

---

## 4. Key Implementation Patterns & Gotchas

1. **FFmpeg Comma and Quote Escaping:** 
   FFmpeg’s filtergraph syntax is highly sensitive to punctuation. Text variables in `drawtext` filters are wrapped in double quotes (`text="string"`) rather than single quotes. This natively protects internal apostrophes (`'`). Comma symbols inside math expressions (e.g. `max(x, y)` or conditional statements) are double-escaped as `\\,` to prevent filtergraph splitting.
2. **Alpine SVG Rasterization Workaround:**
   Because Alpine Linux images frequently lack the `librsvg` library, standard FFmpeg builds inside Alpine cannot render SVG files. The codebase bypasses this by executing the `rsvg-convert` CLI utility to rasterize temporary `.svg` structures into transparent `.png` files, which are then easily composited by FFmpeg.
3. **Volume Disk Bloat:**
   The `uploads-data` Docker volume maps to `/app/public/uploads` inside the container. Since video generation generates heavy `.mp4` and `.zip` files, these folders must be pruned of temporary archives (like `public/uploads/clip-mixer/archives/*`) periodically via system maintenance tasks.
