/**
 * Sync payload validation — framework-agnostic.
 * 
 * Uses dependency injection for error parsing to remain
 * framework-neutral (works in Deno, Node, etc.)
 */

const REQUIRED_DATA_KEYS = ['items_storage', 'lists_storage', 'runs_storage', 'app_settings'];
const OPTIONAL_ARRAY_KEYS = ['users_storage', 'list_shares_storage'];

export type ValidationDeps = {
  parseError: (err: unknown) => string;
};

/**
 * Validates the top-level structure of the sync data payload.
 * @param data - The `data` object from the request body
 * @param _deps - Validation dependencies (for future extensibility)
 * @returns An error message, or null if the payload is valid
 */
export function validateSyncPayload(data: unknown, _deps?: ValidationDeps): string | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return 'Missing or invalid data payload.';
  }

  const obj = data as Record<string, unknown>;

  for (const key of REQUIRED_DATA_KEYS) {
    if (!(key in obj)) {
      return `Missing required field: data.${key}.`;
    }
  }

  if (typeof obj.items_storage !== 'object' || Array.isArray(obj.items_storage)) {
    return 'data.items_storage must be a plain object (Record<listId, ListItem[]>).';
  }

  if (!Array.isArray(obj.lists_storage)) {
    return 'data.lists_storage must be an array.';
  }

  if (!Array.isArray(obj.runs_storage)) {
    return 'data.runs_storage must be an array.';
  }

  if (typeof obj.users_storage !== 'object' || Array.isArray(obj.users_storage)) {
    return 'data.users_storage must be a plain object.';
  }

  if (typeof obj.app_settings !== 'object' || Array.isArray(obj.app_settings)) {
    return 'data.app_settings must be a plain object.';
  }

  for (const key of OPTIONAL_ARRAY_KEYS) {
    if (key in obj && !Array.isArray(obj[key])) {
      return `data.${key} must be an array when present.`;
    }
  }

  return null;
}

/**
 * Verifies that every record carrying an owner_id belongs to the authenticated user.
 * Prevents a client from writing another user's data into their own snapshot.
 * @param data - The validated sync data payload
 * @param owner_id - The authenticated user's id from the JWT
 * @param _deps - Validation dependencies (for future extensibility)
 * @returns An error message, or null if ownership is consistent
 */
export function validateOwnership(
  data: Record<string, any>,
  owner_id: string,
  _deps?: ValidationDeps
): string | null {
  for (const list of data.lists_storage || []) {
    if (list.owner_id && list.owner_id !== owner_id) {
      return 'Ownership mismatch in lists_storage.';
    }
  }

  for (const run of data.runs_storage || []) {
    if (run.owner_id && run.owner_id !== owner_id) {
      return 'Ownership mismatch in runs_storage.';
    }
  }

  if (data.users_storage && data.users_storage.id && data.users_storage.id !== owner_id) {
    return 'Ownership mismatch in users_storage.';
  }

  return null;
}
