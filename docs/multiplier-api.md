# Multiplier REST API

New-style API namespace for the Multiplier bulk-intake and days-based Smart Export
flows. The legacy routes under `/api/managed/multiplier/*` remain in place for the
existing UI.

## Auth

All endpoints require a valid session cookie and the `multiplier` tool permission.

- `401 { "error": "Unauthorized" }` — no/invalid session
- `403 { "error": "Forbidden" }` — missing `multiplier` permission

All error responses follow the shape `{ "error": string }`.

---

## Bulk intake

### `POST /api/multiplier/bulk-upload`

Upload many videos at once. Creates one `MultiplierGroup` per file (named after the
file, `mappingMode: "distribute"`), then transcribes and generates 15 hooks per group
in the background (sequential — one video at a time).

**Request:** `multipart/form-data`

| Field | Type | Notes |
|---|---|---|
| `files` | `File[]` | one or more video files (repeat the field) |
| `campaignId` | `string?` | applied to every created group + hook context |
| `styleId` | `string?` | caption style; defaults to `news-lower-third` |

**Response `200`:**

```ts
{ jobId: string; groupIds: string[] }
```

Errors: `400` no files uploaded.

### `GET /api/multiplier/batch-jobs/[id]`

Poll bulk-intake progress.

**Response `200`:**

```ts
{
  id: string;
  status: "PROCESSING" | "COMPLETED" | "FAILED"; // FAILED only if every item failed
  campaignId: string | null;
  styleId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  items: {
    id: string;
    fileName: string;
    status: "UPLOADING" | "TRANSCRIBING" | "GENERATING_HOOKS" | "READY" | "FAILED";
    groupId: string | null;
    error: string | null;
  }[];
}
```

Errors: `404` batch job not found.

---

## Groups

### `POST /api/multiplier/groups/[id]/transcribe`

Starts background Whisper transcription for the group's first variation.

**Response `200`:** `{ status: "TRANSCRIBING" }`

Errors: `404` group not found.

### `POST /api/multiplier/groups/[id]/generate-hooks`

Generates AI hooks via Gemini, replacing the group's hook list.

**Request:**

```ts
{ count?: number = 15; useCampaignContext?: boolean = true; customPrompt?: string }
```

**Response `200`:** `{ hooks: string[] }`

Errors: `400` group has no transcript; `404` group not found.

### `PATCH /api/multiplier/groups/[id]`

Update group metadata and visual settings.

**Request:**

```ts
{
  campaignId?: string | null;
  styleId?: string;          // captionStyleId is accepted as an alias
  captionStyleId?: string;
  hookPosition?: number | Record<string, unknown>; // number → settings.positionYPercent; object → merged into settings
  settings?: Record<string, unknown>;              // merged into existing settings JSON
}
```

**Response `200`:** the updated `MultiplierGroup` object.

Errors: `404` group not found.

### `PATCH /api/multiplier/groups/[id]/hooks`

Add / edit / delete / regenerate a single hook.

**Request:**

```ts
{
  action: "add" | "update" | "delete" | "regenerate";
  hookId?: string;  // required for update | delete | regenerate
  text?: string;    // required for add | update
  count?: number;   // reserved, currently unused
}
```

**Responses `200`:**

- add / update / regenerate: `{ hook: MultiplierHook }` (`regenerate` replaces the
  hook's text with a fresh Gemini generation, `source: "ai"`)
- delete: `{ success: true }`

Errors: `400` missing/invalid fields or (regenerate) no transcript; `404` group not found.

---

## Rendering

### `POST /api/multiplier/render`

Queue renders for multiple groups. Groups that fail validation are skipped with a
reason instead of failing the whole request.

**Request:** `{ groupIds: string[] }`

**Response `200`:**

```ts
{
  queued: string[];
  skipped: { groupId: string; reason: string }[];
}
```

Errors: `400` missing `groupIds`.

### `GET /api/multiplier/queue`

Groups currently `QUEUED`/`RENDERING`, plus groups that finished (`COMPLETED`/`FAILED`)
in the last 24 h.

**Response `200`:**

```ts
{
  groups: {
    id: string;
    name: string;
    status: string;
    errorMessage: string | null;
    updatedAt: string;
    outputCounts: { pending: number; rendering: number; completed: number; failed: number };
  }[];
}
```

---

## Smart Export (days-based)

### `POST /api/multiplier/smart-export/preview`

Compute a feasible distribution plan without starting the export. Each account's
`count` is its **per-day** allocation; it is multiplied by `days` server-side.
Existing constraints still apply: an account can't receive more videos than there are
groups with remaining completed outputs, and no group repeats within one account.

**Request:**

```ts
{
  groupIds: string[];
  accounts: { driveFolderId: string; name?: string; count: number }[]; // count = posts per day
  days?: number = 1;
  includeExported?: boolean;
}
```

**Response `200`:**

```ts
{
  days: number;
  videoBudget: { totalAvailable: number; assigned: number; videosLeft: number };
  assignments: { driveFolderId: string; driveFolderName: string; videoIds: string[] }[];
  unfulfillable: {
    driveFolderId: string;
    driveFolderName: string;
    requestedCount: number;
    assignedCount: number;
    reason: string;
  }[];
}
```

Errors: `400` missing `groupIds`/`accounts`.

### `POST /api/multiplier/smart-export/run`

Same request body as preview. Computes the plan server-side, drops unfulfillable
accounts, and starts a background `SmartExportJob` (with `days` recorded on the job).

**Response `200`:**

```ts
{
  jobId: string;
  budget: { totalAvailable: number; assigned: number; videosLeft: number };
  unfulfillable: { driveFolderId: string; driveFolderName: string; requestedCount: number; assignedCount: number; reason: string }[];
}
```

Errors: `400` missing fields, or nothing fulfillable (`{ error, budget, unfulfillable }`).

---

## Account search

### `GET /api/accounts/search?q=&mode=drive|account`

Search export destinations. `mode=drive` (default) searches Google Drive folders;
`mode=account` searches managed TikTok accounts that have a linked Drive folder.

**Response `200`:**

```ts
{
  results: {
    driveFolderId: string;
    driveFolderName: string;
    color: string | null;           // resolved account color (null in drive mode when unmapped)
    defaultPostCount: number;       // resolved per-day default from the color mapping
    account: { id: string; tiktokUsername: string } | null;
  }[];
}
```

Errors: `400` invalid `mode`.
