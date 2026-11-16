# Campaign Mixer release verification

## Implemented

- Multiplier → Campaign Mixer: a saved library linked to the existing campaign ID; clips, music, editable on-screen texts, tags, archive, crop/trim, per-track start and saved defaults. On-screen texts do not modify campaign posting captions.
- Explicit daily clip selection, with a shortcut to the previous selection. File deduplication, per-file upload progress/errors and used/new/unused filters.
- Six built-in looks plus custom looks; four bundled font families; upper/middle text, measured wrapping and safe-area preview. The reference font is not conclusively identifiable from the MP4 and is labeled as an unverified match.
- Deterministic planner: total/unused eligible capacity, base content combinations versus extra treatments, coverage/exclusion feedback, immutable recipe snapshots and idempotent confirmation. Maximum 500 outputs per batch.
- Music replaces source audio by default; optional original audio with separate levels/ducking, and short-track looping. Real samples and batch outputs use the same FFmpeg/Pillow renderer.
- A recoverable batch queue with renewable claims, pause/resume, cancellation and retry of failed outputs. A persisted pause survives restart. Completed recipe history survives output cleanup.
- Completed output downloads and streaming batch ZIP. Smart Export can assign multiple distinct videos from one Mixer batch to each account. Durable recipe/destination history and output reservations prevent duplicate delivery; legacy group restrictions are preserved.
- Private source volume, authenticated media/range responses, low-disk checks on both source/output storage, disposable-cache pruning and a maintenance switch.

## Verification evidence

`scripts/test_campaign_mixer.ts --render`: 2,880 possible variations from the example selections; deterministic selection, duplicate/history exclusion, short audio, overflowing text, count validation and selection coverage. Real 1080×1920 H.264/AAC renders pass full decode and safe-area checks. Tone analysis confirms music-only removal of the source track, optional retained/ducked audio, and looping over the full clip duration.

`scripts/test_campaign_mixer_integration.ts`: disposable local database. Real asset normalization and duplicate upload; save/reopen; revision conflict; immutable snapshots; simultaneous identical confirmations; pause/resume/cancel; crash recovery while paused. A 120-output fixture batch fills ten 12-video destinations. Export reservation replay/concurrent conflict and delivery-history exclusion pass. Output cleanup preserves originals and rendered recipe history. No Google Drive upload or posting call is made.

`scripts/test_smart_export_fairness.ts`, `scripts/test_smart_export_idempotency.ts` and `scripts/test_smart_export_reliability.ts`: existing behavior passes, including legacy restrictions, concurrent reservations, quota/retry feedback and mocked Drive deduplication. The database test uses a separate, migrated local `sleeckos_mixer_kvm8_test` database. `scripts/test_multiplier_render_canary.ts` also passes four concurrent legacy renders and cleans up its fixtures.

`scripts/test_campaign_mixer_ui.ts`: passes against a disposable local production server; creates a library, uploads sources/music, saves text/defaults, previews, renders a sample and a real two-output batch, validates its ZIP, opens Smart Export and reloads the campaign. Desktop (1600px), laptop (1100px) and phone (390px) layouts have no horizontal overflow; mobile navigation opens/closes. The existing fixed desktop sidebar was made collapsible on phones to make this workflow usable. It never exports or posts. Screenshots and logs are local under `scratch/mixer-e2e` and `scratch/mixer-qa`.

TypeScript and targeted ESLint pass. Local production builds use `next build --webpack`: local Turbopack encounters an existing out-of-root Python venv symlink; Docker excludes that host venv and uses the normal build command. Local webpack development mode also encounters the existing native Remotion/Rspack instrumentation dependency, so browser checks use a production build.

## Scope and release notes

The original font remains unverified. Capacity means distinct internal recipes, not a guarantee of different perceived content or platform performance. The browser preview approximates grades/audio; **Render sample** is the final-render check. Text is entered as pasted lines/spreadsheet rows with per-row multiline editing; a dedicated CSV wizard and audio waveform editor are follow-up refinements. Render-time predictions need production throughput measurements; the review shows storage estimates and says when a time estimate is unavailable. Export account selections use the existing Smart Export interface and are not yet saved as Mixer-specific defaults.

Deployment: not performed. The VPS rejected SSH key authentication and the private password prompt timed out. The release is ready for the existing `postpeer` deployment path once private SSH access is supplied; pushing this branch does not trigger the `main`-only deployment workflow.
