# Recent Updates (Past 2 Days)

A summary of all new features, bug fixes, and system improvements implemented on the **Sleeckos TikTok App** over the past two days (July 18 – July 19, 2026).

---

## 1. Video Multiplier & AI Hook Studio

### 🚀 Features & Enhancements
* **Auto-Transcription & Layout Previews:** Integrated auto-transcription for uploaded base videos, custom prompt builders, interactive visual progress bars, range-based previews, and a layout builder.
* **Smart Prompt Hook Count Syncing:** Changing the "Hooks Count" input now dynamically syncs the instructions in the prompt (e.g. `Generate exactly N...`).
  * If the prompt is unedited, it updates the whole template.
  * If you have manually edited the prompt, it updates the count inline using regex, **preventing manual edits from being lost**.
* **Iowa Campaign Markdown Context Ingestion:** Updated the campaigns query to select the `infoContent` markdown brief. This feeds the published campaign brief directly into the prompt generator context inputs instead of displaying `Info Context: None`.
* **Proportional Live Preview Sizing:** Replaced hardcoded CSS font sizes in the preview canvas with dynamic scaling: `fontSize / 3.6` (relative to the 720p output resolution). The layout now perfectly mimics the final rendered video overlay proportions.

### 🐛 Bug Fixes
* **Gemini Engine Upgrade (v2.5):** Upgraded model connections to `gemini-2.5-flash` in the backend and agent pipelines to resolve API 404 errors caused by Google's June 2026 retirement of v1.5 and v2.0 models.
* **Upload Timeout Fix (Nginx 504):** Removed the blocking synchronous `ffmpeg` compression step during video variation uploads. Videos now save directly in their uploaded form, resolving gateway timeouts.
* **Stable Group Builder Selection:** Added proper cleanup handlers to background poll intervals. This prevents multiple dangled timers from running on stale closures, resolving a bug where the selected group in the sidebar would jump back and forth.
* **Style Studio Presets Preservation:**
  * Fixed an override bug where default group settings took precedence over preset values. Mapped parameters to support templates (`textColor` -> `fontColor`, `bgColor` -> `bgStripColor`, `positionY` -> `positionYPercent`).
  * Fixed a double-serialization issue (where preset parameters were saved as stringified JSON strings). Added recursive JSON parsers to ensure presets load flawlessly.
* **Whisper OOM Crash Fix:** Optimized Whisper CPU thread counts and switched transcription to the `tiny` model to prevent container Out of Memory (OOM) killed crashes on the server.
* **Moviepy /dev/null Render Skip:** Skipped heavy audio writer loops when the rendering target is `/dev/null` to resolve an attribute error.

---

## 2. Managed Accounts Dashboard

### 🚀 Features & Enhancements
* **Natural Alphanumeric Sorting:** Added natural sorting logic to search results so numbered accounts (e.g., `account1`, `account2`, `account10`) order correctly.
* **Search Filters & Mode Toggles:** Implemented toggles to filter search results by **Account Name** or **Google Drive details** alongside a global search mode toggle.
* **Visual Card Customization:** Introduced strong background color tints on account cards matching their labels, alongside semantic statuses for color pickers.
* **Interactive Settings Popup:** Shifted the managed account settings panel to open inside an overlay popup modal on search result click instead of redirecting the page.
* **Google Drive click-throughs:** Made Google Drive folder badges on account cards clickable to open folders directly, and displayed the active folders inside the queue dashboard.

---

## 3. Smart Export & Publishing Pipeline

### 🚀 Features & Enhancements
* **Smart Campaign Exports:** Completed the Multiplier Smart Export pipeline. File exports now feature campaign-aware naming conventions based on campaign details.
* **Analytics Export Dashboard:** Built a campaign export analytics dashboard displaying daily export trends, folder destinations, and total exported items.
* **Queue Relative Times:** Displayed relative "time ago" stamps and direct Google Drive folders links in the post queue and history lists.
* **OAuth Priority Routing:** Configured `getDriveClient` to prioritize specific account OAuth credentials over default service accounts, ensuring files go to individual users' folders.

### 🐛 Bug Fixes
* **PostPeer Pagination Fetching:** Updated the PostPeer integrations client to query all pages using offset pagination instead of truncating results.
* **Token Expiry Health checks:** Fixed a BigInt serialization bug and resolved OAuth token expiration validation issues inside the cron health checking runner.
