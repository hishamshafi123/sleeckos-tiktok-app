# SleeckOS Campaign Analytics — Client API

Read-only HTTP API for pulling campaign performance data (post links, views,
likes, comments, shares) into an external platform.

## Quick answers

- **API base URL:** `https://sleeckos.com`
- **Auth:** header **`x-api-key: <API_KEY>`** — one key per client, valid for every campaign we grant you (we send it to you once)
- **Method:** a simple **HTTP GET is sufficient** — no POST, no signing, no SDK
- **Timing:** stats refresh **once per day** (see "Data freshness" below). A **once-per-day pull is ideal** — polling more often returns the same numbers.
- **Rate limit:** 30 requests/minute per IP (429 if exceeded).

## Authentication

Every request needs two things:

1. The **campaign ID** in the URL path (a UUID like `85c0b48f-dee4-4de8-8eaa-94b65acb4961`).
   **Where to find it:** on your tracking page, or ask us — internally it is on
   the campaign page under **Client access → "Copy campaign ID"**. It is NOT
   the 10-character share code and NOT the tracking-page URL slug.
2. The **API key** in the `x-api-key` header.

**Common gotcha:** the `x-api-key` header is required on every call. Pasting
the endpoint URL into a browser address bar (which can't set headers) returns
404 — test with curl, code, or a REST client instead. Browser-based platforms
(fetch/XHR from a web page) are supported — the API sends permissive CORS
headers and answers OPTIONS preflights.

You receive **one API key from us that works for every campaign we run for
you** — when a new campaign starts, we grant your key access to it and send
you the new campaign ID; you only change the ID in the URL, never the key.
Keys can be revoked or re-scoped on our side — if your key stops working, ask
us for a fresh one.

(Legacy note: single-campaign share codes — 10-character codes like
`F88FM8L255` — also work as API keys for their own campaign.)

Example:

```bash
curl "https://sleeckos.com/api/public/v1/campaigns/CAMPAIGN_ID/stats" \
  -H "x-api-key: YOUR_API_KEY"
```

## Endpoints

### 1. Campaign summary + trend

```
GET /api/public/v1/campaigns/{campaignId}/stats
```

Sample response:

```json
{
  "campaign": { "id": "6f9c2c1e-…", "title": "Distill Campaign" },
  "timezone": "Asia/Kolkata",
  "dataUpdatedAt": "2026-08-13T03:41:00.000Z",
  "refreshCadence": "daily",
  "totals": {
    "postsPublished": 412,
    "postsScheduled": 36,
    "linksCaptured": 405,
    "totalViews": 1842301,
    "totalLikes": 96214,
    "totalComments": 4102,
    "totalShares": 12877,
    "avgViewsPerPost": 4550
  },
  "trend": [
    { "date": "2026-07-15", "views": 120340, "likes": 6211 },
    { "date": "2026-07-16", "views": 131008, "likes": 6804 }
  ]
}
```

Field notes:

- `postsPublished` — videos confirmed posted to TikTok.
- `postsScheduled` — videos delivered to accounts but not yet posted.
- `linksCaptured` — posts whose live TikTok URL + stats we track.
- `avgViewsPerPost` — `totalViews / linksCaptured`, rounded.
- `trend` — cumulative views/likes per day for the last 30 days; dates are in the `timezone` above (IST).
- `dataUpdatedAt` — when the stats were last refreshed (UTC ISO). Compare against it to skip redundant processing.

### 2. Post list (links + stats)

```
GET /api/public/v1/campaigns/{campaignId}/posts
GET /api/public/v1/campaigns/{campaignId}/posts?from=2026-09-01&to=2026-09-05
```

Optional query params `from` / `to` (both `YYYY-MM-DD`, inclusive, interpreted
as days in the campaign timezone — IST) restrict the list to posts published
in that date range. Either may be used alone (`?from=` only = everything since
that day). The echoed `filter` field in the response confirms what was applied.
A malformed range returns `400`.

Sample response:

```json
{
  "campaign": { "id": "6f9c2c1e-…", "title": "Distill Campaign" },
  "dataUpdatedAt": "2026-08-13T03:41:00.000Z",
  "filter": { "from": "2026-09-01", "to": "2026-09-05", "timezone": "Asia/Kolkata" },
  "count": 405,
  "posts": [
    {
      "url": "https://www.tiktok.com/@accountname/video/7672816141965806870",
      "publishedAt": "2026-08-12T14:03:11.000Z",
      "views": 15230,
      "likes": 891,
      "comments": 42,
      "shares": 130
    }
  ]
}
```

Tracked posts, newest first. `publishedAt` is UTC ISO. Without `from`/`to`
this is the full list each time (no pagination) — pull it once a day and diff
on `url`, or pass `?from=<yesterday>` to fetch only recent posts.

## Data freshness

Stats are refreshed by a daily pipeline (finishes ~09:30 IST). **Recommended
pull time: once per day, after 10:00 IST.** `dataUpdatedAt` tells you exactly
how fresh the numbers are.

## Errors

| Status | Meaning |
|---|---|
| 200 | OK |
| 404 | Unknown campaign ID, or invalid/revoked/expired key (same response either way, by design) |
| 429 | Rate limit hit — wait a minute and retry |
| 500 | Something broke on our side — retry later |

## Versioning

This is `v1`. New fields may be added to responses (clients should ignore
unknown fields); existing fields will not be removed or renamed without a new
version path.
