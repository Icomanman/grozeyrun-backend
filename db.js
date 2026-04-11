'use strict';

const postgres = require('postgres');

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

module.exports = { sql };