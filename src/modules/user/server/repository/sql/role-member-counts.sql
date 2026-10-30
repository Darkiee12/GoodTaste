SELECT ur.role_id AS role_id, COUNT(*) AS member_count
FROM feastjourney.user_roles AS ur
GROUP BY ur.role_id
