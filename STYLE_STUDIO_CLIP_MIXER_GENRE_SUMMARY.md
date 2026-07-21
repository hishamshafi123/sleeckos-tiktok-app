# Style Studio, Clip Mixer, & Bulk Genre — Implementation Summary

This document explains in detail the features, services, workers, and bug fixes we implemented in the **Style Studio**, **Clip Mixer**, and **Bulk Genre / Lyrical Builder** modules of SleeckOS.

---

## 1. Style Studio (Remotion + Overlay Subsystem)

The Style Studio allows admins and users to create, preview, and save modular text styling presets, which are then used as overlays for video compositions.

### Core Implementations:
* **Background Worker Queue (`style-studio.ts`)**:
  * Built a robust sequential job processing system (`triggerRenderWorker()` and `processQueue()`) using a concurrency lock (`isWorkerRunning`) to prevent CPU/RAM starvation.
  * Programmatic Select & Render: Implemented automatic lookup, parameter parsing, and compilation of Remotion compositions based on the active template type.
* **Transparent WebM Video Rendering**:
  * Programmed the renderer (`performRemotionRender`) to output high-resolution transparent **VP9 WebM** clips (`codec: "vp9"`) containing alpha transparency channels so they overlay cleanly on video tracks.
  * Integrated direct Cloudflare R2 backup uploads in the background.
* **Smart Overlay Cache & Fingerprinting (`getOrCreateOverlay`)**:
  * Implemented an overlay-caching mechanism. It hashes the combination of `savedStyleId`, `templateKey`, and input parameters (`SHA-256`) to determine if a matching overlay is already rendered.
  * Employs `.ready` sentinel-file checks to prevent parallel thread collisions. If a cache hit is found, it immediately serves the file, reducing render time to $0$ seconds.
* **Default Style Templates & CRUD Presets**:
  * Seeded customizable defaults: **Brat** (Charli XCX style with dynamic green backing, blur offsets, and italic/bold flags), **Spotify Lyrics Card**, **Animated Minimal Quote**, **News Lower Third**, **Breaking Headline**, **Subtitle Box**, and **Quote/Statement Card**.
  * Developed the client API handlers and database mapping to parse custom configuration properties, validating JSON formats, and resolving double JSON serialization bugs.

---

## 2. Clip Mixer (Multi-Video Recipe & Packing Pipeline)

The Clip Mixer takes static clip folders, chops them up into timed slices, applies background filters/subtitles, and exports them.

### Core Implementations:
* **Algorithm-Controlled Variation Engine (`generateRecipesForBatch`)**:
  * Programmed the recipe generator to mix clips with controlled entropy based on a selectable **Variation Strength (1 to 5)**:
    * *Strength 1 (Deterministic)*: Sequential slice mapping, zero shuffling, and starts trims at `0`.
    * *Strength 2*: Subtle randomized segment trims (+/- 0.5s variance), minimal shuffle rotation.
    * *Strength 3 (Default)*: Full random shuffling, trim variance up to +/- 2s, target durations variable.
    * *Strength 4*: Random shuffling, variable slice durations (2.5s to 5.5s), fully randomized trims.
    * *Strength 5 (Extreme)*: Variable slice counts, extreme trim variance, randomized durations (2s to 6s) to ensure maximum difference between sibling clips.
* **Duplicate Prevention Hashing (`calculateRecipeFingerprint`)**:
  * Built a deterministic recipe SHA-256 builder. It hashes normalized clip IDs, start times (rounded to 1 decimal place to prevent float variance), and audio tracks to guarantee that no two generated variations are identical.
* **Dual Rendering Pathways**:
  * *Solid BG Overlay (Muxing)*: Combines pre-rendered style overlay tracks with background footage using quick, lossless FFmpeg mapping.
  * *Direct ASS Subtitle Burn (Custom Rendering)*: Implemented a custom ASS file generator that translates subtitles directly onto background footage. Connects parameters such as font face, active color highlights, letter spacing, horizontal text margins, lo-fi pixelation neighbor filters (`lofiFactor`), and custom aspect ratio scales.
* **Multi-Account Bulk Packaging (`exportBatchArchive`)**:
  * Developed an exporter that packs thousands of rendered videos into distinct directories mapped to account groups (e.g., `Account_1`, `Account_2`) on local disk.
  * Integrates auto-fetching from Cloudflare R2 if files are missing from local disk, builds `.tar` packages via sub-processes, uploads the archives back to R2, and tracks download metrics.

---

## 3. Bulk Genre & Wizard (Lyrical Builder & Quote Batcher)

The bulk builder allows users to queue hundreds of videos across multiple accounts simultaneously using quote or song subtitle templates.

### Core Implementations:
* **Lyrical Batch Generation (`CREATE_LYRICAL_BATCH`)**:
  * Structured the batch creation handler to accept multiple accounts, multiple track IDs, and multiple style templates simultaneously.
  * Built the distribution sequencer (`mixupVisuals`) which maps visual parameters sequentially so that tracks and caption templates are distributed evenly across target TikTok accounts.
  * Programmed the system to cycle sequentially through account vertical background loops to guarantee background footages are distributed fairly.
* **Sequential Batch Rendering Worker (`processBatchRendering`)**:
  * Programmed the background sequential runner for genres batches.
  * Built two rendering tracks:
    * **Solid Background Mux (`G0`)**: Instantly overlays the pre-rendered caption overlays onto audio tracks.
    * **Direct Subtitle Burn (`G1`)**: Compiles SSA/ASS subtitles, builds customized filter complexes dynamically (handling scale, crop, aspect ratio, frame rate conversion, color overlay, and lo-fi factor), and encodes using FFmpeg.
* **Self-Healing Overlay Pre-renderer**:
  * Implemented an inline checker inside the background worker. If a batch item requires a template overlay that was deleted or never pre-rendered, the worker pauses, auto-compiles the transparent WebM layout via Style Studio, and resumes composition automatically.
* **Single-Item & Bulk Retry Controls (`RETRY_FAILED`)**:
  * Added UI controls (individual grid retry buttons and footer bulk retry buttons) and API endpoints. 
  * Allows users to reset failed video items to `PENDING`, clear previous FFmpeg errors, and trigger queue workers to process remaining items without re-creating the entire batch.
* **Audio Offset & Ending Trimmer**:
  * Created dynamic trim selectors in the wizard to specify starting offsets (`trackStartOffset`) and ending timings, trimming music input tracks directly inside the FFmpeg process.
