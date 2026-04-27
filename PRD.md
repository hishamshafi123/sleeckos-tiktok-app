# PRD — SleeckOS Content Posting API Demo App

> **Purpose of this document.** This is a Product Requirements Document to generate a working demo app. The app's only job is to be recorded as a demo video and submitted to TikTok for **Content Posting API → Direct Post** approval. Every design decision below is driven by TikTok's actual audit checklist. 

---

## 1. Context & Goal

### 1.1 What we're applying for
TikTok's **Content Posting API** with the **Direct Post** capability and the `video.publish` scope. Until audited, all posts go out as `SELF_ONLY` (private).

### 1.2 The product narrative (Core Positioning)
**SleeckOS is a desktop-first publishing tool for individual creators who film on real cameras (DSLR, mirrorless, drone, action cam) and edit in desktop software (Premiere, Final Cut, DaVinci, CapCut desktop).** 
The problem it solves: TikTok's mobile app handles desktop-edited footage poorly — large files, wrong codecs, wrong aspect ratios, no safe-zone preview for TikTok's UI overlays. This app fixes that.

### 1.3 Strict Constraints (DO NOT BUILD)
These will cause TikTok to reject the audit:
- **Multi-account management.** The app supports exactly ONE connected TikTok account per user. No account switcher.
- **Scheduling or queueing.** Every post is published immediately after the user clicks Confirm. No future-dated publishes. No drafts.
- **AI caption generation.** The user writes their own caption. We do not call any LLM to suggest, write, or rewrite caption text.
- **Bulk upload.** One video at a time.
- **Cross-posting from other platforms.** No Instagram/YouTube import.
- **Repost or content discovery features.** The app never browses, scrapes, or surfaces anyone else's content.
- **Watermarks, intros, outros, app branding overlaid on the video or caption.**

### 1.4 Use Case Description for TikTok Portal
"SleeckOS is a desktop publishing tool for individual creators who shoot on real cameras and edit on desktop. We solve a specific problem TikTok's mobile app handles poorly: getting professionally-shot footage (DSLR, mirrorless, drone, GoPro, ProRes/HEVC files, 16:9 or 4:3 source aspect ratios) into a TikTok-ready 9:16 vertical post without manual transcoding, guessing at safe zones, or losing quality in transit through cloud sync apps.
The workflow: a creator uploads one video file from their machine, the app runs a pre-flight check (codec, bitrate, aspect ratio, loudness, safe-zone preview), transcodes if needed, optionally generates accessibility captions for the creator to review and edit, then routes to the TikTok-compliant post composer where the creator manually selects privacy, interaction settings, and any commercial content disclosures before explicitly confirming publish.
The app supports one connected TikTok account per user, posts only when the user clicks confirm (no scheduling, no queueing, no automation), and never modifies caption text or adds branding to the content. Estimated usage is ~3 posts per active creator per week."

---

## 2. The Differentiator: Pre-flight Step

Page route: `/preflight/[uploadId]`
When the user uploads a video, before going to the composer, run a pre-flight analysis and show:
1. **Source spec detection**: codec, resolution, frame rate, bitrate, duration, color space, file size. Display as a row with a pass/warn/fail icon based on TikTok's preferred spec (H.264, 1080x1920 vertical preferred, 30fps, ~8Mbps, max 4GB).
2. **Transcode-on-upload**: if source is HEVC/ProRes/H.265 or large, transcode to H.264 MP4. Show progress.
3. **Aspect ratio & safe-zone preview**: render video inside 9:16 frame with TikTok's UI safe-zone overlays drawn on top. Allow dragging a 9:16 crop window if 16:9.
4. **Loudness check**: compute LUFS. Warn if quieter than -14 LUFS. Offer normalize.
5. **Accessibility helper**: auto-generate captions from audio (assistive transcription only, for burning into video, NOT the post caption).
*Note: For the demo app, a highly convincing UI simulation of these features is acceptable to demonstrate the value proposition for the audit video.*

Only after clicking "Continue to Post" does the user reach the Composer.

---

## 3. The Composer (`/compose`) — THE MOST IMPORTANT PAGE

This is the page TikTok auditors scrutinize. Every element below is required by TikTok's UX guidelines. Missing or pre-filled elements = automatic rejection.

1. **Account header**: Display creator's avatar, nickname, and username. "Posting to TikTok as:"
2. **Video preview with cover frame picker**.
3. **Caption / title field**: Editable, no LLM auto-generation, max 2200 chars.
4. **Privacy level dropdown**: "Who can view this video". Must have NO DEFAULT. Render options from `creator_info` `privacy_level_options`.
5. **Interaction toggles**: Allow comments, Duet, Stitch. ALL DEFAULT OFF. Disable if `creator_info` says disabled.
6. **Content disclosure section**: Master toggle "This post promotes a brand...", defaults OFF. Checkboxes "Your brand" and "Branded content". If Branded content + SELF_ONLY, block submission.
7. **Music Usage Confirmation**: Plain text disclaimer required.
8. **Publish button**: Triggers a confirmation modal before API call.

## 4. Other Required Pages
- `/` Landing page
- `/privacy` Privacy Policy
- `/terms` Terms of Service
- `/login` Single "Continue with TikTok" button
- `/dashboard` Shows connected account + "New Post"
- `/publishing/[publishId]` Status polling screen
- `/history` Past publishes
- `/settings` Disconnect button

## 5. API Endpoints
- OAuth: `/v2/auth/authorize/`, `/v2/oauth/token/`, `/v2/oauth/revoke/`
- Query: `/v2/post/publish/creator_info/query/`
- Direct Post: `/v2/post/publish/video/init/`, followed by chunks to `upload_url`.
- Status: `/v2/post/publish/status/fetch/`