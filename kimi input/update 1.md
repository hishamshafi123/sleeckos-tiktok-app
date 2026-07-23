# Task — Style Studio Upgrade: Top-Class Style Creation Tool

## Read this first
Build/fix task, structured in ordered parts — **complete and verify each part before the next.** Inspect the existing Style Studio (templates, saved styles, the Remotion render worker, the overlay cache) before changing anything. Put logic in service functions; keep permission checks. The repo is the source of truth. This is **not** a full timeline video editor — do not build multi-track timelines. It is a fast, professional **style creation tool**: pick a template → tweak visually → save → the library feeds the production tools.

## Context
SleeckOS is an internal Next.js + Prisma + PostgreSQL app. **Style Studio** creates reusable text-overlay styles rendered by **Remotion** (transparent VP9 WebM overlays, cached by SHA-256 of style+params, rendered by a sequential background worker, backed up to Cloudflare R2). Styles are consumed by production tools (bulk lyric/quote video generation, caption overlays). Existing seeded templates in the DB/code: Brat, Spotify Lyrics Card, Animated Minimal Quote, News Lower Third, Breaking Headline, Subtitle Box, Quote/Statement Card. Fonts are self-hosted (Inter default, full 100–900 weights) and registered in Remotion compositions.

---

## PART 1 — Fix: no templates are visible in the tool (do this first)
**Symptom:** the Style Studio UI currently shows **no templates** — the operator cannot find any templates to start from, even though template records/compositions exist.

- Diagnose why the template list is empty: seeding never ran / API returns empty / frontend filter mismatch (e.g. family/key mismatch) / templates flagged inactive / query error. Log what the templates API actually returns.
- Fix the pipeline end-to-end: **seed → API → UI list**. Ensure the seed is idempotent (creates the 7 templates above if missing) and the UI lists every active template.
- Acceptance for this part: opening Style Studio shows all seeded templates immediately, each with name + family + thumbnail placeholder.

## PART 2 — Transparency invariant (fixes the black-background bug)
**Bug:** a rendered quote overlay had a solid black background covering the underlying video.

- **Hard rule: overlay templates are transparent by default.** Every template's `backgroundColor`-type param must support and default to `"transparent"/none`. Solid colors and strips are opt-in.
- The **preview must show transparency honestly** — render the preview over a checkerboard or, better, over a sample video (Part 4), never over an implicit solid.
- **Render path must preserve alpha:** overlays render to an alpha-capable format (VP9 WebM with alpha, or PNG stills for static cards) — never MP4 for an overlay. Add a post-render assertion that the output actually contains an alpha channel; fail loudly if not.
- Audit the existing 7 templates: any template intended as an overlay must not ship a solid default background. Fix the Quote/Statement Card default specifically.

## PART 3 — Floating live preview
- Make the live Remotion `<Player>` preview a **floating, draggable panel** that stays visible while the operator scrolls through settings (pinned picture-in-picture style; snap to corners; resizable small/medium/large; collapse to a thumbnail).
- The preview updates **instantly** on any param change (Player props, no render).
- Keep a "render test sample" button for an accurate short render via the existing worker/queue.

## PART 4 — Preview over a real video + canvas drag positioning
- **Real background in preview:** let the operator load a sample background video (upload or pick from recent clips) behind the overlay in the preview, so issues like "black box hides the video" are caught before any render. Default fallback: checkerboard.
- **Direct manipulation:** the operator can **drag the text/overlay block on the preview canvas** to set its position (updates the position params live), and resize via corner handles (updates size/width params). Sliders remain as fine-tune controls, synced two-way with the canvas.
- Snap guides: center lines + safe margins while dragging.

## PART 5 — Template gallery (CapCut-style premade library)
Replace the bare list with a **gallery**:
- Grid of template cards with **thumbnails and hover animated previews** (short looping preview of the animation).
- **Categories/filters:** family (Lyric/Caption, Quote), plus tags (minimal, bold, news, trend); search by name.
- One-click **"Use template"** → opens the editor with that template; **"Duplicate"** to fork.
- Saved styles appear in their own tab of the same gallery (operator's library), with thumbnails.

### 5a. Seed the premade library
- **Import from `reactvideoeditor/remotion-templates` (GitHub, MIT-licensed):** a collection of ~81 free, self-contained Remotion template components (text animations, transitions, etc.). Select and port the **text/caption/lyric-relevant** ones (target: at least 15–25 good ones) into our template format: wrap each as a template with a param schema (text, font, size, weight, colors, position, animation speed), register it, generate a thumbnail. Restyle defaults to fit our editorial aesthetic. Skip chart/logo/intro templates irrelevant to text overlays.
- **Keep the 7 existing templates** and ensure they meet the transparency invariant.
- **brat_lyrics_generator (https://github.com/DivyanshuLohani/brat_lyrics_generator) MUST be one of the styles:** the brat lyric style (lowercase condensed text, lo-fi blur/pixelation treatment, line-synced lyric display, configurable background color — transparent/solid/green as options, NOT hardcoded green). Port the *look and lyric-display mechanism* as a template in our stack (Remotion + our lyric data) — do **not** import the repo's Python/moviepy/FastAPI code.
- Every seeded template gets: name, family, tags, param schema, thumbnail, and passes the transparency invariant.

## PART 6 — Layers (what makes it a real tool, not a form)
- A style can have **multiple layers**: e.g. main lyric/quote text + attribution line + small image/logo + a shape/strip. 
- Each layer has its own params (content, font/weight, color, position, size, entry animation, delay) and its own canvas-drag positioning.
- Layer panel: add/remove/reorder (z-order), show/hide, duplicate layer.
- Keep it bounded: text, image, and shape/strip layer types only (no video layers, no timeline).
- Saved styles persist their full layer stack; the render composes all layers into one transparent overlay.

## PART 7 — Trend pipeline (stay-up-to-date mechanism)
- "**New template**" flow for admins: describe a trending style in text → an AI (existing Gemini integration) generates a new Remotion template component + param schema → it lands in a **Drafts** shelf in the gallery (clearly marked, not usable in production yet) → admin opens it, tweaks visually, fixes anything, then **Publish** moves it into the library.
- Drafts are validated: must compile, must pass the transparency invariant, must render a test sample successfully before Publish is enabled.

## PART 8 — Polish
- Clean, dense, premium UI (reference: Linear); no gradients/glassmorphism/glow/emoji chrome; real empty/loading/error states; keyboard-operable; reduced-motion respected.
- Editor layout: gallery → editor with floating preview + settings panel + layer panel; breadcrumb back to gallery.
- Permissions: base templates + Drafts publishing = admin; saved styles = editors.

---

## Data model (Prisma — extend)
- `StyleTemplate`: add `tags[]`, `thumbnail`, `source` (`builtin` | `imported` | `ai_draft`), `status` (`draft` | `published`), `layerSchema` support in paramSchema.
- `SavedStyle`: persist full layer stack in params JSON; thumbnail.
- Ensure the overlay cache hash includes the layer stack.

## Service functions (callable, permission-checked)
- `listTemplates(filter)`, `seedTemplates()` (idempotent), `importTemplate(def)`, `createDraftFromPrompt(description)`, `publishDraft(id)`, `renderTestSample(styleId)`, `saveStyle(...)`, `duplicateStyle(id)`, `renderThumbnail(templateId)`.

## Acceptance criteria
- [ ] Style Studio shows all templates on open (Part 1 fixed); seed is idempotent.
- [ ] Overlay templates default to transparent; alpha is asserted post-render; the quote-over-video case renders with the video visible underneath.
- [ ] The live preview floats, drags, snaps, resizes, and updates instantly; test render works.
- [ ] A sample background video can be loaded behind the preview; text can be positioned by dragging on the canvas with snap guides, synced with the param controls.
- [ ] The gallery shows categorized, searchable template cards with animated hover previews; Use/Duplicate work.
- [ ] ≥15 text-relevant templates imported from the MIT remotion-templates collection, restyled, transparent, thumbnailed.
- [ ] The **brat style exists as a template** (lyric mechanism + lo-fi look, background configurable incl. transparent — not hardcoded green).
- [ ] Layers: multi-layer styles (text/image/shape) with per-layer params, drag positioning, z-order; saved and rendered correctly as one transparent overlay.
- [ ] AI trend flow: describe → draft in gallery → visually tweak → publish gate (compile + transparency + test render).
- [ ] UI passes the premium/no-AI-look bar.

## Do not break
- Keep the existing render worker, overlay cache (include layers in the hash), R2 backup, and the production tools that consume saved styles.
- Existing saved styles must keep working (migrate to single-layer stacks).
- No timeline editor, no video layers — this stays a style creation tool.