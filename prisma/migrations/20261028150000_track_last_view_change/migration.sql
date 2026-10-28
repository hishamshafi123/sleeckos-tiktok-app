-- Track the last observed view-count change for the 72-hour automatic-refresh stop.
ALTER TABLE "TrackedVideo"
ADD COLUMN "lastViewsChangedAt" TIMESTAMP(3);

-- Initialize from the best available history: the latest snapshot whose views
-- differ from its predecessor, otherwise the first snapshot, otherwise capture.
WITH ordered AS (
  SELECT
    s."trackedVideoId",
    s.views,
    s."recordedAt",
    LAG(s.views) OVER (
      PARTITION BY s."trackedVideoId"
      ORDER BY s."recordedAt", s.id
    ) AS previous_views
  FROM "VideoStatSnapshot" s
), summarized AS (
  SELECT
    "trackedVideoId",
    MAX("recordedAt") FILTER (
      WHERE previous_views IS NOT NULL AND views IS DISTINCT FROM previous_views
    ) AS last_changed_at,
    MIN("recordedAt") AS first_snapshot_at
  FROM ordered
  GROUP BY "trackedVideoId"
)
UPDATE "TrackedVideo" AS video
SET "lastViewsChangedAt" = COALESCE(
  summarized.last_changed_at,
  summarized.first_snapshot_at,
  video."capturedAt"
)
FROM summarized
WHERE video.id = summarized."trackedVideoId";

UPDATE "TrackedVideo"
SET "lastViewsChangedAt" = "capturedAt"
WHERE "lastViewsChangedAt" IS NULL;
