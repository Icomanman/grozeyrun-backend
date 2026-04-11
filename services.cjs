'use strict';

/**
 * Express route handlers for the GrozeyRun thin backend.
 *
 * Auth is fully delegated to Supabase Auth (ADR-001). This module
 * only handles the two sync routes: POST /api/sync (push) and
 * GET /api/sync (pull). See init-requirements.md for full spec.
 *
 * Each route operates on the real relational tables (users, app_settings,
 * lists, items, runs, sync_logs) — NOT a JSONB blob. The sync boundary
 * flattens/reconstructs the mobile app's AsyncStorage shape.
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
 *
 * Transaction order:
 *   1. Upsert public.users profile (never writes password_hash)
 *   2. Upsert public.app_settings
 *   3. DELETE public.lists WHERE owner_id = ?  ← cascades to items, runs, list_shares
 *   4. INSERT public.lists
 *   5. INSERT public.items  (items_storage is Record<listId, Item[]> — flattened here)
 *   6. INSERT public.runs
 *   7. INSERT public.sync_logs (success record)
 *
 * Any failure rolls back the entire transaction (R5 fix).
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

    const payloadSize = Buffer.byteLength(JSON.stringify(req.body), 'utf8');
    const { items_storage, lists_storage, runs_storage, users_storage, app_settings } = data;

    // items_storage arrives as Record<listId, ListItem[]> — flatten to a row array
    const flatItems = Object.values(items_storage ?? {}).flat();

    try {
        await sql.begin(async (tx) => {
            // ── 1. Upsert user profile ──────────────────────────────────────────
            // password_hash is intentionally omitted: Supabase Auth owns it.
            if (users_storage) {
                await tx`
                    INSERT INTO public.users (id, email, first_name, last_name, created_at, updated_at)
                    VALUES (
                        ${owner_id},
                        ${users_storage.email ?? null},
                        ${users_storage.first_name ?? null},
                        ${users_storage.last_name ?? null},
                        ${users_storage.created_at ?? new Date()},
                        ${users_storage.updated_at ?? new Date()}
                    )
                    ON CONFLICT (id) DO UPDATE SET
                        email      = EXCLUDED.email,
                        first_name = EXCLUDED.first_name,
                        last_name  = EXCLUDED.last_name,
                        updated_at = EXCLUDED.updated_at
                `;
            }

            // ── 2. Upsert app settings ──────────────────────────────────────────
            if (app_settings) {
                await tx`
                    INSERT INTO public.app_settings
                        (user_id, budget, currency, max_hours, notifications, period, theme, updated_at)
                    VALUES (
                        ${owner_id},
                        ${app_settings.budget ?? null},
                        ${app_settings.currency ?? null},
                        ${app_settings.max_hours ?? null},
                        ${app_settings.notifications ?? true},
                        ${app_settings.period ?? 'monthly'},
                        ${app_settings.theme ?? 'light'},
                        ${app_settings.updated_at ?? new Date()}
                    )
                    ON CONFLICT (user_id) DO UPDATE SET
                        budget        = EXCLUDED.budget,
                        currency      = EXCLUDED.currency,
                        max_hours     = EXCLUDED.max_hours,
                        notifications = EXCLUDED.notifications,
                        period        = EXCLUDED.period,
                        theme         = EXCLUDED.theme,
                        updated_at    = EXCLUDED.updated_at
                `;
            }

            // ── 3. Full-state replace: delete all lists ─────────────────────────
            // CASCADE propagates to: items, runs, list_shares
            await tx`DELETE FROM public.lists WHERE owner_id = ${owner_id}`;

            // ── 4. Insert lists ─────────────────────────────────────────────────
            if (lists_storage?.length > 0) {
                const listRows = lists_storage.map((l) => ({
                    id:          l.id,
                    created_at:  l.created_at  ?? new Date(),
                    description: l.description ?? null,
                    is_shared:   l.is_shared   ?? false,
                    item_count:  l.item_count  ?? 0,
                    name:        l.name,
                    owner_id,
                    total_cost:  l.total_cost  ?? 0,
                    updated_at:  l.updated_at  ?? new Date(),
                }));
                await tx`INSERT INTO public.lists ${tx(listRows)}`;
            }

            // ── 5. Insert items (flattened from Record<listId, Item[]>) ──────────
            if (flatItems.length > 0) {
                const itemRows = flatItems.map((item) => ({
                    id:          item.id,
                    category:    item.category    ?? null,
                    completed:   item.completed   ?? false,
                    created_at:  item.created_at  ?? new Date(),
                    currency:    item.currency    ?? null,
                    description: item.description ?? null,
                    list_id:     item.list_id,
                    notes:       item.notes       ?? null,
                    owner_id,
                    quantity:    item.quantity    ?? null,
                    text:        item.text,
                    unit_price:  item.unit_price  ?? null,
                    updated_at:  item.updated_at  ?? new Date(),
                }));
                await tx`INSERT INTO public.items ${tx(itemRows)}`;
            }

            // ── 6. Insert runs ──────────────────────────────────────────────────
            if (runs_storage?.length > 0) {
                const runRows = runs_storage.map((r) => ({
                    id:              r.id,
                    completion_date: r.completion_date ?? null,
                    created_at:      r.created_at      ?? new Date(),
                    description:     r.description     ?? null,
                    is_completed:    r.is_completed     ?? false,
                    list_id:         r.list_id,
                    name:            r.name             ?? null,
                    owner_id,
                    total_time:      r.total_time       ?? null,
                    updated_at:      r.updated_at       ?? new Date(),
                }));
                await tx`INSERT INTO public.runs ${tx(runRows)}`;
            }

            // ── 7. Log the push (inside transaction — rolls back on failure) ────
            await tx`
                INSERT INTO public.sync_logs
                    (id, data_size, schema_version, success, sync_type, user_id)
                VALUES
                    (gen_random_uuid(), ${payloadSize}, ${String(schema_version)}, true, 'push', ${owner_id})
            `;
        });

        return res.status(200).json({ success: true, message: 'Sync successful.' });
    } catch (err) {
        console.error('[sync push] error:', err.message);
        // Best-effort failure log — intentionally outside the rolled-back transaction
        sql`
            INSERT INTO public.sync_logs
                (id, data_size, schema_version, success, sync_type, user_id, message)
            VALUES
                (gen_random_uuid(), ${payloadSize}, ${String(schema_version)}, false, 'push', ${owner_id}, ${err.message})
        `.catch((logErr) => console.error('[sync push] log write failed:', logErr.message));
        return res.status(500).json({ success: false, message: 'Sync failed. Please try again.' });
    }
};

/**
 * GET /api/sync — full-state pull (ADR-002).
 *
 * Queries each table independently (parallelised), then assembles the
 * mobile app's expected AsyncStorage shape before responding.
 * items_storage is returned as Record<listId, Item[]> to match the mobile type.
 */
const syncPull = async (req, res) => {
    const owner_id = req.userId;
    const schema_version = Number(req.query.schema_version);

    if (!SUPPORTED_SCHEMA_VERSIONS.has(schema_version)) {
        return res.status(400).json({ success: false, message: `Unsupported schema_version: ${schema_version}.` });
    }

    try {
        const [users, settings, lists, items, runs] = await Promise.all([
            sql`SELECT id, email, first_name, last_name, created_at, updated_at
                FROM public.users WHERE id = ${owner_id}`,
            sql`SELECT * FROM public.app_settings WHERE user_id = ${owner_id}`,
            sql`SELECT * FROM public.lists WHERE owner_id = ${owner_id}`,
            sql`SELECT * FROM public.items WHERE owner_id = ${owner_id}`,
            sql`SELECT * FROM public.runs  WHERE owner_id = ${owner_id}`,
        ]);

        // Reconstruct items_storage as Record<listId, Item[]>
        const items_storage = {};
        for (const item of items) {
            if (!items_storage[item.list_id]) items_storage[item.list_id] = [];
            items_storage[item.list_id].push(item);
        }

        // Fire-and-forget pull log
        sql`
            INSERT INTO public.sync_logs
                (id, schema_version, success, sync_type, user_id)
            VALUES
                (gen_random_uuid(), ${String(schema_version)}, true, 'pull', ${owner_id})
        `.catch((logErr) => console.error('[sync pull] log write failed:', logErr.message));

        return res.status(200).json({
            success: true,
            data: {
                users_storage: users[0]    ?? null,
                app_settings:  settings[0] ?? null,
                lists_storage: lists,
                items_storage,
                runs_storage:  runs,
            },
            message: 'Sync successful.',
        });
    } catch (err) {
        console.error('[sync pull] error:', err.message);
        sql`
            INSERT INTO public.sync_logs
                (id, schema_version, success, sync_type, user_id, message)
            VALUES
                (gen_random_uuid(), ${String(schema_version)}, false, 'pull', ${owner_id}, ${err.message})
        `.catch((logErr) => console.error('[sync pull] log write failed:', logErr.message));
        return res.status(500).json({ success: false, message: 'Failed to retrieve data. Please try again.' });
    }
};

function serviceHandler() {
    const router = express.Router();
    // All routes require a valid Supabase JWT (ADR-001)
    router.use(authMiddleware);
    router.post('/sync', syncPush);
    router.get('/sync', syncPull);
    router.use(/.*/, (_req, res) => res.status(404).json({ success: false, message: 'Not found.' }));
    return router;
}

module.exports = serviceHandler;