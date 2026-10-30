WITH input AS (
  SELECT :cursor_created_at::nullable(timestamptz) AS cursor_created_at,
    :cursor_id::nullable(bigint) AS cursor_id
)
SELECT r.id, r.dish_id, r.actor, r.operation, r.summary, r.created_at,
  member_profile.display_name AS actor_display_name,
  job.id AS import_job_id,
  approver_profile.display_name AS applied_by_display_name
FROM feastjourney.catalog_revisions AS r
CROSS JOIN input
LEFT JOIN feastjourney.user_profiles AS member_profile
  ON member_profile.user_id = CASE
    WHEN r.actor LIKE 'member:%' THEN substring(r.actor from 8)
    WHEN r.actor LIKE 'admin:%' THEN substring(r.actor from 7)
    ELSE NULL
  END
LEFT JOIN feastjourney.catalog_import_jobs AS job
  ON job.id = CASE
    WHEN r.actor ~ '^import:[0-9]+$' THEN substring(r.actor from 8)::bigint
    ELSE NULL
  END
LEFT JOIN feastjourney.user_profiles AS approver_profile
  ON approver_profile.user_id = job.approved_by
WHERE r.dish_id = :dish_id::bigint
  AND (
    input.cursor_created_at IS NULL
    OR (r.created_at, r.id) < (input.cursor_created_at, input.cursor_id)
  )
ORDER BY r.created_at DESC, r.id DESC
LIMIT :limit::int
