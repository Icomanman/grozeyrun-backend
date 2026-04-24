'use strict';

/**
 * Sync payload validation helpers.
 *
 * Auth flows (register, login, logout, profile) are handled by the Supabase
 * Auth SDK on the mobile app and are NOT validated here (ADR-001).
 * These functions act as a safety net, not the primary guard — the mobile app
 * is responsible for data integrity before sending (init-requirements.md §Others).
 */

const REQUIRED_DATA_KEYS = ['items_storage', 'lists_storage', 'runs_storage', 'app_settings'];
// list_shares_storage is optional — omitting it is valid (no shares to sync)
const OPTIONAL_ARRAY_KEYS = ['users_storage', 'list_shares_storage'];

/**
 * Validates the top-level structure of the sync data payload.
 * @param {unknown} data - The `data` object from the request body
 * @returns {string|null} An error message, or null if the payload is valid
 */
function validateSyncPayload(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return 'Missing or invalid data payload.';
    }
    for (const key of REQUIRED_DATA_KEYS) {
        if (!(key in data)) {
            return `Missing required field: data.${key}.`;
        }
    }
    if (typeof data.items_storage !== 'object' || Array.isArray(data.items_storage)) {
        return 'data.items_storage must be a plain object (Record<listId, ListItem[]>).';
    }
    if (!Array.isArray(data.lists_storage)) {
        return 'data.lists_storage must be an array.';
    }
    if (!Array.isArray(data.runs_storage)) {
        return 'data.runs_storage must be an array.';
    }
    if (typeof data.users_storage !== 'object' || Array.isArray(data.users_storage)) {
        return 'data.users_storage must be a plain object.';
    }
    if (typeof data.app_settings !== 'object' || Array.isArray(data.app_settings)) {
        return 'data.app_settings must be a plain object.';
    }
    for (const key of OPTIONAL_ARRAY_KEYS) {
        if (key in data && !Array.isArray(data[key])) {
            return `data.${key} must be an array when present.`;
        }
    }
    return null;
}

/**
 * Verifies that every record carrying an owner_id belongs to the authenticated user.
 * Prevents a client from writing another user's data into their own snapshot.
 * @param {object} data - The validated sync data payload
 * @param {string} owner_id - The authenticated user's id from the JWT
 * @returns {string|null} An error message, or null if ownership is consistent
 */
function validateOwnership(data, owner_id) {
    for (const list of data.lists_storage) {
        if (list.owner_id && list.owner_id !== owner_id) {
            return 'Ownership mismatch in lists_storage.';
        }
    }
    for (const run of data.runs_storage) {
        if (run.owner_id && run.owner_id !== owner_id) {
            return 'Ownership mismatch in runs_storage.';
        }
    }
    if (data.users_storage && data.users_storage.id && data.users_storage.id !== owner_id) {
        return 'Ownership mismatch in users_storage.';
    }
    return null;
}

module.exports = { validateSyncPayload, validateOwnership };