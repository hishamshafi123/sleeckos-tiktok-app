# Pair-Programming Progress Summary — May 26, 2026

**Project:** Sleeckos TikTok App
**Active Branch:** `postpeer` (All changes are successfully committed and pushed to `origin/postpeer`)
**Status:** Typechecks cleanly with **0 compilation errors** (`npx tsc --noEmit` passed).

---

## 1. Features Implemented & Pushed

### A. Maximum Audio Track Reuse "Off" Toggle (Step 3)
* **Wizard Step 3 UI**: Added an interactive premium toggle button (`Limit: ON` / `Limit: OFF`) next to the Maximum Audio Track Reuse range slider in `/admin/genres/page.tsx`.
* **State Behavior**: When set to **OFF**, the range slider is completely hidden, the UI displays `Unlimited`, and `audioReuseMax` is set to `0`.
* **Backend Bypass**: In `src/lib/composer.ts`, modified the `allocateTracks` round-robin allocator to check if `maxReuse <= 0`. If so, it maps `maxReuse` to `effectiveMaxReuse = 999999`, bypassing any repetition limits and distributing tracks in pure round-robin sequence without constraints. 
* **API Update**: Corrected the `START_RENDERING` action under `/api/managed/genres/batches` to pull `audioReuseMax` directly from the request payload instead of clamping it to a minimum of `1`.

### B. Single-Item & Bulk Retry for Failed Renders (Step 4)
* **Step 4 Footer (Bulk Retry)**: Added a "Retry Failed Renders" button at the bottom of the batch rendering wizard next to the "Finish" button. It only displays when the batch is not currently rendering and contains failed items.
* **Step 4 Grid (Single-Item Retry)**: Added a "Retry" button directly next to the `Failed` badge of each individual failed clip in the rendering list.
* **Batch API RETRY_FAILED Action**: Added support for both single-item and bulk retry in `/api/managed/genres/batches` under the `RETRY_FAILED` action:
  * If `itemId` is supplied: Resets that specific item's status to `PENDING` and clears its `errorMessage`.
  * If no `itemId` is supplied (bulk): Resets all `FAILED` items in the batch to `PENDING` and clears their error messages.
  * Updates the parent batch status back to `RENDERING` and kicks off `processBatchRendering(batchId)` in the background.
* **Worker Skipping Optimization**: The sequential background worker natively skips all `RENDERED` and `UPLOADED` clips, so it automatically processes only the re-queued failed clips.

---

## 2. FFmpeg Bug Fixes & Architecture Safeguards

### C. Curved Text SVG-to-PNG Rasterization Bypass
* **The Issue**: FFmpeg built inside the standard Alpine Docker container does not have the `librsvg` library, causing curved text overlays (which are generated as SVGs) to fail with `Decoding requested, but no decoder found for: svg`.
* **The Solution**: 
  1. Updated the standard `Dockerfile` (Stage 3 Runner) to install the `librsvg` package via `apk add`, which includes the highly optimized `rsvg-convert` CLI utility.
  2. Modified the `curveText` block in `src/lib/composer.ts` to convert the generated curved `.svg` file into a transparent, high-resolution `.png` file using `rsvg-convert` before passing the path to FFmpeg.
  3. Since PNGs are natively supported by all FFmpeg builds, this guarantees curved text overlays will compile seamlessly. 
  4. Updated cleanup hooks in `src/lib/composer.ts` to delete both the temporary `.svg` and `.png` files on complete/fail.

### D. Drawtext Option Double-Quoting Strategy (Apostrophe & Comma Fix)
* **The Issue**: Previously, text values in drawtext filters were wrapped in single quotes (`text='...'`). If a quote text contained an apostrophe (like `YOU'LL` or `DON'T`), the escaped character (`YOU\'LL`) was misread by FFmpeg's script file parser. The apostrophe terminated the single-quoted option prematurely and opened a new unterminated string that spanned across semicolons (`;`). This merged all subsequent lines into one string, causing FFmpeg to fail with `No option name near 'a]afade=...'`.
* **The Solution**: 
  1. Updated `escapeFfmpegDrawtext` in `src/lib/composer.ts` to escape backslashes as `\\` and double quotes as `\"`.
  2. Updated all three `drawtextFilters.push` statements in `src/lib/composer.ts` to wrap text parameters in **double quotes** (`text="${escapedLineText}"`) instead of single quotes.
  3. Inside double quotes, apostrophes/single quotes are **natively safe** and require no escaping. Furthermore, double quotes protect internal commas and colons inside quotes from splitting the filtergraph chain, preventing separate punctuation-related parse failures.

### E. FFmpeg Option Comma Escaping (x Coordinate & Alpha Fade)
* **The Issue**: Comma separators inside mathematical expressions in drawtext options were parsed as filterchain separators by FFmpeg, splitting the filter options in half and causing `No such filter` crashes.
* **The Solution**:
  * **Coordinate Expressions**: Escaped commas inside all `x='max(...,...)'` expressions in `src/lib/composer.ts` as `\\,` to prevent splitting.
  * **Alpha Fade Expressions**: Escaped all commas in the conditional fade expression `:alpha='if(lt(t\,0.5)\,t/0.5\,if(...))'` as `\\,` in `src/lib/composer.ts`, resolving errors like `No such filter: '0.5)'`.

---

## 3. Pull & Redeployment Commands

Because we modified the `Dockerfile` to add `librsvg` for curved text rasterization, you **must** build the containers when deploying these updates on your VPS:

```bash
# 1. Navigate to the project directory
cd /home/ubuntu/sleeckos-tiktok-app

# 2. Pull the latest commits from the active branch
git pull origin postpeer

# 3. Rebuild the Docker images and restart containers in the background
docker compose up -d --build
```

---

*Copy and paste this summary to your next AI pair-programming session after your device restart, and the AI will have complete context of the current state, architecture, and deployment procedures!*
