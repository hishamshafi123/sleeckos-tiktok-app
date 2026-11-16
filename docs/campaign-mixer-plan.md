# Campaign Mixer: product and engineering plan

Status: implemented, 16 November 2026; final release verification and deployment status are recorded in `docs/campaign-mixer-qa.md`. The sections below retain the product/engineering design; the QA record distinguishes shipped controls from follow-up refinements.

## 1. Outcome and reference

Add **Campaign Mixer** as an option inside Multiplier. A saved campaign library holds clips, on-screen texts, music, and look presets. A daily batch uses an explicit selection from that library. The user previews the combinations and confirms the requested output count once. Completed videos go through Smart Export to the selected accounts.

The working unit is **one clip + one text + one music track + one look preset = one output**. Each clip has a selected trim and crop; each music track has a selected start point. A montage of several clips in one output would be a separate mode and is not assumed here.

Inspected reference: `V245_T05_rise-up.mp4`, 11.4 seconds, 1080 × 1920, 30 fps, H.264 video with AAC audio. Sampled frames show a close vertical crop, dark/muted treatment, vignette, and white, left-aligned sentence-case sans-serif text with no solid caption bar. The same phrase persists in the sampled middle/end frames. The text is around the lower third; the requested implementation should preserve the treatment but move the text into the upper or middle safe area.

The original font name is not present in the inspected MP4 metadata. Exact identification remains unverified. Establish a reference-matched preset through rendered comparisons, reusing the existing Style Match/font registry if useful; an AI font guess is still a guess. If the original font is identified and available, use its actual font file. Otherwise label the chosen match honestly. Inter, Public Sans, and Libre Franklin are already bundled candidates for similar alternatives.

Confirmed audio default: **music replaces source audio**, with an option to keep the original sound. When enabled, source audio and background music have separate volume controls and optional ducking. Save this choice with the campaign and snapshot it in each batch.

## 2. User workflow

### Saved campaign library

- Open an existing campaign and create its Mixer workspace. Store the existing campaign ID rather than matching by campaign name.
- Save uploaded clips and music, text entries, selected looks, audio settings, text placement, and export defaults on the server.
- Keep on-screen text separate from the campaign's posting-caption pool (`Campaign.fixedTexts`). Pasting overlay text must not change posting captions.
- Upload several files with per-file progress, validation, retry, thumbnails/waveforms, duration, and readable filenames. A failed file does not discard successful uploads.
- Paste one text per row, import spreadsheet rows, and edit multiline text within a row. Show duplicate entries and require at least one valid selection in each required category.
- Allow rename, tags, archive, and replacement. Content is immutable after upload; replacing an asset creates a new asset identity. Archive hides it from future selection while preserving past batches.
- Show clips as All, Newly added, Unused, and Used. A card shows last use and usage count. Offer Select new and Clear selection.
- Save optional clip/text compatibility tags so a phrase can be restricted to the clips it actually describes.

### Daily batch

1. Open the saved campaign and choose **New batch**. All library materials remain available; no clips are silently selected. **Use last selection** is an explicit shortcut.
2. Upload new clips or select any existing clips for today. Select texts, music, and one or more look presets. Remember the campaign's text/music/look defaults.
3. Adjust crop and trim only where needed. By default, preserve the selected clip's duration. Choose a music start point per track, then trim music to the output duration.
4. Enter the number of outputs. Show possible combinations, unused combinations, and style variations as described below. Optionally derive the number from account quotas and export days.
5. Choose **Preview batch**. Show representative playable previews and a paginated list of all planned outputs. Cover each selected look/music track and the longest text in the sample selection. No full batch is queued yet.
6. Review the exact inputs, requested/available counts, repeated source clips, warnings, and estimated disk/time range. Time estimates come from measured render throughput; initially show that an estimate is not available.
7. **Confirm and render N videos** freezes this plan and queues one batch. A double-click or network retry must return the same batch.
8. Follow one progress page. View completed files, retry only failed files, or download selected outputs/the batch. Open Smart Export when ready.

Reopening the campaign tomorrow keeps its library and defaults. Adding, archiving, or editing library material must not mutate a running or completed batch. Keep draft selections server-side with a visible Saved/Saving/Save failed indicator and conflict detection for simultaneous edits.

## 3. Honest capacity and variation selection

For unrestricted selections, the basic upper bound is:

`selected clips × selected texts × selected music tracks × selected look presets`

Example: 12 clips × 20 texts × 4 tracks × 3 looks = **2,880 rendered variations**, based on **960 clip/text/music combinations**. These are example inputs, not current campaign inventory.

The actual available count excludes duplicate inputs, invalid media or trims, incompatible clip/text pairings, unusable audio segments, text that cannot fit a selected layout, and combinations already reserved or rendered in this campaign. When eligibility differs between clips, count the valid combinations rather than multiplying raw list lengths. Display both total possible and unused eligible variations, with exclusion reasons.

Rules:

- Normalize duplicate text for comparison without rewriting the user's displayed text. Renaming a file or preset must not inflate capacity. Detect identical uploaded file bytes with content hashes; do not claim that this detects every re-encoded copy of the same scene.
- Maintain a **content key** for clip/trim + normalized text + music/segment, and a **render recipe key** that also includes the effective look/font/layout/audio settings. Versions and labels alone do not create novelty.
- Treat fonts as part of a look or an explicit override. Do not silently multiply capacity by the number of fonts in the font picker.
- Show how many outputs add new content combinations and how many are additional visual treatments. This is internal recipe uniqueness, not a claim about TikTok's originality classification or reach.
- Prefer unused content combinations first, then spread selected clips, texts, music, and looks as evenly as eligibility allows. Use a saved deterministic seed so refreshes do not reshuffle an approved plan.
- If N is too small to use every selected clip, track, text, or look, show which selections are absent from that batch and offer to increase N. Balance does not mean every selection can appear in a two-video batch. Representative previews of additional looks must be labeled as previews rather than promised outputs.
- Count from finite, explicitly selected assets and settings. Do not manufacture an unlimited count from arbitrary trim offsets, microscopic color changes, or random seeds.
- Compute counts without creating every possible database row. Generate only the requested number of output recipes. For small inventories, verify the count against full enumeration in tests.
- If the requested count exceeds capacity, show the exact shortfall and which selections can expand it. Do not silently duplicate videos to fill the requested count.
- Reserve recipe keys transactionally when the batch is confirmed. Concurrent users must not reserve the same unused recipe twice. Failed items retry the same recipe; canceled, never-completed recipes may be explicitly released. A successful render remains in usage history even if its output file is later removed.

## 4. Editing, typography, and preview

### Looks

Start with six selectable looks: **Reference Dark**, **Soft Fade**, **Clean Contrast**, **Warm Film**, **Cool Muted**, and **Monochrome**. The first is tuned against the supplied reference. All are restrained, parameterized treatments with named, versioned settings, not unpredictable AI-generated filters.

A look can define exposure/contrast/saturation, color tint, vignette, fade timings, font/weight, text color/shadow, and safe placement. Users can select several looks for a batch and save their own preset. Settings are frozen into each recipe so changing a preset later cannot change an old video.

### Text

- Offer **Upper** and **Middle** anchors, left or centered alignment, bounded movement, and a TikTok interface preview toggle.
- Show the caption/action-button exclusion areas. Measure the entire text box, including wrapping, shadow, stroke, and animation, rather than checking only its anchor point.
- Respect deliberate line breaks. Auto-fit within a readable size range; if it still cannot fit, show the offending text and require a shorter text, different layout, or explicit exclusion of that combination. Never silently truncate or shrink it into unreadability.
- Keep the phrase visible for the full output by default, with configurable entry/exit fades. Preserve sentence case by default to follow the reference.
- Load the actual font file in preview and rendering. For Mixer jobs, a missing selected font is an actionable error rather than a silent system-font fallback.
- Provide a per-clip crop/focal point and placement override so faces or relevant details are not obscured. Automatic face tracking is not required for this first version.

TikTok's official guidance says safe areas depend on format, caption length, and additional UI, and previews can differ by device. Its published templates are for ads; use them as a conservative starting reference, then validate the organic-feed presentation on representative phone layouts. Store a versioned safe-area profile, not a claimed universal rectangle. Source checked 16 November 2026: [TikTok in-feed specifications and safe zones](https://ads.tiktok.com/resources/help/article/tiktok-auction-in-feed-ads?lang=en).

Proposed house layout for initial QA, not an official TikTok specification: keep the complete text box within x=12–72% and y=16–60% of the frame, with upper and middle anchors inside that area. Adjust against the current overlays and real device checks before release.

### Audio and output

- Support several uploaded MP3/WAV/M4A tracks after validation/normalization; one selected track per output.
- Give each track a playback preview and start-point selector. Do not randomly choose an unknown section of a song.
- Trim longer tracks; when a track is too short, offer an explicit loop-with-crossfade setting or exclude that pairing. Do not freeze the video or silently shorten it to the audio.
- Normalize playback level, limit peaks, and apply short audio fades. Source-audio mixing is optional and has independent controls.
- Target 1080 × 1920, 30 fps, H.264/yuv420p/AAC MP4 with faststart, matching the reference's dimensions. Show a lower-resolution warning for low-quality inputs. Provide a clearly labeled 720p speed option only if needed after benchmarking.
- Use the same crop, typography metrics, timing, and look definitions in preview and export. Because browser and FFmpeg color handling can differ, provide an optional **Render sample** action using the production renderer before a large batch.

## 5. Interface plan

Add a **Campaign Mixer** tab beside Group Builder, Bulk Intake, and Queue Dashboard. Keep the existing application's Inter typography and palette: canvas `#09090b`, surfaces `#18181b`, dividers `#27272a`, text `#fafafa`, secondary text `#a1a1aa`, action accent `#E11D48`. Reuse existing semantic success/error colors and focus behavior. The video/output font picker is independent of interface typography.

Use the video preview as the visual focus. On desktop, a campaign/library column sits beside a larger selection area and a persistent portrait preview. The main selection area switches among Clips, Texts, Music, and Looks. Use filmstrip cards for clips, editable rows for texts, compact playback rows for music, and actual sample previews for looks.

Conceptual layout:

```text
Multiplier   Group Builder | Bulk Intake | Campaign Mixer | Queue
Campaign: [saved campaign]        [New batch] [History]   Saved
----------------------------------------------------------------
Library / batches | Clips  Texts  Music  Looks | Portrait preview
                  | Select new / Clear       | Safe-area toggle
                  | Thumbnails + checkboxes  | Upper / Middle
                  | Per-file status          | Font / audio / crop
----------------------------------------------------------------
Selected assets | Available / unused | Outputs [N] | Preview batch
```

The review step replaces selection controls with the planned output list, representative previews, and **Confirm and render N videos**. Counts and errors remain visible near the action. Output filenames, batch names, and dates use the configured business timezone; changing a timezone does not rewrite historical batch labels or recipe identities.

At narrower widths, stack the preview and controls, retain a reachable primary action, and avoid a four-column squeeze. Use keyboard-accessible selection, visible focus, labels beyond color, and bounded lists/pagination for large libraries. Do not put all configuration in a large modal or append the entire feature to the existing 7,000+ line ClientPage component.

## 6. Smart Export from one batch

Current code already accepts one selected group, but it limits each account folder to **one output from that group across export runs**. Therefore one batch with many outputs currently cannot fill several videos per account if represented as one group. The restriction exists in both the assignment planner and transactional reservation checks; a UI-only change cannot fix it.

Add a server-derived **Mixer distribution policy**:

- One Mixer batch can supply all selected accounts and more than one distinct output to each account. The user chooses accounts, per-account daily counts, and number of days in the existing Smart Export flow.
- For example, one batch of 120 eligible outputs can supply 10 accounts with 12 distinct outputs each, subject to the selected quotas and account eligibility.
- Prefer varied source clips/texts/audio within each account's allocation. Reusing a source clip with a different recipe is allowed when necessary and shown in the allocation preview; it is not blocked by the legacy group rule.
- A completed output is allocated only once in a plan by default. Never send the same completed recipe to the same destination again by accident, including after retries or output cleanup.
- Keep pending/in-progress reservations in eligibility checks. Reserve atomically and revalidate a stale preview on confirmation. Keep existing upload leases, quota pause/resume, and duplicate-upload reconciliation.
- If supply cannot satisfy every account, show requested, assignable, and missing counts per account. The user can reduce quotas, render more, or explicitly accept the displayed partial allocation. Do not imply full delivery.
- Keep the legacy one-group-per-folder rule for existing Group Builder/Bulk Intake content. Derive the policy from persisted output/run provenance, never a client flag that can bypass validation.
- Keep export history that survives output deletion, including destination folder and account snapshot, recipe identity, result, and Drive file ID. Folder and account IDs both matter because accounts may be replaced.
- Preserve campaign filename prefixes, fixed posting-caption snapshots, campaign events, and AccountFeedEvent behavior. Smart Export delivers to account Drive folders; the existing publishing pipeline then handles posting. Label export and posting statuses separately.

## 7. Engineering design

### Reuse and gaps found in this checkout

- `prisma/schema.prisma`: current groups support video variations and hooks; bulk intake uses a preset split. There is no persistent Mixer music/clip library or complete per-output music/look recipe.
- `src/lib/services/multiplier.ts`: capacity is currently hooks or variations × hooks; composition normalizes to 720p, overlays a still, and retains source audio. Add a separate Mixer composition path for music, color, full-duration text, and 1080p.
- `src/lib/services/style-match.ts`, `src/lib/fonts.ts`, `src/remotion/fonts.ts`: reuse style/reference analysis and installed font assets, while making Mixer font validation stricter.
- `src/lib/services/multiplier-performance.ts`: reuse render/export admission limits. A single user-visible batch is many durable jobs with bounded concurrency, not one enormous FFmpeg process.
- `src/lib/services/smart-export-assign.ts` and `multiplier-export.ts`: add Mixer assignment and reservation policy together.
- `docs/multiplier-api.md`: extend the documented API and preserve current callers.

### Data model and lifecycle

Final names can follow repository conventions, but the following responsibilities must be separate:

1. **Mixer workspace**: existing campaign relation, name, defaults, revision, ownership/permission information, archived state.
2. **Library assets and text entries**: immutable content/storage identity, hashes, media metadata, current editable settings, tags, and archive status. Preserve source media separately from derived proxies.
3. **Mixer run**: workspace, label/business day/timezone snapshot, exact selected assets/settings, requested count, seed, plan hash, idempotency key, state, counts, creator, and timestamps.
4. **Output recipe**: one immutable snapshot linked to an existing MultiplierOutput, including asset versions/hashes, trim/crop, text, audio segment/mix, full look settings, selected font identity, safety profile, and content/render keys.
5. **Usage and delivery ledger**: reservations, successful renders, and exports that survive clearing rendered files or deleting a group. Database uniqueness and transactional claims enforce deduplication.

Represent a Mixer run as one MultiplierGroup with explicit persisted provenance, so existing queue/output/export plumbing can be reused. The Mixer planner creates exactly N recipes/outputs; do not call the legacy Cartesian-output generator for a Mixer run. Extend the worker by dispatching on that provenance. Existing variations/hooks can act as references for compatibility, but must not own or delete shared library files.

Use additive schema changes with a corresponding migration generated locally by `prisma migrate dev`, per AGENTS.md. Rehearse the migration on the disposable database. Legacy groups default to their current behavior.

### API, storage, and rendering

- Keep workspace/library/run APIs in the Multiplier permission boundary. Support optimistic revisions, structured validation errors, paginated reads, and idempotent run creation.
- The server owns counts, validation, recipe generation, and reservation; browser calculations are previews only.
- Stream uploads to a durable volume, validate actual media via ffprobe, then generate cached thumbnails/proxies and normalized audio. Do not trust file extensions or store entire large uploads in memory.
- Retain library files across container rebuilds. Reference-count shared originals/derived media; deleting a batch or clearing outputs must not delete tomorrow's source library. Include library storage in backup/restore documentation.
- Use typed, bounded filter settings and argument arrays for FFmpeg. Never interpolate pasted text into a shell command. Render caption images with the existing font/layout tooling, then compose crop, grade, vignette, timed text, audio, and fades with FFmpeg.
- Render to a temporary file, validate streams/dimensions/duration/audio/decode success, and publish by atomic rename before marking complete. Unexpected font fallback or text overflow fails validation.
- Reuse durable output leases and heartbeats. Recover interrupted work after restart; fence stale workers from publishing a second result. Retry only transient failures with a bound; malformed media or missing fonts need a visible corrective action.
- Batch progress distinguishes queued, processing, completed, failed, canceled, and partial success. Pause stops new claims; cancel leaves completed outputs available and stops/reclaims work consistently.
- Check free disk before confirmation and during processing. Pause with an actionable message before exhausting storage. Cache safe reusable intermediates, clean temporary files, and keep cleanup separate from library/history retention.
- Return stable error codes with affected asset/output, stage, human-readable reason, and next action. Example: “Track Rise Up has 6 seconds remaining; this clip needs 11.4 seconds. Move the music start earlier, enable looping, or choose another track.”

## 8. Execution order and engineering QA loop

Use the same loop for each phase: **write acceptance checks → implement a bounded slice → run focused checks → inspect rendered/UI evidence → fix failures → rerun affected checks → record a passing checkpoint**. No phase is complete on TypeScript success alone. Do not rerun unrelated suites indefinitely; broaden checks when a change affects a shared path. If a blocker cannot be fixed within a phase, record the exact blocker and preserve the last passing state.

### Phase 1 — reference renderer and layout contract

Implement a small Mixer recipe/composition path, reference preset, font loading, audio replacement/mix, and measured safe text bounds. Render representative raw fixtures with short/long text, bright/dark footage, landscape/portrait inputs, and different music lengths. Compare first/middle/last frames and listen to transitions. Tune the look and font match before building mass generation.

Gate: consistent 1080p output; no clipping, unexpected black frames, missing audio, hidden text, silent font substitution, or duration changes. Exact-font identification is resolved or the chosen match is explicitly recorded.

### Phase 2 — saved library and daily selection

Add the migration, workspace/library APIs, persistent uploads, and the modular Campaign Mixer UI. Test server persistence, reopening after logout/restart, adding a new clip, selecting only today's clips, and archiving without damaging old runs. Verify existing Multiplier paths still open and render.

Gate: next-day reuse works from server data; selections are explicit; failed uploads are recoverable; shared files survive cleanup operations.

### Phase 3 — planner, previews, and batch queue

Implement eligible counts, deterministic selection, immutable snapshots, reservation/idempotency, preview/review, confirmation, queue progress, pause/cancel, and retry. Validate every planned text layout before queuing the full batch.

Gate: the 12 × 20 × 4 × 3 example yields 2,880 variants and 960 base combinations before exclusions; duplicate assets do not inflate it; exclusions/history reduce it correctly; selecting N creates exactly N outputs. Small-N plans accurately report which selections they use. Concurrent confirmation and restart tests create no extra recipes or completed files.

### Phase 4 — single-batch Smart Export

Implement the Mixer policy in assignment preview, transaction reservations, upload, and durable delivery history. Add the batch-to-export handoff and clear account allocation preview.

Gate: one 120-output batch fills ten 12-output destinations; short supply is explicit; repeated/concurrent export clicks do not duplicate deliveries; failures resume; legacy groups retain their current restrictions. Validate campaign attribution and posting-caption preservation without publishing test videos.

### Phase 5 — full rehearsal and release

Run an end-to-end disposable campaign: upload → save → reopen → select → preview → confirm → render → export to isolated test folders. Exercise corrupted media, missing font, short music, long text, full disk, worker termination, browser refresh, stale selection, Drive quota pause, duplicate clicks, and cleanup. Export tests use fixtures/mocks first and dedicated test destinations when a live Drive check is necessary.

Measure a small representative 1080p batch under current worker limits, then increase size if resource measurements support it. Use those measurements for estimates and render concurrency. Do not promise a fixed videos-per-minute rate before benchmarking.

Run required type/lint/build checks and the affected existing scripts, including multiplier rendering/performance and Smart Export fairness/idempotency/reliability. Add meaningful Mixer planner, persistence, layout/render, and single-batch export tests. Review desktop/mobile UI states and preview-to-final parity.

Deploy only after these gates pass, using the repository's actual deployment branch/path at implementation time. Back up the database and persistent media, deploy the additive migration, run a small isolated canary, check health/queue recovery, then enable the feature. Retain a feature flag and documented rollback that pauses Mixer jobs and keeps the new data; an older worker must never claim Mixer recipes it cannot render.

### Checkpoint record

For each phase, retain a short record with: changed paths, acceptance checks, commands/results, representative rendered files or screenshots, observed failures and fixes, remaining blocker if any, and commit/deploy identifiers when applicable. The release checklist is complete only when every required gate has evidence.

## 9. Definition of done

- A saved campaign can be reopened on another day with its clips, texts, audio, and looks intact.
- Only selected clips enter the batch, and all selected preset/music choices participate according to the reviewed plan.
- The maximum/unused counts are accurate and understandable; refreshes and concurrent runs do not produce hidden duplicates.
- Approved text remains readable within the chosen TikTok-safe profile using the selected font, and actual exports match the approved recipe.
- One confirmation creates one recoverable batch of exactly the requested size; partial failures identify what failed and how to retry it.
- One completed batch can fill all selected account quotas through Smart Export when sufficient eligible videos exist.
- Render, export, and posting are separately visible; campaign attribution and existing workflows remain correct.
- Deleting outputs does not delete the saved library or erase the history used to prevent repeat renders/deliveries.
- The reference comparison, end-to-end rehearsal, recovery tests, and release canary have recorded passing evidence.
