'use strict';

const { createClient } = require('@supabase/supabase-js');

/**
 * Supabase client — used server-side for JWT verification only.
 * Uses the service role key which must NEVER be exposed to the client.
 * Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

/* EDGE_CLIENT_CONFIG_START
{
  global: {
    headers: {
      Authorization: `Bearer ${token}`
    }
  }
}
EDGE_CLIENT_CONFIG_END */

/**
 * Auth middleware — verifies the Supabase JWT in Authorization: Bearer <token>.
 * Attaches the authenticated user.id to req.userId for downstream handlers.
 * owner_id is NEVER accepted from the request body (ADR-001).
 */
const authMiddleware = async (req, res, next) => {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Missing or invalid Authorization header.' });
  }
  const token = header.slice(7);
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
    }
    req.userId = user.id;
    next();
  } catch (err) {
    console.error('[auth] unexpected error:', err.message);
    return res.status(500).json({ success: false, message: 'Authentication error.' });
  }
};

module.exports = authMiddleware;
