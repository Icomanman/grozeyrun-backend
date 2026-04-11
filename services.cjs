'use strict';

/**
 * Express route handlers for the GrozeyRun thin backend.
 *
 * Auth is fully delegated to Supabase Auth (ADR-001). This module
 * only handles the two sync routes: POST /api/sync (push) and
 * GET /api/sync (pull). See init-requirements.md for full spec.
 */

const express = require('express');
const { supabase, sql } = require('./db');
const { validateSyncPayload, validateOwnership } = require('./validations.cjs');

// Increment this constant in constants/index.ts on the mobile app for breaking changes.
const SUPPORTED_SCHEMA_VERSIONS = new Set([1]);

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

/**
 * POST /api/sync — full-state push (ADR-002).
 * Replaces the authenticated user's stored snapshot entirely.
 * Wrapped in a DB transaction; any failure rolls back the whole write.
 */
const syncPush = async (req, res) => {
    const { schema_version, data } = req.body;
    const owner_id = req.userId;

    if (!SUPPORTED_SCHEMA_VERSIONS.has(Number(schema_version))) {
        return res.status(400).json({ success: false, message: `Unsupported schema_version: ${schema_version}.` });
    }

    const payloadError = validateSyncPayload(data);
    if (payloadError) {
        return res.status(400).json({ success: false, message: payloadError });
    }

    const ownerError = validateOwnership(data, owner_id);
    if (ownerError) {
        return res.status(403).json({ success: false, message: ownerError });
    }

    // Strip password from users_storage before persisting (O1 fix from review-log)
    const safeUsers = data.users_storage ? { ...data.users_storage } : null;
    if (safeUsers) delete safeUsers.password;

    const payloadSize = Buffer.byteLength(JSON.stringify(req.body), 'utf8');

    try {
        // Atomic full-state replacement — partial failures roll back entirely (R5 fix)
        await sql.begin(async (tx) => {
            await tx`
                INSERT INTO public.user_snapshots
                    (owner_id, schema_version, items_storage, lists_storage, runs_storage, users_storage, app_settings, updated_at)
                VALUES
                    (${owner_id}, ${schema_version},
                     ${sql.json(data.items_storage)}, ${sql.json(data.lists_storage)},
                     ${sql.json(data.runs_storage)}, ${sql.json(safeUsers)},
                     ${sql.json(data.app_settings)}, now())
                ON CONFLICT (owner_id) DO UPDATE SET
                    schema_version = EXCLUDED.schema_version,
                    items_storage  = EXCLUDED.items_storage,
                    lists_storage  = EXCLUDED.lists_storage,
                    runs_storage   = EXCLUDED.runs_storage,
                    users_storage  = EXCLUDED.users_storage,
                    app_settings   = EXCLUDED.app_settings,
                    updated_at     = EXCLUDED.updated_at
            `;
            await tx`
                INSERT INTO public.sync_logs (owner_id, direction, payload_size, success)
                VALUES (${owner_id}, 'push', ${payloadSize}, true)
            `;
        });
        return res.status(200).json({ success: true, message: 'Sync successful.' });
    } catch (err) {
        console.error('[sync push] error:', err.message);
        // Best-effort failure log — intentionally outside the rolled-back transaction
        sql`
            INSERT INTO public.sync_logs (owner_id, direction, payload_size, success, error_message)
            VALUES (${owner_id}, 'push', ${payloadSize}, false, ${err.message})
        `.catch((logErr) => console.error('[sync push] log write failed:', logErr.message));
        return res.status(500).json({ success: false, message: 'Sync failed. Please try again.' });
    }
};

/**
 * GET /api/sync — full-state pull (ADR-002).
 * Returns the last successfully stored snapshot for the authenticated user.
 */
const syncPull = async (req, res) => {
    const owner_id = req.userId;
    const schema_version = Number(req.query.schema_version);

    if (!SUPPORTED_SCHEMA_VERSIONS.has(schema_version)) {
        return res.status(400).json({ success: false, message: `Unsupported schema_version: ${schema_version}.` });
    }

    try {
        const [snapshot] = await sql`
            SELECT items_storage, lists_storage, runs_storage, users_storage, app_settings
            FROM   public.user_snapshots
            WHERE  owner_id = ${owner_id}
            LIMIT  1
        `;

        // Fire-and-forget pull log
        sql`
            INSERT INTO public.sync_logs (owner_id, direction, success)
            VALUES (${owner_id}, 'pull', true)
        `.catch((logErr) => console.error('[sync pull] log write failed:', logErr.message));

        if (!snapshot) {
            return res.status(200).json({ success: true, data: null, message: 'No snapshot found for this user.' });
        }
        return res.status(200).json({
            success: true,
            data: {
                items_storage: snapshot.items_storage,
                lists_storage: snapshot.lists_storage,
                runs_storage:  snapshot.runs_storage,
                users_storage: snapshot.users_storage,
                app_settings:  snapshot.app_settings
            },
            message: 'Sync successful.'
        });
    } catch (err) {
        console.error('[sync pull] error:', err.message);
        sql`
            INSERT INTO public.sync_logs (owner_id, direction, success, error_message)
            VALUES (${owner_id}, 'pull', false, ${err.message})
        `.catch((logErr) => console.error('[sync pull] log write failed:', logErr.message));
        return res.status(500).json({ success: false, message: 'Failed to retrieve data. Please try again.' });
    }
};

function serviceHandler() {
    const router = express.Router();
    // All routes require a valid Supabase JWT
    router.use(authMiddleware);
    router.post('/sync', syncPush);
    router.get('/sync', syncPull);
    router.use(/.*/, (_req, res) => res.status(404).json({ success: false, message: 'Not found.' }));
    return router;
}

module.exports = serviceHandler;