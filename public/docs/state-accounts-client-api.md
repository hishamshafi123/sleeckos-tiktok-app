# SleeckOS State Accounts — Client API (v1)

Read-only HTTP API for pulling live TikTok state account performance data
(portfolio totals, per-state account metrics, daily views/likes/follower trends,
and tracked post links) into your own platform, BI tool, or dashboard.

## Quick answers

- **Base URL:** `https://sleeckos.com`
- **Auth:** header **`x-api-key: <API_KEY>`**
  - Accepts either a **Client API key** (`slk_…`) granted State Accounts access, or a **Client Portal share code** (10-character code).
- **Method:** plain **HTTP GET** — no signing, no SDK, browser CORS supported (`OPTIONS` preflights enabled).
- **Timing:** state accounts sync **hourly** (`refreshCadence: "hourly"`). Check `dataUpdatedAt` to skip unchanged snapshots.
- **Rate limit:** 60 requests/minute per IP (`429` if exceeded).

## Authentication

Pass your API key in the `x-api-key` header on every request:

```bash
curl "https://sleeckos.com/api/public/v1/state-accounts" \
  -H "x-api-key: YOUR_API_KEY"
```

Keys are scoped to either **all active state accounts** or a specific list of
authorized states. Requests with an invalid/revoked key, or requesting a state
outside your granted scope, return `404` (uniform response, no oracle).

---

## Endpoints

### 1. Portfolio summary & all authorized state accounts

```
GET /api/public/v1/state-accounts
GET /api/public/v1/state-accounts?days=14
GET /api/public/v1/state-accounts?from=2026-11-01&to=2026-11-21
```

Query parameters (optional):
- `days` — integer `1`–`90` (default `30`). Controls the reporting window for `daily` and `period*` totals.
- `from` / `to` — inclusive `YYYY-MM-DD` dates in the reporting `timezone` (overrides `days`).

Sample response:

```json
{
  "scope": {
    "title": "US State Network",
    "allStates": true,
    "accountCount": 10
  },
  "timezone": "Asia/Kolkata",
  "dataUpdatedAt": "2026-11-21T19:00:00.000Z",
  "refreshCadence": "hourly",
  "range": {
    "days": 30,
    "from": "2026-10-23",
    "to": "2026-11-21"
  },
  "totals": {
    "activeAccounts": 10,
    "followers": 148200,
    "profileLikes": 892400,
    "trackedVideos": 420,
    "totalVideoViews": 12450800,
    "totalVideoLikes": 640120,
    "avgViewsPerVideo": 29645,
    "engagementRate": 5.14,
    "periodViewsGained": 3420100,
    "periodLikesGained": 175400,
    "periodFollowerGrowth": 18400,
    "periodPosts": 215,
    "todayViewsGained": 112400,
    "todayLikesGained": 5920,
    "todayPosts": 28,
    "weekOverWeekViewsPct": 14.2
  },
  "daily": [
    {
      "date": "2026-11-20",
      "viewsGained": 145200,
      "likesGained": 7410,
      "followerGrowth": 820,
      "posts": 30,
      "metricsObserved": true,
      "followersObserved": true
    }
  ],
  "accounts": [
    {
      "id": "85c0b48f-dee4-4de8-8eaa-94b65acb4961",
      "slug": "georgia",
      "stateName": "Georgia",
      "stateCode": "GA",
      "username": "georgiadaily",
      "displayName": "Georgia Daily",
      "profileUrl": "https://www.tiktok.com/@georgiadaily",
      "followers": 24500,
      "profileLikes": 182300,
      "trackedVideos": 52,
      "totalVideoViews": 2410000,
      "totalVideoLikes": 134200,
      "avgViewsPerVideo": 46346,
      "engagementRate": 5.57,
      "periodViewsGained": 620400,
      "periodLikesGained": 31200,
      "periodFollowerGrowth": 3200,
      "periodPosts": 24,
      "todayViewsGained": 18500,
      "todayLikesGained": 940,
      "todayPosts": 3,
      "weekOverWeekViewsPct": 18.4,
      "lastSyncAt": "2026-11-21T19:00:00.000Z"
    }
  ]
}
```

---

### 2. Single state account detail

```
GET /api/public/v1/state-accounts/{stateOrId}
GET /api/public/v1/state-accounts/georgia?days=30
GET /api/public/v1/state-accounts/GA?from=2026-11-01&to=2026-11-21
```

`{stateOrId}` accepts any of:
- State slug (`georgia`, `south-carolina`, `new-hampshire`)
- 2-letter state code (`GA`, `SC`, `NH`, case-insensitive)
- Full state name (`Georgia`)
- Account UUID (`account.id`)

Returns the account summary, its daily time series (`daily`), `topVideos` (top 10 by views), and `recentVideos` (latest 20 by publish time).

---

### 3. Tracked videos / posts (all authorized states or one state)

```
GET /api/public/v1/state-accounts/posts
GET /api/public/v1/state-accounts/posts?state=georgia&sort=views&limit=50
GET /api/public/v1/state-accounts/georgia/posts?from=2026-11-01&to=2026-11-21
```

Query parameters (optional):
- `state` — filter to one state (slug, 2-letter code, name, or account ID). Available on `/posts`; implicit on `/{stateOrId}/posts`.
- `from` / `to` — inclusive `YYYY-MM-DD` publish dates in the reporting `timezone`.
- `sort` — `publishedAt` (default), `views`, or `likes` (descending).
- `limit` — integer `1`–`500` (default `100`).
- `offset` — integer `>= 0` (default `0`).

Sample response:

```json
{
  "scope": { "title": "US State Network", "allStates": true },
  "timezone": "Asia/Kolkata",
  "dataUpdatedAt": "2026-11-21T19:00:00.000Z",
  "filter": {
    "state": { "id": "85c0b48f-…", "slug": "georgia", "stateName": "Georgia", "stateCode": "GA" },
    "from": "2026-11-01",
    "to": "2026-11-21",
    "sort": "views"
  },
  "total": 52,
  "limit": 50,
  "offset": 0,
  "count": 50,
  "posts": [
    {
      "videoId": "7672816141965806870",
      "accountId": "85c0b48f-…",
      "stateName": "Georgia",
      "stateCode": "GA",
      "stateSlug": "georgia",
      "username": "georgiadaily",
      "url": "https://www.tiktok.com/@georgiadaily/video/7672816141965806870",
      "publishedAt": "2026-11-18T14:22:10.000Z",
      "views": 184200,
      "likes": 11420,
      "engagementRate": 6.2,
      "lastObservedAt": "2026-11-21T19:00:00.000Z"
    }
  ]
}
```

## Notes on account continuity

If a state's TikTok account is replaced, SleeckOS automatically links the new
active account to its predecessor so daily view trends and historical video
results remain continuous for that state.

## Errors

| Status | Meaning |
|---|---|
| `200` | OK |
| `400` | Invalid query parameter (`days`, `from`/`to`, `sort`, `limit`, `offset`) |
| `404` | Invalid/revoked/expired API key, or requested state is outside your granted scope |
| `429` | Rate limit exceeded — wait a minute and retry |
| `500` | Temporary server error — retry later |
