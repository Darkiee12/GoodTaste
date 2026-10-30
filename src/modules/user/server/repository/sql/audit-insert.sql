INSERT INTO feastjourney.security_audit_events
  (actor_user_id, session_id, request_id, event, outcome, reason, resource, metadata)
VALUES
  (:actor_user_id::nullable(text), :session_id::nullable(text), :request_id::text, :event::text, :outcome::text, :reason::nullable(text), :resource::nullable(text), :metadata::jsonb);
