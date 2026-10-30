SELECT n.id, n.dish_id, n.author, n.note_kind, n.note, n.created_at,
  member_profile.display_name AS author_display_name,
  job.id AS import_job_id,
  approver_profile.display_name AS applied_by_display_name
FROM feastjourney.curation_notes AS n
LEFT JOIN feastjourney.user_profiles AS member_profile
  ON member_profile.user_id = CASE
    WHEN n.author LIKE 'member:%' THEN substring(n.author from 8)
    WHEN n.author LIKE 'admin:%' THEN substring(n.author from 7)
    ELSE NULL
  END
LEFT JOIN feastjourney.catalog_import_jobs AS job
  ON job.id = CASE
    WHEN n.author ~ '^import:[0-9]+$' THEN substring(n.author from 8)::bigint
    ELSE NULL
  END
LEFT JOIN feastjourney.user_profiles AS approver_profile
  ON approver_profile.user_id = job.approved_by
WHERE n.dish_id = :dish_id::bigint
ORDER BY n.created_at DESC, n.id DESC
LIMIT :limit::int
