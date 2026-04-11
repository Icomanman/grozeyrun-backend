'use strict';

const { createClient } = require('@supabase/supabase-js');
const postgres = require('postgres');

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

/**
 * Raw postgres client — used for all DB read/write operations.
 * `prepare: false` is required when using Supabase's transaction pooler (port 6543).
 * Required env var: DATABASE_URL
 */
const sql = postgres(process.env.DATABASE_URL, {
    prepare: false,
    max: 5,
    idle_timeout: 20
});

module.exports = { supabase, sql };