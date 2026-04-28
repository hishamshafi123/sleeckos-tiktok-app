# Reframe Prompt — UGC Campaign Marketplace with TikTok Direct Post

> **Read this entire prompt before touching code.** It supersedes the previous PRD I gave you. Where this prompt and the previous PRD agree, build it. Where they conflict, this prompt wins. The previous PRD's TikTok-compliance rules for the post composer (creator info, privacy dropdown behavior, interaction toggles, music usage confirmation text, no defaults, no watermarks) all still apply — they get *extended* here, not replaced.

---

## 1. What we're actually building

A **UGC creator marketplace** where verified brands post paid campaign briefs, vetted creators apply to participate, accepted creators film **original** content following the brief, and the platform manages the end-to-end flow including publishing to the creator's own TikTok account with proper Branded Content disclosure.

Think Aspire, GRIN, or TikTok's own Creator Marketplace — not Whop Clips, not Hootsuite, not a posting wrapper.

**What we are not building (and the prompt actively forbids):**
- ❌ No clipping. No source-footage redistribution. No reposting someone else's video. Every campaign deliverable is a creator-shot original.
- ❌ No CPM / pay-per-view payouts. Flat fee per approved post only.
- ❌ No multi-account management. One TikTok account per creator user.
- ❌ No scheduling. Publish happens when the creator clicks Confirm.
- ❌ No AI caption writing. The creator writes their own caption (the brand can suggest hashtags in the brief, the creator can use them or not).
- ❌ No bulk operations. One campaign at a time, one post at a time.
- ❌ No anonymous brand signups. Brands must be verified businesses (manual approval gate).
- ❌ No anonymous creator signups for paid campaigns. Creators go through an approval flow before they can apply to paid campaigns.

**Why this passes audit while the previous reframe didn't:** Every post on this platform is a transparent, properly-disclosed paid partnership. The creator is the author. The brand is identified. TikTok's Branded Content Policy is followed. The disclosure toggle is forced on. We're not gaming TikTok's system — we're building scaffolding around it that makes compliance easier than non-compliance.

---

## 2. The three user types

This is a three-sided platform. The PRD has to support all three.

### 2.1 Creator (the primary TikTok-API-using role)
Independent TikTok creators who want to monetize their content by working with brands. They:
- Sign up with email + connect their TikTok account
- Go through a verification flow (we capture follower count, niche, content samples)
- Browse open campaigns
- Apply to campaigns with a pitch
- If accepted: film an original video, upload a draft, iterate with the brand, publish via the platform's TikTok-compliant composer, get paid

### 2.2 Brand (the campaign-posting role)
Verified businesses who want UGC for their products. They:
- Sign up via a manual approval flow (we ask for company name, registration number, website, product category, contact email)
- Create campaigns: brief, deliverables, budget, deadline, target creator profile
- Review creator applications and accept/reject
- Approve draft videos
- See aggregate campaign performance after posts go live

### 2.3 Platform admin (your team)
You. The admin tools are unglamorous but **critical for audit defensibility**. They:
- Approve/reject brand signups manually
- Approve/reject creator signups for paid campaigns
- Suspend bad actors
- See all campaigns, all posts, all flagged content
- Have a kill switch for any campaign

---

## 3. Sitemap (every page)

```
─── PUBLIC ─────────────────────────────────────────────────
/                              Landing page (different content per audience)
/for-creators                  Creator-side marketing page
/for-brands                    Brand-side marketing page
/campaigns                     Public campaign discovery (browse without login)
/campaigns/[slug]              Public campaign detail page
/about                         About the company
/privacy                       Privacy Policy (real, with TikTok-specific clauses)
/terms                         Terms of Service
/branded-content-policy        How we enforce TikTok's Branded Content Policy
/contact                       Contact page (real email, real form)
/login                         Login (auto-detects role on success)
/signup                        Signup picker: "I'm a creator" / "I'm a brand"
/signup/creator                Creator signup flow
/signup/brand                  Brand signup flow (queues for manual approval)

─── CREATOR APP (authed) ──────────────────────────────────
/c/dashboard                   Creator home: applications, active campaigns, earnings
/c/onboarding                  Multi-step creator verification (only first time)
/c/connect-tiktok              Connect TikTok step in onboarding
/c/campaigns                   Campaign discovery (filtered to ones they qualify for)
/c/campaigns/[slug]            Campaign detail with "Apply" CTA
/c/applications                List of campaigns they've applied to
/c/applications/[id]           Application status + brand messages
/c/active/[id]                 Active campaign workspace (after acceptance)
/c/active/[id]/upload          Upload draft video for brand approval
/c/active/[id]/draft-review    Brand review status (pending/approved/needs changes)
/c/active/[id]/publish         The TikTok-compliant publish composer (the critical page)
/c/active/[id]/published       Post-publish status & metrics
/c/earnings                    Earnings overview + payout history
/c/earnings/payout-method      Add Stripe Connect / payout details
/c/profile                     Public creator profile (what brands see)
/c/settings                    Account settings, disconnect TikTok, delete account

─── BRAND APP (authed) ─────────────────────────────────────
/b/dashboard                   Brand home: active campaigns, applications, performance
/b/onboarding                  Brand verification (only first time, gated by admin)
/b/campaigns                   List of brand's campaigns
/b/campaigns/new               Create campaign (multi-step form)
/b/campaigns/[id]              Campaign management page
/b/campaigns/[id]/applicants   Review creator applications
/b/campaigns/[id]/active       Active deliverables (creators in production)
/b/campaigns/[id]/drafts/[did] Review a creator's draft video
/b/campaigns/[id]/published    Published posts + aggregate analytics
/b/billing                     Add payment method, see invoices
/b/settings                    Brand profile, team members, delete

─── ADMIN APP (authed, role-gated) ─────────────────────────
/admin                         Admin home: queue counts, recent activity
/admin/brands                  Brand approval queue + brand list
/admin/brands/[id]             Brand detail + approve/reject/suspend
/admin/creators                Creator approval queue + creator list
/admin/creators/[id]           Creator detail + approve/reject/suspend
/admin/campaigns               All campaigns + flag/kill controls
/admin/campaigns/[id]          Campaign detail + override controls
/admin/posts                   All published posts + takedown controls
/admin/disputes                Brand-creator disputes queue
/admin/audit-log               Immutable log of every API call, status change, payout

─── API ROUTES ─────────────────────────────────────────────
/api/auth/*                    Email + TikTok OAuth flows
/api/tiktok/creator-info       Server endpoint, calls TikTok creator_info/query
/api/tiktok/init-post          Server, calls /v2/post/publish/video/init/
/api/tiktok/upload-chunk       Server, streams chunks to TikTok upload_url
/api/tiktok/status             Server, polls publish/status/fetch
/api/tiktok/video-list         Server, calls /v2/video/list/ for view tracking
/api/tiktok/webhook            Receives TikTok webhooks (publish events)
/api/campaigns/*               Brand & admin campaign CRUD
/api/applications/*            Creator application CRUD
/api/drafts/*                  Draft video upload + review
/api/payouts/*                 Stripe Connect operations
/api/admin/*                   Admin actions, role-gated
```

---

## 4. The campaign data model

This is more complex than a simple publishing tool. Get the schema right up front.

```
users
  id (uuid pk)
  email (string, unique)
  password_hash
  role (enum: CREATOR | BRAND_OWNER | ADMIN)
  status (enum: PENDING | APPROVED | SUSPENDED)
  created_at

creator_profiles
  id (pk, fk → users)
  display_name (string)
  bio (text)
  niche_tags (string[])  // e.g. ["beauty", "lifestyle", "fitness"]
  follower_count_snapshot (int)  // captured at TikTok connect
  follower_count_updated_at
  approved_at (timestamp, null until approved by admin or auto-approved)
  approved_by (fk → users, nullable)
  rejection_reason (text, nullable)
  stripe_connect_account_id (string, nullable)

tiktok_accounts
  // unchanged from previous PRD: stores tokens for the connected creator account
  id, user_id, open_id, union_id, username, display_name, avatar_url,
  access_token (encrypted), refresh_token (encrypted), expires_at,
  scopes (string[]), connected_at, revoked_at

brands
  id (uuid pk)
  owner_user_id (fk → users)
  legal_name (string)
  trade_name (string)
  registration_number (string, optional but boosts trust)
  website (string, required)
  category (enum: BEAUTY | FASHION | FITNESS | FOOD | TECH | TRAVEL | LIFESTYLE | OTHER)
  contact_email (string)
  tiktok_handle (string, optional but required if they want creators to tag them in branded content)
  brand_logo_url (string)
  status (enum: PENDING | APPROVED | SUSPENDED)
  approved_at, approved_by, rejection_reason
  banned_categories_acknowledged (bool)  // they confirmed they're not in a banned vertical

campaigns
  id (uuid pk)
  brand_id (fk → brands)
  slug (string, unique)
  title (string)
  description (text)
  brief (text, longform requirements)
  deliverable_format (enum: VIDEO | PHOTO_CAROUSEL)  // start with VIDEO only
  deliverable_count (int)  // usually 1 video per accepted creator
  required_hashtags (string[])  // suggested, not enforced into caption
  required_mentions (string[])   // suggested
  payout_per_post_cents (int)
  currency (string, default "USD")
  total_budget_cents (int)
  max_creators (int)  // how many creators can be accepted
  application_deadline (timestamp)
  delivery_deadline (timestamp)  // when published post must be live by
  min_follower_count (int)
  niche_tags (string[])
  age_minimum (int, default 18)  // FTC compliance + branded content policy
  status (enum: DRAFT | PENDING_REVIEW | OPEN | CLOSED | COMPLETED | CANCELLED)
  approved_by_admin_at (timestamp, nullable)
  cover_image_url
  example_videos (url[], optional reference content from brand)
  created_at, updated_at

applications
  id (uuid pk)
  campaign_id (fk)
  creator_user_id (fk → users)
  pitch (text)  // creator's "why I'm right for this"
  status (enum: SUBMITTED | UNDER_REVIEW | ACCEPTED | REJECTED | WITHDRAWN)
  decision_at (timestamp)
  decided_by (fk → users)  // brand owner who decided
  decision_note (text, visible to creator)
  created_at

deliverables
  // created when an application is ACCEPTED
  id (uuid pk)
  application_id (fk, unique)
  campaign_id (fk)
  creator_user_id (fk)
  status (enum: BRIEFED | DRAFT_UPLOADED | DRAFT_APPROVED | DRAFT_NEEDS_CHANGES | 
                READY_TO_PUBLISH | PUBLISHED | PAYOUT_PENDING | PAID | CANCELLED)
  draft_video_url (string, on our storage)
  draft_caption (text)
  draft_revision_count (int)
  brand_feedback (text, nullable)
  publish_id (string, from TikTok)
  tiktok_video_id (string, from TikTok)
  tiktok_post_url (string)
  published_at (timestamp)
  payout_at (timestamp)
  payout_stripe_transfer_id (string)

post_metrics
  // populated by polling /v2/video/list/ + /v2/video/query/
  id (pk)
  deliverable_id (fk)
  view_count (bigint)
  like_count (bigint)
  comment_count (bigint)
  share_count (bigint)
  fetched_at (timestamp)
  // we keep historical snapshots, one row per fetch

audit_log
  id (pk)
  actor_user_id (fk, nullable for system events)
  action (string)  // e.g. "BRAND_APPROVED", "CAMPAIGN_PUBLISHED", "TIKTOK_API_CALL"
  resource_type (string)
  resource_id (uuid)
  metadata (jsonb)
  created_at
```

---

## 5. Forbidden brand categories

In your brand signup flow, **explicitly block** these categories per TikTok's Branded Content Policy. The brand signup form must require them to confirm they're not in any of these:

- Tobacco, vaping, e-cigarettes, nicotine products
- Alcohol (region-dependent — block by default for safety)
- Drugs, drug paraphernalia, CBD/cannabis (even where legal — TikTok bans branded content for these)
- Weapons, firearms, ammunition
- Gambling, sports betting, lotteries
- Financial services with high-risk products (crypto exchanges, forex, binary options, "get rich quick")
- Adult content, dating apps targeting hookups
- Weight loss supplements, "miracle cure" health products
- Political organizations, political campaigns
- Government services
- Pharmaceuticals (Rx and OTC alike for safety)

If a brand selects a category that's banned, show a polite rejection: *"Branded content campaigns for [category] aren't supported on this platform per TikTok's Branded Content Policy."* This is **excellent audit signal** — it shows we know the rules.

---

## 6. Critical pages — detailed specs

The previous PRD covered the post composer in depth. Here I'm specifying only the *new* pages that the campaign model introduces, and the *changes* to the composer.

### 6.1 Public campaigns page (`/campaigns`)

**Goal:** Make it look like a real, active marketplace. Reviewers will visit this URL.

- Grid of campaign cards. Each card: brand logo, brand name, campaign title, payout amount, niche tags, deadline countdown, "X spots left" badge
- Filter sidebar: niche, payout range, deliverable type, deadline window
- Sort: newest, payout high-to-low, deadline soonest
- For unauthenticated visitors: clicking a card shows the campaign detail page with "Sign up as a creator to apply"
- Empty-state behavior is critical for early launch — when you have no real campaigns, do NOT show "No campaigns yet". Seed the page with 6-10 example campaigns marked clearly as "Demo campaign — we're onboarding our first brands". Better: have at least one or two real campaigns by audit time.

### 6.2 Campaign detail page (`/campaigns/[slug]` and `/c/campaigns/[slug]`)

The single most important page brands and reviewers will look at. Layout:

**Header:**
- Brand logo + brand name (clickable to brand profile)
- Campaign title
- Status pill: OPEN / CLOSING SOON / FULL
- Payout amount + currency, prominently
- Apply button (disabled if creator hasn't been approved yet, or if campaign is full)

**Brief section:**
- Description (~200 words from brand)
- Detailed brief / requirements (the longform section)
- Required hashtags (suggested, with a tooltip *"You can use these in your caption"*)
- Required mentions (suggested)
- Reference videos (if brand provided any) — embedded TikTok previews

**Deliverable section:**
- Format: Video / Photo Carousel
- Length requirements: e.g. 15-60 seconds
- Aspect ratio: 9:16 vertical
- Required disclosure: **"Your post will be published as 'Paid partnership' with TikTok's Branded Content disclosure enabled. This is required for all campaigns on this platform."**
- Deadlines: application closes / final post must go live by

**Eligibility section:**
- Minimum follower count
- Niche tags
- Other requirements

**The brand box:**
- Brand description, website link, contact policy
- "About the brand" preview

**Important footer note (compliance signal):**
> *"All campaign posts on [Platform] are published with TikTok's Branded Content disclosure as 'Paid partnership' in compliance with TikTok's Branded Content Policy and applicable advertising regulations including the FTC Endorsement Guides. Creators retain full creative control and ownership of their original content."*

### 6.3 Creator onboarding flow (`/c/onboarding`)

Multi-step. **Don't let creators apply to paid campaigns until this is complete.**

1. **Welcome step** — explain how the platform works, how disclosure works, set expectations
2. **Profile step** — display name, bio, niche tags (multi-select), age confirmation (18+)
3. **Connect TikTok step** — OAuth flow, capture follower count + verify account isn't private
4. **Content samples step** — paste 3 TikTok URLs of their past work (we use Display API to verify these are theirs)
5. **Disclosure acknowledgement step** — they read and agree to:
   - *"I understand that any campaign post I publish through this platform is paid commercial content."*
   - *"I will publish all campaign posts with TikTok's Branded Content disclosure enabled."*
   - *"I will not falsify, hide, or remove the Branded Content / Paid Partnership label from any campaign post."*
   - *"I am at least 18 years old."*
   - *"I am the authentic owner and operator of the connected TikTok account."*
6. **Payout step** — Stripe Connect setup (can defer until after first acceptance)
7. **Pending review** — for early launch, all creators are auto-approved if they meet thresholds; later you can flip to manual review

### 6.4 Brand onboarding flow (`/b/onboarding`)

**Always manually reviewed by admin.** No exceptions in v1.

1. **Company info** — legal name, trade name, registration number (optional), website, country
2. **Category** — picks from the allowed list; banned categories show the rejection message immediately
3. **Verification** — upload a doc proving company existence (registration cert, tax doc, or in lieu, a link to an established website + LinkedIn)
4. **TikTok handle** — required if they want to be tagged in branded content posts (highly recommended)
5. **Branded Content Policy acknowledgement** — they confirm they've read TikTok's Branded Content Policy and will only run campaigns for products that comply
6. **Pending admin approval** — they wait. Admin gets a notification and reviews in `/admin/brands`.

### 6.5 Brand campaign creation (`/b/campaigns/new`)

Multi-step form:

1. **Basics** — title, cover image, niche tags
2. **Brief** — description, longform requirements, do/don't list
3. **Deliverable** — video format, length range, suggested hashtags, suggested mentions, **toggle: "I want creators to tag our brand in their TikTok Branded Content disclosure"** (defaults ON if brand has set TikTok handle)
4. **Targeting** — min followers, niche match, geographic preference
5. **Budget** — payout per post, max creators, total = payout × max
6. **Timeline** — application deadline, delivery deadline
7. **Review & submit** — campaign goes to PENDING_REVIEW; admin approves before it appears publicly

**Crucial copy on the deliverable step:**
> *"All deliverables on this platform are published with TikTok's Branded Content disclosure enabled and labeled as 'Paid partnership'. This is automatic and cannot be disabled. Make sure your campaign brief is appropriate for transparent paid content under TikTok's Branded Content Policy."*

### 6.6 Creator's active campaign workspace (`/c/active/[id]`)

After acceptance. This is the production hub. Tabs/sections:

- **Brief** — full campaign details (read-only)
- **Messages** — chat thread with the brand for clarifications
- **Upload draft** — drag/drop interface for the creator's filmed video
- **Draft review** — once uploaded, brand reviews; status shows pending/approved/needs changes with brand's feedback
- **Publish** — only enabled when status is DRAFT_APPROVED. Routes to the composer.
- **Published** — shows after publish completes; metrics, payout status

### 6.7 The publish composer (`/c/active/[id]/publish`) — modified from previous PRD

This is where the previous PRD's composer rules carry forward, with **specific overrides for campaign mode:**

**Same as before:**
- Account header with creator avatar, nickname, username (from creator_info)
- Caption textarea, editable, with hashtag/mention highlighting
- Cover frame picker
- Allow Comments / Duet / Stitch toggles, all defaulting OFF
- Music Usage Confirmation text
- Confirmation modal before API call
- No defaults on user-controlled fields
- No watermarks, no auto-appended branding text

**Different in campaign mode:**

**A. Privacy dropdown:**
- `SELF_ONLY` is **disabled** with helper text: *"Branded content posts cannot be private."* (This is a hard TikTok API rule — the API rejects branded posts with SELF_ONLY.)
- The remaining options (`PUBLIC_TO_EVERYONE`, `MUTUAL_FOLLOW_FRIENDS`, `FOLLOWER_OF_CREATOR`) come from `creator_info.privacy_level_options` and any of those that aren't returned for the creator are also disabled.
- Still no default. Creator picks.
- Note: while unaudited, the API will only let SELF_ONLY through. The composer should still render correctly; on submit during the audit demo phase, surface a clean error: *"This account is in pre-audit mode and posts can only be private. Public posting will be available after our TikTok review is approved."*

**B. Disclosure section is FORCED ON:**
- The "Disclose commercial content" toggle is **on, locked, and greyed out**
- Helper text: *"All campaign posts are paid commercial content. Disclosure is required."*
- The "Branded content" checkbox is **checked, locked, and greyed out**
- Helper text under it: *"Your video will be labeled 'Paid partnership' to comply with TikTok's Branded Content Policy."*
- "Your brand" checkbox is hidden (not applicable — creator isn't promoting their own business; they're promoting the campaign brand)
- Brand partner field: **pre-filled and locked** with the brand's TikTok handle (from `campaigns.brand.tiktok_handle`). If the brand didn't set a TikTok handle, show a banner: *"This brand hasn't connected a TikTok account. The post will still be labeled 'Paid partnership' but won't be tagged."*

**C. Required disclaimer text above the publish button (exact wording per TikTok guidelines):**
> *"By posting, you agree to TikTok's Branded Content Policy and Music Usage Confirmation."*

Both should be hyperlinks to TikTok's official policy pages.

**D. Caption pre-fill behavior:**
- The caption can be pre-populated with the brand's suggested hashtags as a starting point
- The creator can **edit anything** including removing the hashtags (TikTok requires this — hashtags must be editable)
- Below the caption, show a soft warning if required hashtags are missing: *"This campaign suggests including #brandname and #ad — your post may not meet brand approval without them."* But never block submission.

**E. Final API call body:**

```json
{
  "post_info": {
    "title": "[creator's caption]",
    "privacy_level": "[user's chosen value]",
    "disable_duet": [from toggle],
    "disable_comment": [from toggle],
    "disable_stitch": [from toggle],
    "video_cover_timestamp_ms": [from picker],
    "brand_content_toggle": true,
    "brand_organic_toggle": false,
    "brand_partner_handle": "[brand.tiktok_handle if present]"
  },
  "source_info": {
    "source": "FILE_UPLOAD",
    "video_size": ...,
    "chunk_size": ...,
    "total_chunk_count": ...
  }
}
```

`brand_content_toggle: true` is the API-level flag that produces the "Paid partnership" label on TikTok. This is the audit-critical line.

### 6.8 Post-publish & metrics (`/c/active/[id]/published`)

- Embedded TikTok player (use the `embed_link` from `/v2/video/query/`)
- Metrics card showing views, likes, comments, shares (refreshed every 1-6 hours via `/v2/video/list/`)
- Payout status: PENDING (waiting 48h grace period) → PROCESSING → PAID
- Link to the live TikTok post
- Disclosure verification badge: *"✓ Posted with Paid partnership disclosure"*

### 6.9 Admin queues

Don't skimp on admin. The audit case is built on showing TikTok we have human review.

**`/admin/brands`** — list of pending brand approvals with: company info, website screenshot, category, registration doc, action buttons (approve / reject with reason / suspend / message). Sort by submitted date.

**`/admin/creators`** — same pattern. Show TikTok profile preview pulled via Display API, follower count, content sample previews.

**`/admin/campaigns`** — every campaign awaiting review. Admin can: approve, reject with reason, kill an active campaign, flag for further review.

**`/admin/posts`** — every published post on the platform. Each row: thumbnail, caption preview, brand, creator, status, link. Admin can issue takedown request to the creator (we don't have API to delete creator posts, but we can revoke the deliverable's payout and mark as violating).

**`/admin/audit-log`** — immutable record of every TikTok API call we make, every status change, every payout. **Show this in the audit demo.**

---

## 7. TikTok scopes — what to request

OAuth at `/c/connect-tiktok` requests **all of these in a single consent**:

```
scope=user.info.basic,video.publish,video.list
```

- `user.info.basic` — required, used for displaying the creator's identity throughout the app
- `video.publish` — required, the Direct Post API
- `video.list` — required for view tracking on campaign posts

**Don't request `video.upload`** unless you also implement the inbox/draft flow (you're not, in v1).

When justifying scopes in the audit application:

- `user.info.basic` → *"Display the connected creator's TikTok identity throughout their dashboard so they always know which account is connected."*
- `video.publish` → *"Publish campaign deliverables to the creator's TikTok account with TikTok's Branded Content disclosure enabled (`brand_content_toggle: true`), in compliance with TikTok's Branded Content Policy."*
- `video.list` → *"Track view, like, comment, and share counts on the creator's campaign posts so brands can measure deliverable performance and creators can see how their content is performing. We do not access videos that aren't part of an active campaign on our platform."*

---

## 8. Description for TikTok Developer Portal

Use this verbatim. Replace `[Platform]` with your actual platform name (don't use "TikTok" in the name).

> **[Platform]** is a UGC creator marketplace that connects verified brands with vetted independent TikTok creators for paid branded content campaigns.
>
> **How it works:** Verified brands post campaign briefs detailing the product, content requirements, and a flat fee per approved post. Vetted creators browse open campaigns and apply with a pitch. Brands review applications and accept creators who match the brief. Accepted creators film **original** video content following the brief, upload a draft for brand approval, then publish the approved video to their own TikTok account through our TikTok-compliant publishing flow.
>
> **TikTok integration:** Every campaign post is published via the Content Posting API's Direct Post endpoint with `brand_content_toggle` set to true, automatically applying TikTok's "Paid partnership" label in compliance with TikTok's Branded Content Policy and the FTC's Endorsement Guides. The Branded Content disclosure cannot be disabled by either the creator or the brand on our platform — it is enforced for every post. We tag the brand partner via the brand's connected TikTok handle when available. We use the Display API (`video.list`) to fetch view, like, comment, and share counts on campaign posts so creators and brands can measure performance.
>
> **Vetting and compliance:**
> - Brands undergo manual admin review before any campaign goes live. We block restricted categories per TikTok's Branded Content Policy (tobacco, alcohol, gambling, adult content, financial high-risk, weight-loss supplements, pharmaceuticals, weapons, political organizations, etc.).
> - Creators undergo verification including TikTok account ownership confirmation, age verification (18+), and content sample review.
> - Every published post on the platform is paid branded content with proper disclosure. We do not support undisclosed paid posts.
> - We do not support content reposting, clipping, or redistribution of source footage. Creators always produce original content.
> - We do not support multi-account management, scheduling, or AI-generated captions. Each creator connects one TikTok account, writes their own caption, and explicitly clicks "Confirm" before each post is published.
>
> **Volume estimate at launch:** ~50 active creators completing ~3 deliverables per month each, or roughly 150 posts per month across the platform. Scaling target over 12 months: ~500 active creators.

---

## 9. Updated audit demo video (~3.5 minutes)

The previous PRD's video script is replaced. New shot list:

**0:00–0:20 — Public landing & marketplace**
- Show homepage with positioning ("UGC creator marketplace for branded content")
- Click "Browse campaigns" — show `/campaigns` with multiple seeded campaigns
- Click into a campaign detail page — show brief, payout, branded-content disclosure notice

**0:20–0:40 — Creator signup & onboarding**
- Sign up as a creator, breeze through profile / niche / age confirmation
- Show the disclosure acknowledgement step (key compliance signal)
- Click Connect TikTok → OAuth consent screen showing **all three scopes** requested → callback
- Land on creator dashboard with TikTok account connected

**0:40–1:00 — Apply to a campaign**
- Open `/c/campaigns`, pick a campaign
- Show the disclosure footer copy ("Posted as 'Paid partnership'")
- Click Apply, write a short pitch, submit
- Show "Application submitted" state

**1:00–1:15 — Brand-side approval (you can switch sessions)**
- Switch to a brand account, open the campaign's applicants list
- Click the new application, review the creator's profile and pitch
- Click Accept → creator gets a notification, deliverable is created

**1:15–1:35 — Draft upload and approval**
- Back to creator: open the active campaign workspace
- Upload a draft video
- Switch to brand, review draft, click Approve
- Switch back to creator: status now READY_TO_PUBLISH

**1:35–2:45 — The publish composer (the most important segment)**
- Open the publish page, show creator_info loading
- Show the locked-on disclosure section ("Branded content" checked and greyed)
- Show the brand partner pre-filled with the brand's TikTok handle
- Show the SELF_ONLY option being disabled with the helper text
- Pick a privacy option, customize interaction toggles, pick cover frame
- Show the "By posting, you agree to TikTok's Branded Content Policy and Music Usage Confirmation" line
- Click Post to TikTok → confirmation modal → Confirm

**2:45–3:10 — Status & verification**
- Show the polling status page hitting PUBLISH_COMPLETE
- Open the published view: embedded TikTok player, metrics from `/v2/video/list/`
- Point to the disclosure verification badge

**3:10–3:30 — Admin tooling (compliance signal)**
- Open `/admin` quickly
- Show the brand approval queue and creator approval queue (proves human review)
- Show `/admin/audit-log` scrolling through API calls (proves accountability)

**3:30–end — Settings & disconnect**
- Show creator settings, the Disconnect TikTok button, briefly demonstrate it's wired up

Keep cursor movements deliberate. Voiceover or captions throughout. Domain visible in URL bar. Same brand and creator accounts used end-to-end.

---

## 10. Build order

Don't try to build all of this at once. Order matters because some things gate others.

1. **Auth, roles, and the public marketing pages** — get the website looking real before anything else
2. **Brand onboarding + admin approval queue** — so you have one approved brand
3. **Campaign creation + admin approval** — so you have one live campaign
4. **Creator onboarding + TikTok OAuth (all three scopes)** — get a creator connected
5. **Campaign discovery + application flow** — creator applies, brand accepts
6. **Draft upload + brand review** — full draft cycle works
7. **The TikTok publish composer with all the campaign-mode rules** — the audit-critical surface
8. **Status polling, webhooks, post-publish view** — close the loop
9. **Display API view tracking** — the metrics layer
10. **Stripe Connect payouts** — last because audit doesn't depend on it (you can mock the payout state for the demo)
11. **Admin tooling polish** — audit log especially
12. **Demo video, then submit**

---

## 11. Anti-rejection guardrails (read this last)

These are the things that would otherwise sneak in and tank the audit:

1. **Don't add "Posted via [Platform]" to captions, ever.** The brand's own hashtag is fine because the creator chose it; appending your platform name is a watermark.
2. **Don't auto-fill the entire caption.** Only suggest hashtags. The caption body must be the creator's words.
3. **Don't skip the manual approval gates.** Auto-approving brands defeats the audit story. Even if it slows you down at first, manual approval is what TikTok wants to see.
4. **Don't expose raw multi-creator orchestration.** No "post this same draft to 5 creators' accounts" feature. One deliverable = one creator = one post.
5. **Don't show analytics for posts that aren't on your platform.** Display API gives you all the creator's videos; only display metrics for posts that are tied to a deliverable on your platform. This is a privacy + audit signal.
6. **Don't schedule posts.** Even though it's tempting, even though brands will ask. The post happens when the creator clicks Confirm in the moment.
7. **Don't let SELF_ONLY through for branded content.** Hard-block at the UI level and again at the API call level.
8. **Don't ship an empty marketplace.** Seed real-looking demo campaigns before audit. Better, run a soft launch and have 1-3 real brands and 5-10 real creators by audit submission time.
9. **Don't skip the audit log.** Reviewers want to see you can produce a record of what happened on the platform.
10. **Don't request scopes you won't demo.** If you ask for `video.upload` "just in case", you'll be rejected. Match scopes to features 1:1.

---

**End of reframe prompt.** Paste this entire document into your vibe-coding tool. When the tool asks "should I add a scheduling feature / AI captions / multi-account support / clipping mode" — the answer is always no.