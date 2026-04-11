'use strict';

const { createClient } = require('@supabase/supabase-js');

/**
 * Supabase client — used server-side for JWT verification only.
 * Uses the service role key which must NEVER be exposed to the client.
 * Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
);

module.exports = { supabase };
