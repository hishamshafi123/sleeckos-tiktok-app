WITH quota_only AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, "id" ASC) AS pool_offset
  FROM "Campaign"
  WHERE "priorityQuota" IS NOT NULL
    AND "priorityRank" IS NULL
), pool_tail AS (
  SELECT COALESCE(MAX("priorityRank"), 0) AS max_rank
  FROM "Campaign"
)
UPDATE "Campaign" AS campaign
SET "priorityRank" = (pool_tail.max_rank + quota_only.pool_offset)::integer
FROM quota_only, pool_tail
WHERE campaign."id" = quota_only."id";
