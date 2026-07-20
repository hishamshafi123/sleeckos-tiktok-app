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

Upload videos for bulk intake. Creates one `MultiplierGroup` per file (named after the
file, `mappingMode: "distribute"`). Processing (transcribe → 15 hooks per group,
sequential — one video at a time) starts when the batch is **finalized**.

Files may be sent across multiple requests (recommended: one file per request —
a single multi-file body can exceed proxy body-size limits such as nginx
`client_max_body_size`, producing a `413`). First request creates the batch;
later requests append to it via `jobId`; the last request sets `finalize`.

**Request:** `multipart/form-data`

| Field | Type | Notes |
|---|---|---|
| `files` | `File[]` | video file(s) (repeat the field); may be omitted on a finalize-only request |
| `campaignId` | `string?` | applied to every created group + hook context (first request only) |
| `styleId` | `string?` | caption style; defaults to `news-lower-third` (first request only) |
| `jobId` | `string?` | append to an existing batch instead of creating one |
| `namePrefix` | `string?` | group naming sequence — groups become `"PREFIX 01", "PREFIX 02", …` in arrival order (first request only; omit to name groups after their files) |
| `finalize` | `"true"?` | start background processing; send on the last request (or alone with just `jobId`) |

**Response `200`:**

```ts
{ jobId: string; groupIds: string[] }
```

Errors: `400` no files uploaded (and not a finalize-only request); `400` finalize without `jobId`; `500` batch not found / already processing.

### `GET /api/multiplier/batch-jobs/[id]`

Poll bulk-intake progress.

**Response `200`:**

```ts
{
  id: string;
  status: "RECEIVING" | "PROCESSING" | "COMPLETED" | "FAILED"; // RECEIVING until finalized; FAILED only if every item failed
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

### `POST /api/multiplier/groups/bulk-delete`

Delete or clear multiple groups at once.

**Request:** `{ groupIds: string[]; mode: "outputs" | "full" }`

- `outputs` — delete only the rendered videos (local files + DB rows); the groups
  themselves (source videos, hooks, style) stay in the builder, reset to `DRAFT`.
- `full` — delete the groups entirely (variation files, output files, hooks, DB rows).

**Responses `200`:** `{ success: true, mode, clearedGroups?, deletedOutputs?, deletedGroups? }`

Errors: `400` missing `groupIds` or invalid `mode`.

---

## Rendering

### `POST /api/multiplier/render`

Queue renders for multiple groups. Groups that fail validation are skipped with a
reason instead of failing the whole request. Rendering is **resume-safe** by default:
completed outputs (and their export records) are kept and only missing/failed
compositions are re-created. Pass `fresh: true` to wipe a group's outputs and
re-render everything.

**Request:** `{ groupIds: string[]; fresh?: boolean }`

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
  state: {
    paused: boolean;        // render worker paused by operator
    processing: boolean;    // worker loop currently running
    staleRendering: number; // outputs stuck in RENDERING >2 min (e.g. after a restart)
  };
}
```

### `POST /api/multiplier/queue/control`

Operator control over the render queue.

**Request:** `{ action: "pause" | "resume" | "recover" }`

- `pause` — the worker finishes the current video, then stops picking up new ones (queued outputs stay `PENDING`).
- `resume` — clears the pause, resets outputs stuck in `RENDERING` to `PENDING`, restarts the worker.
- `recover` — resets stale `RENDERING` outputs and kicks the worker without changing the pause flag.

**Response `200`:** `{ success: true, state: { paused, processing }, recovered?: number }`

Errors: `400` unknown action.

---

## Smart Export (days-based)

### `POST /api/multiplier/smart-export/preview`

Compute a feasible distribution plan without starting the export. Each account's
`count` is its **per-day** allocation; it is multiplied by `days` server-side.
Existing constraints still apply: an account can't receive more videos than there are
groups with remaining completed outputs, and no group repeats within one account.

Assignment is fair round-robin: each group's videos are dealt one at a time to the
eligible account with the fewest assigned videos, so when demand exceeds supply the
videos spread near-evenly instead of starving the accounts dealt to last. Accounts
that can't be fully satisfied keep their partial videos (`videoIds.length < count`)
and are also listed in `unfulfillable` with their partial `assignedCount`.

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

Same request body as preview. Computes the plan server-side and runs every account
that received at least one video — partial plans included; only accounts with
`assignedCount === 0` are excluded. Starts a background `SmartExportJob` (with `days`
recorded on the job).

**Response `200`:**

```ts
{
  jobId: string;
  budget: { totalAvailable: number; assigned: number; videosLeft: number };
  unfulfillable: { driveFolderId: string; driveFolderName: string; requestedCount: number; assignedCount: number; reason: string }[];
}
```

Errors: `400` missing fields, or no account received any videos (`{ error, budget, unfulfillable }`).

Note: when a job is created, each included `MultiplierOutput` records its destination
on `exportDestinationFolderId` / `exportDestinationFolderName` (visible in the queue
dashboard and in the legacy `GET /api/managed/multiplier` group payloads).

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
