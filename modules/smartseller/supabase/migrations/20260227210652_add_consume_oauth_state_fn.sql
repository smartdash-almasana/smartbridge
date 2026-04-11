
-- Atomic single-use consumption of an OAuth state.
-- Returns the row if found, not-yet-used, and not expired.
-- Returns nothing (0 rows) if state is invalid, already used, or expired.
CREATE OR REPLACE FUNCTION consume_oauth_state(p_state TEXT)
RETURNS TABLE (
    state        TEXT,
    code_verifier TEXT,
    user_id      UUID,
    expires_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ
)
LANGUAGE SQL
SECURITY DEFINER
AS $$
    DELETE FROM v2_oauth_states
    WHERE v2_oauth_states.state = p_state
      AND v2_oauth_states.used_at IS NULL
      AND v2_oauth_states.expires_at > now()
    RETURNING
        v2_oauth_states.state,
        v2_oauth_states.code_verifier,
        v2_oauth_states.user_id,
        v2_oauth_states.expires_at,
        v2_oauth_states.created_at;
$$;

COMMENT ON FUNCTION consume_oauth_state(TEXT) IS
    'Atomically deletes and returns an OAuth state row (single-use). '
    'Returns 0 rows if state is not found, already used, or expired. '
    'Used by /api/auth/meli/callback to prevent replay attacks.';
;
